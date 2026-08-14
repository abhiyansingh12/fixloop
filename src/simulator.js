import fs from 'node:fs/promises';
import path from 'node:path';
import { ingestEvent, finalizeAccumulator, createAccumulator } from './parser.js';
import { evaluateFixture, loadFixture } from './fixture.js';

/**
 * Offline Kane NDJSON simulator — uses a recorded fixture, not a hardcoded demo CTA.
 * @param {object} options
 * @param {string} options.cwd
 * @param {(obj: object) => void} [options.onEvent]
 * @param {string} [options.targetRel]
 * @param {string} [options.fixturePath]
 */
export async function simulateKaneRun(options) {
  const { cwd, onEvent, targetRel, fixturePath } = options;
  const fixture = await loadFixture(cwd, fixturePath);
  const rel = targetRel ?? process.env.FIXLOOP_TARGET ?? process.env.KIRO_HEAL_TARGET ?? fixture.target ?? 'examples/demo/public/js/main.js';
  const targetPath = path.isAbsolute(rel) ? rel : path.join(cwd, rel);

  let source = '';
  try {
    source = await fs.readFile(targetPath, 'utf8');
  } catch {
    source = '';
  }

  const verdict = evaluateFixture(source, fixture);
  const steps = fixture.steps?.length
    ? fixture.steps
    : [
        { remark: 'Opened application', pass: true },
        { remark: 'Primary navigation visible', pass: true },
        { remark: 'Primary interaction', failRemark: 'Interaction failed' },
      ];

  const state = createAccumulator();
  const emit = (obj) => {
    ingestEvent(state, obj);
    onEvent?.(obj);
  };

  await delay(80);
  let failed = false;
  let stepNum = 1;
  for (const step of steps) {
    const shouldFail = Boolean(verdict.broken && step.failRemark);
    if (shouldFail) {
      emit({
        step: stepNum,
        status: 'failed',
        remark: step.failRemark,
      });
      failed = true;
      break;
    }
    emit({
      step: stepNum,
      status: 'passed',
      remark: step.remark,
    });
    stepNum += 1;
    await delay(40);
  }

  if (failed || verdict.broken) {
    emit({
      type: 'run_end',
      status: 'failed',
      summary: verdict.reason,
      reason: 'Fixture checks failed',
      duration: 0.4,
    });
    return { ...finalizeAccumulator(state, 1), exitCode: 1 };
  }

  emit({
    type: 'run_end',
    status: 'passed',
    summary: 'Smoke flow passed — fixture checks succeeded',
    reason: 'Objective completed',
    duration: 0.4,
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
