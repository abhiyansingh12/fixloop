import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from '../src/env.js';

describe('loadEnvFile', () => {
  it('loads unset keys and does not override existing env', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-heal-env-'));
    const envPath = path.join(dir, '.env');
    await fs.writeFile(
      envPath,
      ['# comment', 'KIRO_HEAL_OPEN_PR=1', 'EXISTING_KEY=from-file', 'QUOTED="hello world"', ''].join(
        '\n',
      ),
      'utf8',
    );

    process.env.EXISTING_KEY = 'from-process';
    delete process.env.KIRO_HEAL_OPEN_PR;
    delete process.env.QUOTED;

    try {
      await loadEnvFile(envPath);
      assert.equal(process.env.KIRO_HEAL_OPEN_PR, '1');
      assert.equal(process.env.EXISTING_KEY, 'from-process');
      assert.equal(process.env.QUOTED, 'hello world');
    } finally {
      delete process.env.KIRO_HEAL_OPEN_PR;
      delete process.env.QUOTED;
      delete process.env.EXISTING_KEY;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
