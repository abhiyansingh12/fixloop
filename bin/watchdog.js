#!/usr/bin/env node
/**
 * kiro-heal watchdog — monitors project files for syntax errors and self-heals them.
 *
 * Runs as a separate process so it can heal files that would otherwise
 * crash the main kiro-heal watcher.
 *
 * Usage:
 *   node bin/watchdog.js [--dir /path/to/project]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal chokidar import — watchdog must stay lean
import chokidar from 'chokidar';
import { loadEnvFile } from '../src/env.js';
import { shouldOpenAutomatedPr } from '../src/policy.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const repoRoot = path.resolve(process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : path.join(__dirname, '..'));

const MAX_HEAL_ATTEMPTS = 3;
const DEBOUNCE_MS = 800;

async function loadEnv() {
  await loadEnvFile(path.join(repoRoot, '.env'));
}

// ─── Syntax Check ────────────────────────────────────────────────────────────

function checkSyntax(filePath) {
  return new Promise((resolve) => {
    const child = spawn('node', ['--check', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', () => resolve({ valid: false, error: 'Cannot spawn node' }));
    child.on('close', (code) => {
      resolve(code === 0
        ? { valid: true, error: null }
        : { valid: false, error: stderr.trim() });
    });
  });
}

// ─── Local Pattern Fixes ─────────────────────────────────────────────────────

function tryLocalFix(source, errorOutput, filePath) {
  // Pattern 1: Undefined function (typo) — e.g., repoRootFromdone → repoRootFrom
  const refError = errorOutput.match(/ReferenceError: (\w+) is not defined/);
  if (refError) {
    const badName = refError[1];
    const funcDefs = [...source.matchAll(/function\s+(\w+)/g)].map(m => m[1]);
    const constDefs = [...source.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g)].map(m => m[1]);
    const allDefs = [...funcDefs, ...constDefs];

    for (const def of allDefs) {
      if (badName.startsWith(def) && badName.length > def.length) {
        const regex = new RegExp(`\\b${escapeRegex(badName)}\\b`, 'g');
        const fixed = source.replace(regex, def);
        if (fixed !== source) {
          console.log(`[watchdog] local fix: "${badName}" → "${def}"`);
          return fixed;
        }
      }
      if (def.startsWith(badName.slice(0, Math.max(4, badName.length - 3)))) {
        const regex = new RegExp(`\\b${escapeRegex(badName)}\\b`, 'g');
        const fixed = source.replace(regex, def);
        if (fixed !== source) {
          console.log(`[watchdog] local fix: "${badName}" → "${def}"`);
          return fixed;
        }
      }
    }
  }

  // Pattern 2: SyntaxError with missing parenthesis
  if (errorOutput.includes('SyntaxError') && errorOutput.includes('missing')) {
    // Try to find unbalanced parens on the error line
    const lineMatch = errorOutput.match(/:(\d+)/);
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1], 10) - 1;
      const lines = source.split('\n');
      if (lineNum >= 0 && lineNum < lines.length) {
        const line = lines[lineNum];
        const opens = (line.match(/\(/g) || []).length;
        const closes = (line.match(/\)/g) || []).length;
        if (opens > closes) {
          lines[lineNum] = line + ')'.repeat(opens - closes);
          console.log(`[watchdog] local fix: added missing ')' on line ${lineNum + 1}`);
          return lines.join('\n');
        }
      }
    }
  }

  // Pattern 3: Unexpected token — missing closing bracket
  if (errorOutput.includes('SyntaxError')) {
    const opens = (source.match(/\{/g) || []).length;
    const closes = (source.match(/\}/g) || []).length;
    if (opens > closes) {
      const fixed = source + '\n' + '}'.repeat(opens - closes) + '\n';
      console.log(`[watchdog] local fix: added ${opens - closes} missing '}'`);
      return fixed;
    }
  }

  return null;
}

// ─── LLM Heal Fallback ──────────────────────────────────────────────────────

async function llmHeal(filePath, source, errorOutput) {
  const apiUrl = process.env.KIRO_HEAL_API_URL;
  const apiKey = process.env.KIRO_HEAL_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiUrl || !apiKey) {
    console.log('[watchdog] no LLM API configured — skipping remote heal');
    return null;
  }

  const model = process.env.KIRO_HEAL_MODEL ?? 'gpt-4o-mini';

  const prompt = `Fix this Node.js file that has an error.

File: ${filePath}

Error:
${errorOutput}

Current code:
\`\`\`javascript
${source}
\`\`\`

Return ONLY the complete corrected file content. No explanations.`;

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a code repair agent. Output only the corrected source file.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      console.error(`[watchdog] LLM API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Extract code from fenced block if present
    const fenced = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    return fenced ? fenced[1].trim() : content.trim();
  } catch (err) {
    console.error(`[watchdog] LLM request failed: ${err.message}`);
    return null;
  }
}

// ─── GitHub PR ───────────────────────────────────────────────────────────────

async function createPR(filePath, correctedCode, errorOutput) {
  if (!shouldOpenAutomatedPr()) {
    console.log('[watchdog] KIRO_HEAL_OPEN_PR is not 1 — skipping PR');
    return null;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    console.log('[watchdog] GitHub credentials not set — skipping PR');
    return null;
  }

  // Dynamic import to avoid crashing if @octokit/rest isn't installed
  let Octokit;
  try {
    const mod = await import('@octokit/rest');
    Octokit = mod.Octokit;
  } catch {
    console.log('[watchdog] @octokit/rest not available — skipping PR');
    return null;
  }

  const octokit = new Octokit({ auth: token });
  const branchName = 'kiro-heal/auto-fix';
  const relPath = path.relative(repoRoot, filePath);

  try {
    // Get base branch SHA
    const { data: refs } = await octokit.git.listMatchingRefs({ owner, repo, ref: 'heads/main' });
    if (!refs.length) {
      console.error('[watchdog] PR failed: main branch not found');
      return null;
    }
    const baseSha = refs[0].object.sha;

    // Create branch if missing
    try {
      await octokit.git.createRef({
        owner, repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });
    } catch (err) {
      if (err.status !== 422) throw err;
    }

    // Get existing file SHA
    let fileSha;
    try {
      const { data: fileData } = await octokit.repos.getContent({
        owner, repo, path: relPath, ref: branchName,
      });
      if (!Array.isArray(fileData) && fileData.sha) fileSha = fileData.sha;
    } catch { /* new file */ }

    // Commit the fix
    await octokit.repos.createOrUpdateFileContents({
      owner, repo,
      path: relPath,
      message: `🤖 watchdog: auto-fix syntax/runtime error in ${relPath}`,
      content: Buffer.from(correctedCode, 'utf8').toString('base64'),
      branch: branchName,
      ...(fileSha ? { sha: fileSha } : {}),
    });

    // Open PR
    const { data: pr } = await octokit.pulls.create({
      owner, repo,
      title: `chore(kiro-heal): watchdog auto-fix ${relPath}`,
      head: branchName,
      base: 'main',
      body: [
        '### kiro-heal watchdog — automatic error fix',
        '',
        `**File:** \`${relPath}\``,
        '**Status:** Healed ✅',
        '',
        '**Original Error:**',
        '```',
        errorOutput.slice(0, 1000),
        '```',
        '',
        '*This fix was applied automatically by the kiro-heal watchdog. Set KIRO_HEAL_OPEN_PR=1 to enable PRs.*',
      ].join('\n'),
    });

    console.log(`[watchdog] ✓ PR created: ${pr.html_url}`);
    return pr;
  } catch (err) {
    console.error(`[watchdog] PR creation failed: ${err.message}`);
    return null;
  }
}

