import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadConfig, resolvePaths } from './config.js';
import { healLoop } from './healer.js';
import { logKaneEvent, runKaneTest } from './runner.js';
import { scaffoldTest, scanRoutes } from './scanner.js';
import { WORKING_MAIN_JS } from './local-healer.js';

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
      reject(
        new Error(
          `${kaneBin} not found. Install: npm i -g @testmuai/kane-cli then run: kane-cli login`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Kane CLI not authenticated. Run: kane-cli login\n${out.slice(0, 200)}`,
          ),
        );
        return;
      }
      resolve(out.trim());
    });
  });
}

/**
 * @param {string} repoRoot
 * @param {import('./config.js').KiroHealConfig} config
 */
export async function initProject(repoRoot, config) {
  const paths = resolvePaths(repoRoot, config);
  await fs.mkdir(path.dirname(paths.testFile), { recursive: true });

  const routes = await scanRoutes(repoRoot);
  const { outputPath, content } = await scaffoldTest({
    repoRoot,
    outputPath: paths.testFile,
    baseUrl: config.baseUrl,
    useLlm: process.env.KIRO_HEAL_SCAN_LLM === '1',
  });

  if (config.demoBroken) {
    await injectDemoRegression(paths.healTarget);
  }

  return { testFile: outputPath, routes, content };
}

/**
 * @param {string} healTargetAbs
 */
export async function injectDemoRegression(healTargetAbs) {
  const broken = `/**
 * Demo app — intentional regression for kiro-heal E2E (wrong element id).
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
  console.log('[kiro-heal] injected demo regression into demo/public/js/main.js');
}

/**
 * Restore working demo JS (for manual reset).
 * @param {string} healTargetAbs
 */
export async function restoreDemo(healTargetAbs) {
  await fs.writeFile(healTargetAbs, WORKING_MAIN_JS, 'utf8');
  console.log('[kiro-heal] restored working demo/public/js/main.js');
}

/**
 * Wait until HTTP server responds.
 * @param {string} url
 * @param {number} [maxMs]
 */
export async function waitForHttp(url, maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server not ready at ${url} after ${maxMs}ms`);
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {import('./config.js').KiroHealConfig} opts.config
 * @param {boolean} [opts.enableHeal]
 * @param {string|null} [opts.targetOverride]
 */
export function createRunTestFn(opts) {
  const paths = resolvePaths(opts.repoRoot, opts.config);
  return async () =>
    runKaneTest({
      testFile: paths.testFile,
      cwd: opts.repoRoot,
      timeoutSeconds: opts.config.kaneTimeout,
      onEvent: logKaneEvent,
      onRaw: (chunk, stream) => {
        if (process.env.KIRO_HEAL_VERBOSE === '1') process[stream].write(chunk);
      },
    });
}

/**
 * Full verify + heal loop.
 * @param {object} opts
 */
export async function runPipeline(opts) {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const config = opts.config ?? (await loadConfig(repoRoot));
  const paths = resolvePaths(repoRoot, config);
  const enableHeal = opts.enableHeal !== false;

  if (opts.checkKane !== false) {
    const { shouldUseSimulator } = await import('./runner.js');
    const sim = await shouldUseSimulator();
    if (sim) {
      console.log('[kiro-heal] mode: offline simulator (Kane-compatible NDJSON)');
    } else {
      const who = await assertKaneReady();
      console.log(`[kiro-heal] mode: live Kane CLI — ${who.split('\n')[0]}`);
    }
  }

  try {
    await fs.access(paths.testFile);
  } catch {
    console.log('[kiro-heal] no test file — running init (scan + scaffold)…');
    await initProject(repoRoot, config);
  }

  const target =
    opts.targetOverride ?? paths.healTarget;

  const runTest = createRunTestFn({ repoRoot, config });

  if (!enableHeal) {
    const result = await runTest();
    return { passed: result.outcome === 'passed', lastResult: result, healCount: 0 };
  }

  return healLoop({
    repoRoot,
    maxHealAttempts: config.maxHeal,
    runTest,
    resolveTarget: async () => target,
  });
}

/**
 * @param {string} repoRoot
 */
export async function loadProject(repoRoot) {
  const config = await loadConfig(repoRoot);
  const paths = resolvePaths(repoRoot, config);
  return { config, paths };
}
