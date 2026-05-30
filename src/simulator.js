import fs from 'node:fs/promises';
import path from 'node:path';
import { ingestEvent, finalizeAccumulator, createAccumulator } from './parser.js';

/**
 * Offline Kane NDJSON simulator — reads heal target to decide pass/fail.
 * @param {object} options
 * @param {string} options.cwd
 * @param {(obj: object) => void} [options.onEvent]
 */
export async function simulateKaneRun(options) {
  const { cwd, onEvent } = options;
  const targetRel =
    process.env.KIRO_HEAL_TARGET ?? 'demo/public/js/main.js';
  const targetPath = path.join(cwd, targetRel);

  let source = '';
  try {
    source = await fs.readFile(targetPath, 'utf8');
  } catch {
    source = '';
  }

  const isBroken =
    source.includes('cta-primary-broken') ||
    source.includes('HEAL_BROKEN') ||
    !source.includes('getElementById(\'cta-primary\')') &&
      !source.includes('getElementById("cta-primary")');

  const state = createAccumulator();

  const emit = (obj) => {
    ingestEvent(state, obj);
    onEvent?.(obj);
  };

  await delay(300);
  emit({ step: 1, status: 'passed', remark: 'Opened http://localhost:3000' });
  await delay(200);
  emit({ step: 2, status: 'passed', remark: 'Primary navigation visible' });
  await delay(200);

  if (isBroken) {
    emit({
      step: 3,
      status: 'failed',
      remark: 'Get started button did not update status — click handler not wired',
    });
    await delay(150);
    emit({
      type: 'run_end',
      status: 'failed',
      summary: 'CTA interaction failed — element selector or handler regression',
      reason: 'Step 3 failed',
      duration: 2.1,
    });
    return { ...finalizeAccumulator(state, 1), exitCode: 1 };
  }

  emit({ step: 3, status: 'passed', remark: 'Get started updated status banner' });
  await delay(150);
  emit({
    type: 'run_end',
    status: 'passed',
    summary: 'Smoke flow passed — home, nav, and CTA verified',
    reason: 'Objective completed',
    duration: 2.4,
  });
  return { ...finalizeAccumulator(state, 0), exitCode: 0 };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} [kaneBin]
 */
export async function isKaneAuthenticated(kaneBin = 'kane-cli') {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(kaneBin, ['whoami'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      resolve(code === 0 && !/not logged in/i.test(out));
    });
  });
}
