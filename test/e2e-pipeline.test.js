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
const healTarget = path.join(root, 'demo/public/js/main.js');

describe('e2e pipeline (simulator + local heal)', () => {
  /** @type {import('node:child_process').ChildProcess|null} */
  let server = null;

  before(async () => {
    process.env.KIRO_HEAL_SIMULATE_KANE = '1';
    server = spawn('node', ['demo/server.js'], { cwd: root, stdio: 'ignore' });
    await waitForHttp('http://localhost:3000', 8000);
  });

  after(async () => {
    if (server) server.kill('SIGTERM');
    await fs.writeFile(healTarget, WORKING_MAIN_JS, 'utf8');
  });

  it('scan → fail → heal → pass', async () => {
    const broken = `document.getElementById('cta-primary-broken');`;
    await fs.writeFile(healTarget, `(()=>{${broken}})();`, 'utf8');

    const config = await loadConfig(root);
    config.demoBroken = false;
    config.testFile = '.kiro-heal/smoke.testmd';

    const outcome = await runPipeline({
      repoRoot: root,
      config,
      enableHeal: true,
      checkKane: false,
    });

    assert.equal(outcome.passed, true);
    assert.ok(outcome.healCount >= 1);

    const fixed = await fs.readFile(healTarget, 'utf8');
    assert.ok(fixed.includes('cta-primary'));
    assert.ok(!fixed.includes('cta-primary-broken'));
  });
});
