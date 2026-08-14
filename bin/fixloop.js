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
import { envOn } from '../src/flags.js';

const cli = new Cli({
  binaryLabel: 'fixloop',
  binaryName: 'fixloop',
  binaryVersion: '1.0.0',
});

function repoRootFrom(dir) {
  return path.resolve(dir ?? process.cwd());
}

class InitCommand extends Command {
  static paths = [['init']];
  dir = Option.String('--dir', { required: false });
  baseUrl = Option.String('--base-url', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    if (this.baseUrl) config.baseUrl = this.baseUrl;
    console.log('[fixloop] init: scan routes');
    const { testFile, routes } = await initProject(repoRoot, config);
    console.log(`[fixloop] test file: ${testFile}`);
    console.log(`[fixloop] routes: ${routes.length}`);
    for (const r of routes) console.log(`  ${r.route} → ${r.file}`);
    console.log(`[fixloop] heal target: ${config.healTarget}`);
    console.log(`[fixloop] oracle: ${config.oracle}`);
  }
}

class RunCommand extends Command {
  static paths = [['run']];
  dir = Option.String('--dir', { required: false });
  command = Option.String('--command', { required: false });
  noHeal = Option.Boolean('--no-heal', { required: false });
  target = Option.String('--target', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    if (this.command) config.playwrightCommand = this.command;
    const outcome = await runPipeline({
      repoRoot,
      config,
      enableHeal: !this.noHeal,
      targetOverride: this.target,
    });
    process.exit(outcome.passed || outcome.triage?.label === 'test_defect' || outcome.triage?.label === 'flake' ? 0 : 1);
  }
}

class CiCommand extends Command {
  static paths = [['ci']];
  dir = Option.String('--dir', { required: false });
  command = Option.String('--command', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    config.oracle = config.oracle === 'kane' ? 'kane' : 'playwright';
    if (this.command) config.playwrightCommand = this.command;
    console.log('[fixloop] ci: triage → patch only on product_regression → re-run → draft PR if green');
    const outcome = await runPipeline({
      repoRoot,
      config,
      enableHeal: true,
      issueNumber: process.env.FIXLOOP_ISSUE_NUMBER || process.env.GITHUB_PR_NUMBER,
    });
    if (outcome.triage?.label === 'test_defect') {
      console.log('[fixloop] update the test, I will not.');
      process.exit(0);
    }
    if (outcome.verified) process.exit(0);
    process.exit(1);
  }
}

class WatchCommand extends Command {
  static paths = [['watch']];
  dir = Option.String('--dir', { required: false });
  debounce = Option.String('--debounce', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    const debounceMs = Number(this.debounce ?? config.debounceMs);
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
    const watcher = chokidar.watch(repoRoot, {
      ignored: [/(^|[/\\])\../, '**/node_modules/**', '**/.git/**', '**/test-results/**', '**/playwright-report/**'],
      ignoreInitial: true,
    });
    watcher.on('all', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void runOnce(), debounceMs);
    });
    await runOnce();
    await new Promise(() => {});
  }
}

class ScanCommand extends Command {
  static paths = [['scan']];
  dir = Option.String('--dir', { required: false });
  out = Option.String('--out', { required: false });
  baseUrl = Option.String('--base-url', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const config = await loadConfig(repoRoot);
    const { outputPath, routes } = await scaffoldTest({
      repoRoot,
      outputPath: this.out ?? config.testFile,
      baseUrl: this.baseUrl ?? config.baseUrl,
    });
    console.log(`[fixloop] scaffolded ${outputPath} (${routes.length} routes)`);
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
    if (this.repo?.includes('/')) [owner, name] = this.repo.split('/');
    if (!owner || !name) {
      console.error('Usage: fixloop github verify --repo owner/name');
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
    console.log(`[fixloop:github] passed=${result.passed}`);
    process.exit(result.passed ? 0 : 1);
  }
}

class StartCommand extends Command {
  static paths = [['start']];
  dir = Option.String('--dir', { required: false });
  skipServer = Option.Boolean('--skip-server', { required: false });
  broken = Option.Boolean('--broken', { required: false });

  async execute() {
    const repoRoot = repoRootFrom(this.dir);
    const { config, paths } = await loadProject(repoRoot);
    if (this.broken) config.demoBroken = true;
    if (!this.skipServer && paths.demoServer) {
      spawn('node', [paths.demoServer], { cwd: repoRoot, stdio: 'inherit', env: process.env });
      console.log(`[fixloop] demo server → ${config.baseUrl}`);
      await waitForHttp(config.baseUrl);
    }
    await initProject(repoRoot, config);
    await runPipeline({ repoRoot, config, enableHeal: true });
    const watch = new WatchCommand();
    watch.dir = repoRoot;
    await watch.execute();
  }
}

cli.register(Builtins.HelpCommand);
cli.register(InitCommand);
cli.register(RunCommand);
cli.register(CiCommand);
cli.register(WatchCommand);
cli.register(ScanCommand);
cli.register(StartCommand);
cli.register(GithubServeCommand);
cli.register(GithubVerifyCommand);

await loadEnvFile();
cli.runExit(process.argv.slice(2));
