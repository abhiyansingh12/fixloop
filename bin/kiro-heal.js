#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import chokidar from 'chokidar';
import { Builtins, Cli, Command, Option } from 'clipanion';
import { loadConfig, resolvePaths } from '../src/config.js';
import {
  initProject,
  loadProject,
  runPipeline,
  waitForHttp,
  createRunTestFn,
} from '../src/pipeline.js';
import { healLoop } from '../src/healer.js';
import { logKaneEvent, runKaneTest } from '../src/runner.js';
import { scaffoldTest } from '../src/scanner.js';
import { startGitHubWebhookServer } from '../src/github/server.js';
import { verifyGitHubRepository } from '../src/github/verify.js';
import {
  assertGitHubAppReady,
  assertWebhookServerReady,
  loadGitHubConfig,
} from '../src/github/config.js';
import { syntaxHealPipeline } from '../src/syntax-healer.js';

const cli = new Cli({
  binaryLabel: 'kiro-heal',
  binaryName: 'kiro-heal',
  binaryVersion: '0.1.0',
});

function repoRootFrom(dir) {
  return path.resolve(dir ?? process.cwd());
}

class InitCommand extends Command {
  static paths = [['init']];

  dir = Option.String('--dir', { required: false });
  baseUrl = Option.String('--base-url', { required: false });
  broken = Option.Boolean('--broken', { required: false });
  llm = Option.Boolean('--llm', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    if (this.baseUrl) config.baseUrl = this.baseUrl;
    if (this.broken) config.demoBroken = true;
    if (this.llm) process.env.KIRO_HEAL_SCAN_LLM = '1';

    console.log('[kiro-heal] init: scan → scaffold testmd → configure demo');
    const { testFile, routes } = await initProject(repoRoot, config);
    console.log(`[kiro-heal] test file: ${testFile}`);
    console.log(`[kiro-heal] routes discovered: ${routes.length}`);
    for (const r of routes) {
      console.log(`  ${r.route} → ${r.file}`);
    }
    console.log(`[kiro-heal] heal target: ${config.healTarget}`);
  }
}

class StartCommand extends Command {
  static paths = [['start']];

  dir = Option.String('--dir', { required: false });
  skipServer = Option.Boolean('--skip-server', { required: false });
  skipInitial = Option.Boolean('--skip-initial-run', { required: false });
  noHeal = Option.Boolean('--no-heal', { required: false });
  noWatch = Option.Boolean('--no-watch', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const { config, paths } = await loadProject(repoRoot);
    let serverChild = null;

    if (!this.skipServer && paths.demoServer) {
      serverChild = spawn('node', [paths.demoServer], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: process.env,
      });
      console.log(`[kiro-heal] demo server starting → ${config.baseUrl}`);
      await waitForHttp(config.baseUrl);
      console.log('[kiro-heal] demo server ready');
    }

    await initProject(repoRoot, config);

    if (!this.skipInitial && !this.noHeal) {
      console.log('[kiro-heal] running initial end-to-end pipeline (Kane → heal → re-run)…');
      const outcome = await runPipeline({
        repoRoot,
        config,
        enableHeal: true,
        checkKane: true,
      });
      if (!outcome.passed) {
        console.error('[kiro-heal] initial pipeline did not pass — watch will continue retries on save');
      }
    }

    if (this.noWatch) {
      if (serverChild) await new Promise(() => {});
      return;
    }

    const watchCmd = new WatchCommand();
    watchCmd.dir = repoRoot;
    watchCmd.test = config.testFile;
    watchCmd.target = config.healTarget;
    watchCmd.maxHeal = String(config.maxHeal);
    watchCmd.debounce = String(config.debounceMs);
    watchCmd.timeout = String(config.kaneTimeout);
    watchCmd.noHeal = this.noHeal;
    watchCmd._serverChild = serverChild;
    await watchCmd.execute();
  }
}

class WatchCommand extends Command {
  static paths = [['watch']];

