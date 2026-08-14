import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** npm pack --json prints a value then "npm notice" lines on stdout. */
function parseLeadingJson(text) {
  const iObj = text.indexOf('{');
  const iArr = text.indexOf('[');
  let start = -1;
  if (iArr < 0) start = iObj;
  else if (iObj < 0) start = iArr;
  else start = Math.min(iObj, iArr);
  if (start < 0) {
    throw new Error('npm pack --json produced no JSON');
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error('unterminated JSON from npm pack');
}

describe('npm pack', () => {
  it('ships the Action, CLI, and src — not maintainer docs or examples', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root,
      encoding: 'utf8'
    });
    const packed = parseLeadingJson(out);
    const entry = Array.isArray(packed) ? packed[0] : packed;
    const files = entry.files.map((f) => f.path).sort();
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
