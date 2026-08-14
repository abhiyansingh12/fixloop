#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', 'test-results', 'playwright-report']);

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, acc);
    else if (/\.(js|mjs)$/.test(entry.name)) acc.push(abs);
  }
  return acc;
}

const files = await walk(root);
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    process.stderr.write(r.stderr || `${file} failed\n`);
  }
}
if (failed) {
  console.error(`[lint] ${failed} file(s) failed node --check`);
  process.exit(1);
}
console.log(`[lint] ${files.length} files ok`);
