#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

console.error('[fixloop] `kiro-heal` was renamed to `fixloop`. Forwarding…');
const bin = fileURLToPath(new URL('./fixloop.js', import.meta.url));
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
