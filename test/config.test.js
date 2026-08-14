import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';

describe('config', () => {
  it('does not inject demo regressions by default', () => {
    assert.equal(DEFAULT_CONFIG.demoBroken, false);
  });

  it('keeps demoBroken false when .kiro-heal.json omits the field', async () => {
    const prev = process.env.KIRO_HEAL_DEMO_BROKEN;
    delete process.env.KIRO_HEAL_DEMO_BROKEN;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-heal-config-'));
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

  it('honors KIRO_HEAL_DEMO_BROKEN=1', async () => {
    const prev = process.env.KIRO_HEAL_DEMO_BROKEN;
    process.env.KIRO_HEAL_DEMO_BROKEN = '1';
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-heal-config-'));
    try {
      const config = await loadConfig(dir);
      assert.equal(config.demoBroken, true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.KIRO_HEAL_DEMO_BROKEN;
      else process.env.KIRO_HEAL_DEMO_BROKEN = prev;
    }
  });
});
