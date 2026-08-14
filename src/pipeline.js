import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadConfig, resolvePaths, DEFAULT_CONFIG } from './config.js';
import { healLoop, createSelfHealedPR } from './healer.js';
import { formatFailureBlock } from './parser.js';
import { WORKING_MAIN_JS } from './local-healer.js';
import { runOracle } from './oracle.js';
import { formatTriageMessage, TEST_DEFECT_COMMENT, triageFailure } from './triage.js';
import { shouldOpenAutomatedPr, STABLE_AUTO_FIX_BRANCH } from './policy.js';
import { envOn } from './flags.js';
import { postComment } from './github/pr.js';
import { Octokit } from '@octokit/rest';
import { redactSecrets } from './secrets.js';

const DEFAULT_KANE = 'kane-cli';

/**
 * @param {string} [kaneBin]
 */
export async function assertKaneReady(kaneBin = process.env.KANE_CLI_BIN ?? DEFAULT_KANE) {
  return new Promise((resolve, reject) => {
    const child = spawn(kaneBin, ['whoami'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.on('error', () => {
      reject(new Error(`${kaneBin} not found. Kane is optional — default oracle is Playwright.`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Kane CLI not authenticated.\n${out.slice(0, 200)}`));
        return;
      }
      resolve(out.trim());
    });
  });
}

export async function initProject(repoRoot, config) {
  const paths = resolvePaths(repoRoot, config);
  await fs.mkdir(path.dirname(paths.testFile), { recursive: true });

  const { scaffoldTest, scanRoutes } = await import('./scanner.js');
  const routes = await scanRoutes(repoRoot);
  const { outputPath, content } = await scaffoldTest({
    repoRoot,
    outputPath: paths.testFile,
    baseUrl: config.baseUrl,
    useLlm: envOn('SCAN_LLM'),
  });

  if (config.demoBroken) {
    await injectDemoRegression(paths.healTarget);
  }

  return { testFile: outputPath, routes, content };
}

export async function injectDemoRegression(healTargetAbs) {
  const broken = `/**
 * Example app — intentional regression (wrong element id).
 */
(function init() {
  const cta = document.getElementById('cta-primary-broken');
  const status = document.getElementById('status-banner');

  if (!cta || !status) return;

  cta.addEventListener('click', () => {
    status.textContent = 'Should not reach — broken selector.';
    status.dataset.state = 'success';
  });
})();
`;
  await fs.writeFile(healTargetAbs, broken, 'utf8');
  console.log('[fixloop] injected example regression');
}

export async function restoreDemo(healTargetAbs) {
  await fs.writeFile(healTargetAbs, WORKING_MAIN_JS, 'utf8');
  console.log('[fixloop] restored working example main.js');
}

export async function waitForHttp(url, maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server not ready at ${url} after ${maxMs}ms`);
}

export function createRunTestFn(opts) {
  return async () =>
    runOracle({
      cwd: opts.repoRoot,
      config: opts.config,
      testFile: resolvePaths(opts.repoRoot, opts.config).testFile,
    });
}

/**
 * Triage → (maybe) heal → re-run the same oracle. PR only if the re-run is green.
 * @param {object} opts
 */
export async function runPipeline(opts) {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const config = { ...DEFAULT_CONFIG, ...(opts.config ?? (await loadConfig(repoRoot))) };
  const paths = resolvePaths(repoRoot, config);
  const enableHeal = opts.enableHeal !== false;
  const log = opts.log ?? console.log;

  log(`[fixloop] oracle=${config.oracle ?? 'playwright'}`);

  const runTest = opts.runTest ?? createRunTestFn({ repoRoot, config });
  const first = await runTest();

  if (first.outcome === 'passed') {
    log('[fixloop] ✓ oracle passed — nothing to triage');
    return {
      passed: true,
      triage: { label: 'passed', reason: 'oracle passed', confidence: 1 },
      healCount: 0,
      verified: true,
      lastResult: first,
    };
  }

  const triage = triageFailure(first, { healTarget: config.healTarget });
  log(`[fixloop] triage: ${triage.label} (${triage.reason})`);

  await maybePostTriage(opts, triage);

  if (triage.label === 'test_defect') {
    log(`[fixloop] ${TEST_DEFECT_COMMENT}`);
    return {
      passed: false,
      triage,
      healCount: 0,
      verified: false,
      lastResult: first,
    };
  }

  if (triage.label === 'flake') {
    log('[fixloop] classified as flake — not patching');
    return {
      passed: false,
      triage,
      healCount: 0,
      verified: false,
      lastResult: first,
    };
  }

  if (!enableHeal) {
    return { passed: false, triage, healCount: 0, verified: false, lastResult: first };
  }

  const target = opts.targetOverride ?? paths.healTarget;
  const healOutcome = await healLoop({
    repoRoot,
    maxHealAttempts: config.maxHeal,
    runTest,
    resolveTarget: async () => target,
    allowlist: config.healAllowlist,
    healTarget: config.healTarget,
    skipInitialRun: true,
    initialResult: first,
  });

  if (!healOutcome.passed) {
    log('[fixloop] re-run still red — not opening a PR');
    return { ...healOutcome, triage, verified: false };
  }

  log('[fixloop] ✓ re-run passed after patch');

  if (healOutcome.healCount > 0 && shouldOpenAutomatedPr()) {
    const pr = await openVerifiedDraftPr({
      repoRoot,
      target,
      lastResult: healOutcome.lastResult,
      triage,
      github: opts.github,
    });
    return { ...healOutcome, triage, verified: true, pr };
  }

  return { ...healOutcome, triage, verified: true };
}

async function openVerifiedDraftPr({ repoRoot, target, lastResult, triage, github }) {
  const owner = github?.owner ?? process.env.GITHUB_OWNER ?? process.env.GITHUB_REPOSITORY_OWNER;
  const repo =
    github?.repo ??
    process.env.GITHUB_REPO ??
    process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!owner || !repo) return null;

  const absPath = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  const correctedCode = await fs.readFile(absPath, 'utf8');
  return createSelfHealedPR({
    owner,
    repo,
    branchName: STABLE_AUTO_FIX_BRANCH,
    filename: path.relative(repoRoot, absPath),
    correctedCode,
    failureReport: `${formatTriageMessage(triage)}\n\n${formatFailureBlock(lastResult)}`,
    baseBranch: github?.baseBranch ?? process.env.GITHUB_REF_NAME ?? 'main',
    draft: true,
  });
}

async function maybePostTriage(opts, triage) {
  const issueNumber = opts.issueNumber ?? process.env.FIXLOOP_ISSUE_NUMBER;
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER ?? process.env.GITHUB_REPOSITORY_OWNER;
  const repo = process.env.GITHUB_REPO ?? process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!issueNumber || !token || !owner || !repo) return;
  const octokit = new Octokit({ auth: token });
  await postComment(octokit, owner, repo, Number(issueNumber), redactSecrets(formatTriageMessage(triage)));
}

export async function loadProject(repoRoot) {
  const config = await loadConfig(repoRoot);
  const paths = resolvePaths(repoRoot, config);
  return { config, paths };
}
