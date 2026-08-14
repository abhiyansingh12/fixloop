import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ndjson from 'ndjson';
import { ingestEvent, finalizeAccumulator, createAccumulator } from './parser.js';
import { simulateKaneRun, isKaneAuthenticated } from './simulator.js';
import { envOn } from './flags.js';

const DEFAULT_KANE_BIN = 'kane-cli';

let kaneAuthCache = /** @type {Record<string, boolean>} */ ({});

/**
 * Prefer a local node_modules binary, then PATH, then an explicit env override.
 * @param {string} [cwd]
 * @param {string} [explicit]
 */
export function resolveKaneBin(cwd = process.cwd(), explicit = process.env.KANE_CLI_BIN) {
  if (explicit) return explicit;
  const name = process.platform === 'win32' ? 'kane-cli.cmd' : 'kane-cli';
  const local = path.join(cwd, 'node_modules', '.bin', name);
  if (fs.existsSync(local)) return local;
  return DEFAULT_KANE_BIN;
}

/**
 * @typedef {object} RunOptions
 * @property {string} testFile
 * @property {string} [cwd]
 * @property {string} [kaneBin]
 * @property {boolean} [headless]
 * @property {boolean} [agent]
 * @property {number} [timeoutSeconds]
 * @property {string} [targetRel]
 * @property {string} [fixturePath]
 * @property {(obj: object) => void} [onEvent]
 * @property {(chunk: string, stream: 'stdout'|'stderr') => void} [onRaw]
 */

/**
 * Spawn Kane CLI testmd run --agent --headless; parse NDJSON via ndjson stream.
 * Falls back to the recorded-fixture simulator when Kane is missing or logged out.
 * @param {string} [kaneBin]
 */
export async function shouldUseSimulator(kaneBin = process.env.KANE_CLI_BIN ?? DEFAULT_KANE_BIN) {
  if (envOn('SIMULATE') || envOn('SIMULATE_KANE')) return true;
  if (process.env.FIXLOOP_SIMULATE === '0' || process.env.KIRO_HEAL_SIMULATE_KANE === '0') {
    return false;
  }
  if (kaneAuthCache[kaneBin] !== undefined) return !kaneAuthCache[kaneBin];
  kaneAuthCache[kaneBin] = await isKaneAuthenticated(kaneBin);
  if (!kaneAuthCache[kaneBin]) {
    console.log('[fixloop] Kane CLI not authenticated — using fixture oracle (set FIXLOOP_SIMULATE=0 to disable)');
  }
  return !kaneAuthCache[kaneBin];
}

export async function runKaneTest(options) {
  const {
    testFile,
    cwd = process.cwd(),
    headless = true,
    agent = true,
    timeoutSeconds,
    onEvent,
    onRaw,
    targetRel,
    fixturePath,
  } = options;

  const kaneBin = options.kaneBin ?? resolveKaneBin(cwd);

  if (await shouldUseSimulator(kaneBin)) {
    return simulateKaneRun({ cwd, onEvent, targetRel, fixturePath });
  }

  const args = ['testmd', 'run', testFile];
  if (agent) args.push('--agent');
  if (headless) args.push('--headless');
  if (timeoutSeconds) args.push('--timeout', String(timeoutSeconds));

  return new Promise((resolve, reject) => {
    const child = spawn(kaneBin, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state = createAccumulator();

    const parser = ndjson.parse();
    parser.on('data', (obj) => {
      ingestEvent(state, obj);
      onEvent?.(obj);
    });

    child.stdout.on('data', (chunk) => {
      onRaw?.(chunk.toString(), 'stdout');
      parser.write(chunk);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      onRaw?.(chunk, 'stderr');
      if (envOn('LOG_STDERR')) {
        process.stderr.write(chunk);
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ${kaneBin}: ${err.message}`));
    });

    let exitCode = 1;
    child.on('close', (code) => {
      exitCode = code ?? 1;
      parser.end();
    });

    parser.on('finish', () => {
      const result = finalizeAccumulator(state, exitCode);
      resolve({ ...result, exitCode });
    });

    parser.on('error', (err) => {
      reject(new Error(`NDJSON parse error: ${err.message}`));
    });
  });
}

/**
 * @param {object} event
 */
export function logKaneEvent(event) {
  if (event.type === 'run_end') {
    const icon = event.status === 'passed' ? '✓' : '✗';
    console.log(
      `[fixloop] ${icon} run_end: ${event.status} — ${event.summary ?? event.reason ?? ''}`,
    );
    return;
  }

  if (typeof event.step === 'number') {
    const icon = event.status === 'passed' ? '·' : '!';
    console.log(`[fixloop] ${icon} step ${event.step} ${event.status}: ${event.remark ?? ''}`);
  }
}
