import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runPipeline, waitForHttp } from '../src/pipeline.js';
import { loadConfig } from '../src/config.js';
import { WORKING_MAIN_JS } from '../src/local-healer.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const healTarget = path.join(root, 'examples/demo/public/js/main.js');

describe('e2e pipeline (fixture oracle + local heal)', () => {
  /** @type {import('node:child_process').ChildProcess|null} */
  let server = null;
  const prevOpen = process.env.FIXLOOP_OPEN_PR;
  const prevSim = process.env.FIXLOOP_SIMULATE;

  before(async () => {
    process.env.FIXLOOP_OPEN_PR = '0';
    process.env.FIXLOOP_SIMULATE = '1';
    process.env.KIRO_HEAL_OPEN_PR = '0';
    server = spawn('node', ['examples/demo/server.js'], { cwd: root, stdio: 'ignore' });
    await waitForHttp('http://localhost:3000', 8000);
  });

  after(async () => {
    if (server) server.kill('SIGTERM');
    await fs.writeFile(healTarget, WORKING_MAIN_JS, 'utf8');
    if (prevOpen === undefined) delete process.env.FIXLOOP_OPEN_PR;
    else process.env.FIXLOOP_OPEN_PR = prevOpen;
    if (prevSim === undefined) delete process.env.FIXLOOP_SIMULATE;
    else process.env.FIXLOOP_SIMULATE = prevSim;
  });

  it('scan → fail → heal → pass', async () => {
    const broken = `document.getElementById('cta-primary-broken');`;
    await fs.writeFile(healTarget, `(()=>{${broken}})();`, 'utf8');

    const config = await loadConfig(root);
    config.demoBroken = false;
    config.oracle = 'fixture';
    config.healTarget = 'examples/demo/public/js/main.js';

    const outcome = await runPipeline({
      repoRoot: root,
      config,
      enableHeal: true,
    });

    assert.equal(outcome.passed, true);
    assert.ok(outcome.healCount >= 1);
    assert.equal(outcome.verified, true);
    assert.equal(outcome.triage.label, 'product_regression');

    const fixed = await fs.readFile(healTarget, 'utf8');
    assert.ok(fixed.includes('cta-primary'));
    assert.ok(!fixed.includes('cta-primary-broken'));
  });
});
