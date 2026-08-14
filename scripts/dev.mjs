#!/usr/bin/env node
/**
 * Full-stack dev: demo server + kiro-heal start (scan, E2E heal loop, watch).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const child = spawn('node', ['bin/kiro-heal.js', 'start', '--broken'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    KIRO_HEAL_PROVIDER: process.env.KIRO_HEAL_PROVIDER ?? 'auto',
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
