import { spawn } from 'node:child_process';
import ndjson from 'ndjson';
import { ingestEvent, finalizeAccumulator, createAccumulator } from './parser.js';
import { simulateKaneRun, isKaneAuthenticated } from './simulator.js';

const DEFAULT_KANE_BIN = 'kane-cli';

let kaneAuthCache = /** @type {boolean|null} */ (null);

/**
 * @typedef {object} RunOptions
 * @property {string} testFile
 * @property {string} [cwd]
 * @property {string} [kaneBin]
 * @property {boolean} [headless]
 * @property {boolean} [agent]
 * @property {number} [timeoutSeconds]
 * @property {(obj: object) => void} [onEvent]
 * @property {(chunk: string, stream: 'stdout'|'stderr') => void} [onRaw]
 */

/**
 * Spawn Kane CLI testmd run --agent --headless; parse NDJSON via ndjson stream.
 * @param {RunOptions} options
 */
export async function shouldUseSimulator(kaneBin = process.env.KANE_CLI_BIN ?? DEFAULT_KANE_BIN) {
  if (process.env.KIRO_HEAL_SIMULATE_KANE === '1') return true;
  if (process.env.KIRO_HEAL_SIMULATE_KANE === '0') return false;
  if (kaneAuthCache !== null) return !kaneAuthCache;
  kaneAuthCache = await isKaneAuthenticated(kaneBin);
  if (!kaneAuthCache) {
    console.log('[kiro-heal] Kane CLI not authenticated — using offline simulator (set KIRO_HEAL_SIMULATE_KANE=0 to disable)');
  }
  return !kaneAuthCache;
}

export async function runKaneTest(options) {
  const {
    testFile,
    cwd = process.cwd(),
    kaneBin = process.env.KANE_CLI_BIN ?? DEFAULT_KANE_BIN,
    headless = true,
    agent = true,
    timeoutSeconds,
    onEvent,
    onRaw,
  } = options;

  if (await shouldUseSimulator(kaneBin)) {
    return simulateKaneRun({ cwd, onEvent });
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
      if (process.env.KIRO_HEAL_LOG_STDERR === '1') {
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
      `[kiro-heal] ${icon} run_end: ${event.status} — ${event.summary ?? event.reason ?? ''}`,
    );
    return;
  }

  if (typeof event.step === 'number') {
    const icon = event.status === 'passed' ? '·' : '!';
    console.log(`[kiro-heal] ${icon} step ${event.step} ${event.status}: ${event.remark ?? ''}`);
  }
}