// ─── Main Heal Flow ──────────────────────────────────────────────────────────

const healingInProgress = new Set();
const debounceTimers = new Map();

async function healFile(filePath) {
  if (healingInProgress.has(filePath)) return;
  healingInProgress.add(filePath);

  try {
    // Check syntax
    const result = await checkSyntax(filePath);
    if (result.valid) return; // File is fine

    console.log(`\n[watchdog] ⚠ Error detected in ${path.relative(repoRoot, filePath)}`);
    console.log(`[watchdog] ${result.error.split('\n').slice(0, 3).join('\n')}`);

    let source = await fs.readFile(filePath, 'utf8');
    let errorOutput = result.error;

    for (let attempt = 1; attempt <= MAX_HEAL_ATTEMPTS; attempt++) {
      console.log(`[watchdog] heal attempt ${attempt}/${MAX_HEAL_ATTEMPTS}…`);

      // Try local fix first
      let fixedCode = tryLocalFix(source, errorOutput, filePath);

      // Fall back to LLM
      if (!fixedCode) {
        fixedCode = await llmHeal(filePath, source, errorOutput);
      }

      if (!fixedCode) {
        console.error('[watchdog] ✗ no fix available');
        break;
      }

      // Write the fix
      await fs.writeFile(filePath, fixedCode, 'utf8');

      // Re-check
      const recheck = await checkSyntax(filePath);
      if (recheck.valid) {
        console.log(`[watchdog] ✓ ${path.relative(repoRoot, filePath)} healed!`);

        // Open PR
        await createPR(filePath, fixedCode, errorOutput);
        return;
      }

      // Update for next attempt
      source = fixedCode;
      errorOutput = recheck.error;
      console.log(`[watchdog] still broken: ${recheck.error.split('\n')[0]}`);
    }

    console.error(`[watchdog] ✗ could not heal ${path.relative(repoRoot, filePath)} after ${MAX_HEAL_ATTEMPTS} attempts`);
  } finally {
    healingInProgress.delete(filePath);
  }
}

function scheduleHeal(filePath) {
  if (debounceTimers.has(filePath)) {
    clearTimeout(debounceTimers.get(filePath));
  }
  debounceTimers.set(filePath, setTimeout(() => {
    debounceTimers.delete(filePath);
    healFile(filePath).catch(err => {
      console.error(`[watchdog] unexpected error: ${err.message}`);
      healingInProgress.delete(filePath);
    });
  }, DEBOUNCE_MS));
}

// ─── Start Watching ──────────────────────────────────────────────────────────

async function main() {
  await loadEnv();

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   kiro-heal watchdog — self-healing guard        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Watching: ${repoRoot.slice(-38).padEnd(38)}║`);
  console.log('║  Mode: syntax + runtime error detection         ║');
  console.log('║  Heal: local patterns → LLM fallback → PR      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('[watchdog] waiting for file changes…\n');

  const watcher = chokidar.watch(repoRoot, {
    ignored: [
      /(^|[/\\])\../,
      '**/node_modules/**',
      '**/.git/**',
      '**/package-lock.json',
      '**/dist/**',
      '**/build/**',
    ],
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const onFile = (filePath) => {
    // Only process JS/TS files
    if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(filePath)) return;
    // Don't heal ourselves (prevent infinite loop)
    if (path.resolve(filePath) === path.resolve(__filename)) return;
    scheduleHeal(filePath);
  };

  watcher.on('add', onFile);
  watcher.on('change', onFile);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((err) => {
  console.error(`[watchdog] fatal: ${err.message}`);
  process.exit(1);
});
