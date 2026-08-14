import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlaywrightJson } from './playwright-report.js';

const KANE_BIN = process.env.KANE_BIN || 'kane';

function collectErrors(node, errors = []) {
  if (!node || typeof node !== 'object') return errors;
  if (typeof node.error === 'string' && node.error.trim()) errors.push(node.error);
  if (typeof node.message === 'string' && /error|fail/i.test(node.message)) errors.push(node.message);
  if (Array.isArray(node.errors)) {
    for (const item of node.errors) {
      if (typeof item === 'string') errors.push(item);
      else if (item?.message) errors.push(item.message);
    }
  }
  if (Array.isArray(node.testResults)) {
    for (const result of node.testResults) collectErrors(result, errors);
  }
  if (Array.isArray(node.suites)) {
    for (const suite of node.suites) collectErrors(suite, errors);
  }
  if (Array.isArray(node.tests)) {
    for (const test of node.tests) collectErrors(test, errors);
  }
  return errors;
}

export function parseKaneJson(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const passed = data.passed === true || data.success === true || data.status === 'passed';
  const failed = data.passed === false || data.success === false || data.status === 'failed';
  const errors = collectErrors(data);
  return {
    passed: passed && !failed && errors.length === 0,
    errors,
    raw: data,
  };
}

async function findJsonReports(dir) {
  const found = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(full);
    }
  }
  await walk(dir);
  return found;
}

export async function runKane({ cwd, extraArgs = [] } = {}) {
  const outputDir = await mkdtemp(join(tmpdir(), 'fixloop-kane-'));
  const args = ['run', '--json', `--output=${outputDir}`, ...extraArgs];

  const child = spawn(KANE_BIN, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const reports = await findJsonReports(outputDir);
  let parsed = null;
  for (const file of reports) {
    const raw = await readFile(file, 'utf8');
    try {
      const playwright = parsePlaywrightJson(raw);
      if (playwright.suites.length || playwright.errors.length || typeof playwright.passed === 'boolean') {
        parsed = playwright;
        if (playwright.errors.length || playwright.passed === false) break;
      }
    } catch {
      /* not playwright */
    }
    try {
      parsed = parseKaneJson(raw);
      if (parsed.errors.length || parsed.passed === false) break;
    } catch {
      /* skip */
    }
  }

  if (!parsed) {
    parsed = {
      passed: exitCode === 0,
      errors: exitCode === 0 ? [] : [stderr.trim() || stdout.trim() || `kane exited ${exitCode}`],
      raw: { stdout, stderr, exitCode },
    };
  }

  return {
    ...parsed,
    passed: parsed.passed && exitCode === 0,
    errors: parsed.errors?.length ? parsed.errors : (exitCode === 0 ? [] : [stderr.trim() || `kane exited ${exitCode}`]),
    exitCode,
    stdout,
    stderr,
    outputDir,
    oracle: 'kane',
  };
}
