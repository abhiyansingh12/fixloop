#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import {
  initProject,
  loadProject,
  runPipeline,
  waitForHttp,
} from '../src/pipeline.js';
import { scaffoldTest } from '../src/scanner.js';
import { startGitHubWebhookServer } from '../src/github/server.js';
import { verifyGitHubRepository } from '../src/github/verify.js';
import {
  assertGitHubAppReady,
  assertWebhookServerReady,
  loadGitHubConfig,
} from '../src/github/config.js';
import { loadEnvFile } from '../src/env.js';
import { flagOn, flagString, parseArgv } from '../src/cli-args.js';
import { watchTree } from '../src/watch-files.js';
import { writeGithubOutput } from '../src/github-output.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function repoRootFrom(dir) {
  return path.resolve(dir ?? process.cwd());
}

const HELP = `fixloop ${VERSION}

Triage red Playwright runs. Only product_regression may write code.
Re-run must be green before a draft PR.

Usage:
  fixloop <command> [options]

Commands:
  init                 Scan routes, write .fixloop/smoke.testmd
  run                  Triage → maybe heal → re-run
  ci                   Action entry (test_defect exits 0; still-red exits 1)
  watch                Re-run on file changes
  scan                 Regenerate smoke testmd
  start                Optional example server + init + run + watch
  github serve         Optional webhook server
  github verify        Optional clone + verify

Options:
  --dir <path>         Working directory
  --command <cmd>      Playwright / oracle command
  --target <file>      Heal target override
  --no-heal            Do not write files
  --base-url <url>     App URL for init/scan
  --out <file>         Scan output path
  --debounce <ms>      Watch debounce
  --port <n>           Webhook server port
  --repo <owner/name>  github verify
  --no-pr              github verify without opening a PR
  --skip-server        start without the example server
  --broken             start with the broken demo CTA
  -h, --help           Show this help
  -v, --version        Print version
`;

async function cmdInit(flags) {
  const repoRoot = repoRootFrom(flagString(flags, 'dir'));
  const config = await loadConfig(repoRoot);
  const baseUrl = flagString(flags, 'base-url');
  if (baseUrl) config.baseUrl = baseUrl;
  console.log('[fixloop] init: scan routes');
  const { testFile, routes } = await initProject(repoRoot, config);
  console.log(`[fixloop] test file: ${testFile}`);
  console.log(`[fixloop] routes: ${routes.length}`);
  for (const r of routes) console.log(`  ${r.route} → ${r.file}`);
  console.log(`[fixloop] heal target: ${config.healTarget}`);
  console.log(`[fixloop] oracle: ${config.oracle}`);
}

function emitOutcome(outcome) {
  writeGithubOutput({
    triage: outcome.triage?.label ?? '',
    verified: Boolean(outcome.verified),
    passed: Boolean(outcome.passed),
    healed: Number(outcome.healCount ?? 0) > 0,
  });
}

async function cmdRun(flags) {
  const repoRoot = repoRootFrom(flagString(flags, 'dir'));
  const config = await loadConfig(repoRoot);
  const command = flagString(flags, 'command');
  if (command) config.playwrightCommand = command;
  const outcome = await runPipeline({
    repoRoot,
    config,
    enableHeal: !flagOn(flags, 'no-heal'),
    targetOverride: flagString(flags, 'target'),
  });
  emitOutcome(outcome);
  process.exit(
    outcome.passed || outcome.triage?.label === 'test_defect' || outcome.triage?.label === 'flake' ? 0 : 1,
  );
}

async function cmdCi(flags) {
  const repoRoot = repoRootFrom(flagString(flags, 'dir'));
  const config = await loadConfig(repoRoot);
  config.oracle = config.oracle === 'kane' ? 'kane' : 'playwright';
  const command = flagString(flags, 'command');
  if (command) config.playwrightCommand = command;
  console.log('[fixloop] ci: triage → patch only on product_regression → re-run → draft PR if green');
  const outcome = await runPipeline({
    repoRoot,
    config,
    enableHeal: true,
    issueNumber: process.env.FIXLOOP_ISSUE_NUMBER || process.env.GITHUB_PR_NUMBER,
  });
  emitOutcome(outcome);
  if (outcome.triage?.label === 'test_defect') {
    console.log('[fixloop] update the test, I will not.');
    process.exit(0);
  }
  if (outcome.verified) process.exit(0);
  process.exit(1);
}

