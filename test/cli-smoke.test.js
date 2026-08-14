import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeGithubOutput } from '../src/github-output.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/fixloop.js');

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

describe('CLI smoke', () => {
  it('prints the package version', async () => {
    const { code, stdout } = await runCli(['-v']);
    assert.equal(code, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  it('prints help with the product rule', async () => {
    const { code, stdout } = await runCli(['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /Only product_regression may write code/);
  });
});

describe('GitHub Action outputs', () => {
  it('appends key=value lines to GITHUB_OUTPUT', async () => {
    const file = path.join(os.tmpdir(), `fixloop-out-${Date.now()}`);
    process.env.GITHUB_OUTPUT = file;
    try {
      writeGithubOutput({ triage: 'product_regression', verified: true, healed: false });
      const text = await fs.readFile(file, 'utf8');
      assert.match(text, /triage=product_regression/);
      assert.match(text, /verified=true/);
      assert.match(text, /healed=false/);
    } finally {
      delete process.env.GITHUB_OUTPUT;
      await fs.unlink(file).catch(() => {});
    }
  });
});