  test = Option.String('--test', { required: false });
  dir = Option.String('--dir', { required: false });
  target = Option.String('--target', { required: false });
  maxHeal = Option.String('--max-heal', { required: false });
  debounce = Option.String('--debounce', { required: false });
  timeout = Option.String('--timeout', { required: false });
  noHeal = Option.Boolean('--no-heal', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    const paths = resolvePaths(repoRoot, config);

    const testFile = this.test
      ? path.isAbsolute(this.test)
        ? this.test
        : path.join(repoRoot, this.test)
      : paths.testFile;

    const healTarget =
      this.target ?? process.env.KIRO_HEAL_TARGET ?? config.healTarget;
    const maxHeal = Number(this.maxHeal ?? config.maxHeal);
    const debounceMs = Number(this.debounce ?? config.debounceMs);
    const timeoutSeconds = Number(this.timeout ?? config.kaneTimeout);
    const enableHeal = !this.noHeal;

    console.log(`[kiro-heal] watching ${repoRoot}`);
    console.log(`[kiro-heal] test: ${testFile}`);
    console.log(`[kiro-heal] heal target: ${healTarget}`);
    console.log(`[kiro-heal] heal: ${enableHeal ? 'on' : 'off'}`);

    let running = false;
    let pending = false;
    let debounceTimer = null;
    let lastChangedFile = path.isAbsolute(healTarget)
      ? healTarget
      : path.join(repoRoot, healTarget);

    const runOnce = async () => {
      if (running) {
        pending = true;
        return;
      }
      running = true;

      try {
        const runTest = () =>
          runKaneTest({
            testFile,
            cwd: repoRoot,
            timeoutSeconds,
            onEvent: logKaneEvent,
          });

        if (enableHeal) {
          const outcome = await healLoop({
            repoRoot,
            maxHealAttempts: maxHeal,
            runTest,
            resolveTarget: async () => lastChangedFile,
          });
          if (!outcome.passed) process.exitCode = 1;
        } else {
          const result = await runTest();
          if (result.outcome !== 'passed') process.exitCode = 1;
        }
      } catch (err) {
        console.error(`[kiro-heal] error: ${err.message}`);
        process.exitCode = 2;
      } finally {
        running = false;
        if (pending) {
          pending = false;
          void runOnce();
        }
      }
    };

    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runOnce();
      }, debounceMs);
    };

    const watcher = chokidar.watch(repoRoot, {
      ignored: [
        /(^|[/\\])\../,
        '**/node_modules/**',
        '**/.git/**',
        '**/.next/**',
        '**/output-*/**',
        '**/.testmuai/**',
        '**/.kiro-heal/**',
        '**/package-lock.json',
      ],
      ignoreInitial: true,
    });

    const onFileEvent = (filePath) => {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
      if (/\.(tsx|jsx|ts|js|vue|svelte|html)$/i.test(abs)) {
        if (abs.includes('demo/public') || abs.includes('src/') || abs.includes('app/')) {
          lastChangedFile = abs;
        }

        // Immediate syntax/runtime validation on JS/TS files
        if (/\.(js|ts|mjs|cjs)$/i.test(abs)) {
          syntaxHealPipeline({ filePath: abs, repoRoot }).then((result) => {
            if (result.healed) {
              console.log(`[kiro-heal:syntax] auto-healed ${path.relative(repoRoot, abs)}`);
              if (result.pr) {
                console.log(`[kiro-heal:syntax] PR created: ${result.pr.html_url}`);
              }
            }
          }).catch((err) => {
            console.error(`[kiro-heal:syntax] error: ${err.message}`);
          });
        }
      }
      schedule();
    };

    watcher.on('add', onFileEvent);
    watcher.on('change', onFileEvent);
    watcher.on('unlink', onFileEvent);

    await runOnce();
    await new Promise(() => {});
  }
}

class RunCommand extends Command {
  static paths = [['run']];

  test = Option.String('--test', { required: false });
  dir = Option.String('--dir', { required: false });
  target = Option.String('--target', { required: false });
  maxHeal = Option.String('--max-heal', { required: false });
  timeout = Option.String('--timeout', { required: false });
  noHeal = Option.Boolean('--no-heal', { required: false });
  skipKaneCheck = Option.Boolean('--skip-kane-check', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    if (this.maxHeal) config.maxHeal = Number(this.maxHeal);
    if (this.timeout) config.kaneTimeout = Number(this.timeout);

    const outcome = await runPipeline({
      repoRoot,
      config,
      enableHeal: !this.noHeal,
      checkKane: !this.skipKaneCheck,
      targetOverride: this.target
        ? path.isAbsolute(this.target)
          ? this.target
          : path.join(repoRoot, this.target)
        : undefined,
    });

    process.exit(outcome.passed ? 0 : 1);
  }
}

class ScanCommand extends Command {
  static paths = [['scan']];

  dir = Option.String('--dir', { required: false });
  out = Option.String('--out', { required: false });
  baseUrl = Option.String('--base-url', { required: false });
  llm = Option.Boolean('--llm', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    const outputPath = this.out ?? config.testFile;
    const baseUrl = this.baseUrl ?? config.baseUrl;

    const { outputPath: written, routes } = await scaffoldTest({
      repoRoot,
      outputPath,
      baseUrl,
      useLlm: Boolean(this.llm),
    });

    console.log(`[kiro-heal] scaffolded ${written}`);
    console.log(`[kiro-heal] routes: ${routes.length}`);
    for (const r of routes) {
      console.log(`  ${r.route} → ${r.file}`);
    }
  }
}

class GithubServeCommand extends Command {
  static paths = [['github', 'serve']];

  port = Option.String('--port', { required: false });

  async execute() {
    const config = await loadGitHubConfig();
    assertWebhookServerReady(config);
    const port = this.port ? Number(this.port) : config.port;
    await startGitHubWebhookServer({ port });
  }
}

class GithubVerifyCommand extends Command {
  static paths = [['github', 'verify']];

  repo = Option.String('--repo', { required: false });
  owner = Option.String('--owner', { required: false });
  name = Option.String('--name', { required: false });
  installationId = Option.String('--installation-id', { required: false });
  ref = Option.String('--ref', { required: false });
  noPr = Option.Boolean('--no-pr', { required: false });

  async execute() {
    let owner = this.owner;
    let name = this.name;

    if (this.repo?.includes('/')) {
      [owner, name] = this.repo.split('/');
    }

    if (!owner || !name) {
      console.error('Usage: kiro-heal github verify --repo owner/name [--installation-id N]');
      process.exit(2);
    }

    const config = await loadGitHubConfig();
    assertGitHubAppReady(config);

    const result = await verifyGitHubRepository({
      owner,
      repo: name,
      installationId: this.installationId ? Number(this.installationId) : undefined,
      ref: this.ref,
      openPr: !this.noPr,
    });

    console.log(`[kiro-heal:github] passed=${result.passed} heals=${result.healCount}`);
    if (result.prUrl) console.log(`[kiro-heal:github] ${result.prUrl}`);
    process.exit(result.passed ? 0 : 1);
  }
}

cli.register(Builtins.HelpCommand);
cli.register(InitCommand);
cli.register(StartCommand);
cli.register(RunCommand);
cli.register(WatchCommand);
cli.register(ScanCommand);
cli.register(GithubServeCommand);
cli.register(GithubVerifyCommand);

cli.runExit(process.argv.slice(2));