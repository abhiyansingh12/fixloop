import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';

describe('config', () => {
  it('defaults to Playwright and does not inject demo regressions', () => {
    assert.equal(DEFAULT_CONFIG.demoBroken, false);
    assert.equal(DEFAULT_CONFIG.oracle, 'playwright');
    assert.equal(DEFAULT_CONFIG.healTarget, 'src/main.js');
  });

  it('loads .fixloop.json', async () => {
    const prev = process.env.FIXLOOP_DEMO_BROKEN;
    delete process.env.FIXLOOP_DEMO_BROKEN;
    delete process.env.KIRO_HEAL_DEMO_BROKEN;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixloop-config-'));
    await fs.writeFile(
      path.join(dir, '.fixloop.json'),
      JSON.stringify({ baseUrl: 'http://localhost:5173', oracle: 'playwright', healTarget: 'src/main.js' }),
      'utf8',
    );
    try {
      const config = await loadConfig(dir);
      assert.equal(config.demoBroken, false);
      assert.equal(config.oracle, 'playwright');
      assert.equal(config.healTarget, 'src/main.js');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.FIXLOOP_DEMO_BROKEN;
      else process.env.FIXLOOP_DEMO_BROKEN = prev;
    }
  });

  it('still reads legacy .kiro-heal.json', async () => {
    const prev = process.env.KIRO_HEAL_DEMO_BROKEN;
    delete process.env.KIRO_HEAL_DEMO_BROKEN;
    delete process.env.FIXLOOP_DEMO_BROKEN;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixloop-legacy-config-'));
    await fs.writeFile(
      path.join(dir, '.kiro-heal.json'),
      JSON.stringify({ baseUrl: 'http://localhost:3000' }),
      'utf8',
    );
    try {
      const config = await loadConfig(dir);
      assert.equal(config.demoBroken, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.KIRO_HEAL_DEMO_BROKEN;
      else process.env.KIRO_HEAL_DEMO_BROKEN = prev;
    }
  });

  it('honors FIXLOOP_DEMO_BROKEN=1', async () => {
    const prev = process.env.FIXLOOP_DEMO_BROKEN;
    const prevLegacy = process.env.KIRO_HEAL_DEMO_BROKEN;
    process.env.FIXLOOP_DEMO_BROKEN = '1';
    delete process.env.KIRO_HEAL_DEMO_BROKEN;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixloop-config-'));
    try {
      const config = await loadConfig(dir);
      assert.equal(config.demoBroken, true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.FIXLOOP_DEMO_BROKEN;
      else process.env.FIXLOOP_DEMO_BROKEN = prev;
      if (prevLegacy === undefined) delete process.env.KIRO_HEAL_DEMO_BROKEN;
      else process.env.KIRO_HEAL_DEMO_BROKEN = prevLegacy;
    }
  });
});