async function cmdWatch(flags, dirOverride) {
  const repoRoot = repoRootFrom(dirOverride ?? flagString(flags, 'dir'));
  const config = await loadConfig(repoRoot);
  const debounceMs = Number(flagString(flags, 'debounce') ?? config.debounceMs);
  console.log(`[fixloop] watching ${repoRoot}`);
  let running = false;
  let pending = false;
  const runOnce = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await runPipeline({ repoRoot, config, enableHeal: true });
    } catch (err) {
      console.error(`[fixloop] ${err.message}`);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void runOnce();
      }
    }
  };
  let timer;
  watchTree(repoRoot, () => {
    clearTimeout(timer);
    timer = setTimeout(() => void runOnce(), debounceMs);
  });
  await runOnce();
  await new Promise(() => {});
}

async function cmdScan(flags) {
  const repoRoot = repoRootFrom(flagString(flags, 'dir'));
  const config = await loadConfig(repoRoot);
  const { outputPath, routes } = await scaffoldTest({
    repoRoot,
    outputPath: flagString(flags, 'out') ?? config.testFile,
    baseUrl: flagString(flags, 'base-url') ?? config.baseUrl,
  });
  console.log(`[fixloop] scaffolded ${outputPath} (${routes.length} routes)`);
}

async function cmdGithubServe(flags) {
  const config = await loadGitHubConfig();
  assertWebhookServerReady(config);
  const portRaw = flagString(flags, 'port');
  const port = portRaw ? Number(portRaw) : config.port;
  await startGitHubWebhookServer({ port });
}

async function cmdGithubVerify(flags) {
  let owner = flagString(flags, 'owner');
  let name = flagString(flags, 'name');
  const repoFlag = flagString(flags, 'repo');
  if (repoFlag?.includes('/')) [owner, name] = repoFlag.split('/');
  if (!owner || !name) {
    console.error('Usage: fixloop github verify --repo owner/name');
    process.exit(2);
  }
  const config = await loadGitHubConfig();
  assertGitHubAppReady(config);
  const installationId = flagString(flags, 'installation-id');
  const result = await verifyGitHubRepository({
    owner,
    repo: name,
    installationId: installationId ? Number(installationId) : undefined,
    ref: flagString(flags, 'ref'),
    openPr: !flagOn(flags, 'no-pr'),
  });
  console.log(`[fixloop:github] passed=${result.passed}`);
  process.exit(result.passed ? 0 : 1);
}

async function cmdStart(flags) {
  const repoRoot = repoRootFrom(flagString(flags, 'dir'));
  const { config, paths } = await loadProject(repoRoot);
  if (flagOn(flags, 'broken')) config.demoBroken = true;
  if (!flagOn(flags, 'skip-server') && paths.demoServer) {
    spawn('node', [paths.demoServer], { cwd: repoRoot, stdio: 'inherit', env: process.env });
    console.log(`[fixloop] demo server → ${config.baseUrl}`);
    await waitForHttp(config.baseUrl);
  }
  await initProject(repoRoot, config);
  await runPipeline({ repoRoot, config, enableHeal: true });
  await cmdWatch(flags, repoRoot);
}

await loadEnvFile();
const { flags, positionals } = parseArgv(process.argv.slice(2));
const command = positionals.join(' ');

if (flags.version) {
  console.log(VERSION);
  process.exit(0);
}
if (flags.help || !command) {
  console.log(HELP);
  process.exit(0);
}

const commands = {
  init: cmdInit,
  run: cmdRun,
  ci: cmdCi,
  watch: cmdWatch,
  scan: cmdScan,
  start: cmdStart,
  'github serve': cmdGithubServe,
  'github verify': cmdGithubVerify,
};

const fn = commands[command];
if (!fn) {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(2);
}

try {
  await fn(flags);
} catch (err) {
  console.error(`[fixloop] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
