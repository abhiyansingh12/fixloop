import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('npm pack', () => {
  it('ships the Action, CLI, and src — not maintainer docs or examples', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_loglevel: 'error' }
    });
    const jsonStart = out.indexOf('[');
    const jsonEnd = out.lastIndexOf(']');
    assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, 'npm pack --json should print an array');
    const packed = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
    const files = packed[0].files.map((f) => f.path).sort();
    assert.ok(files.includes('action.yml'));
    assert.ok(files.includes('bin/fixloop.js'));
    assert.ok(files.includes('src/pipeline.js'));
    assert.ok(files.includes('templates/github/fixloop.yml'));
    assert.equal(files.some((f) => f.startsWith('docs/')), false);
    assert.equal(files.some((f) => f.startsWith('examples/')), false);
    assert.equal(files.some((f) => f.startsWith('test/')), false);
  });

  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.exports['.'].import, './src/index.js');
    assert.equal(pkg.types, './index.d.ts');
  });
});
