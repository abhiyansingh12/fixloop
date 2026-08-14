import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { extractJsonDocument, parsePlaywrightJson } from './playwright-report.js';
import { env } from './flags.js';

export { parsePlaywrightJson, extractJsonDocument } from './playwright-report.js';

function splitCommand(command) {
  const raw = String(command ?? 'npx playwright test').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  return { bin: parts[0] ?? 'npx', args: parts.slice(1) };
}

/**
 * @param {string} cwd
 */
export function playwrightInstalled(cwd) {
  return (
    fs.existsSync(path.join(cwd, 'node_modules', '@playwright', 'test')) ||
    fs.existsSync(path.join(cwd, 'node_modules', 'playwright'))
  );
}

/**
 * Run the same Playwright command the user already uses, forcing a JSON report.
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} [opts.command]
 * @param {string} [opts.reportPath]
 */
export async function runPlaywright(opts) {
  const cwd = opts.cwd;
  const reportPath =
    opts.reportPath ??
    env('PLAYWRIGHT_REPORT') ??
    path.join(cwd, 'test-results', 'fixloop.json');

  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });

  if (opts.reportOnly) {
    const raw = await fsPromises.readFile(reportPath, 'utf8');
    const json = JSON.parse(raw);
    return parsePlaywrightJson(json);
  }

  const { bin, args } = splitCommand(opts.command ?? env('PLAYWRIGHT_COMMAND', 'npx playwright test'));
  if (!args.some((a) => String(a).includes('reporter'))) {
    args.push('--reporter=json');
  }

  const result = await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, PLAYWRIGHT_HTML_OPEN: 'never' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', (err) => {
      reject(
        new Error(
          `Failed to spawn Playwright (${bin}). Install @playwright/test in this repo.\n${err.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

  let json = extractJsonDocument(result.stdout);
  if (!json) {
    try {
      json = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
    } catch {
      json = null;
    }
  } else {
    await fsPromises.writeFile(reportPath, JSON.stringify(json, null, 2), 'utf8');
  }

  if (!json) {
    return {
      outcome: 'failed',
      firstFailure: {
        remark: result.stderr.slice(0, 500) || 'Playwright produced no JSON report',
        message: result.stderr.slice(0, 500),
        file: '',
        title: 'playwright',
      },
      rawSummary: result.stderr.slice(0, 500),
      runEnd: { type: 'run_end', status: 'failed', summary: 'no json report' },
      steps: [],
      tests: [],
      oracle: 'playwright',
      events: [],
      exitCode: result.code,
    };
  }

  return { ...parsePlaywrightJson(json), exitCode: result.code };
}
