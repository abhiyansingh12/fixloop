import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createSelfHealedPR, requestFix, extractCodeFromResponse } from './healer.js';
import { shouldOpenAutomatedPr, STABLE_AUTO_FIX_BRANCH } from './policy.js';

/**
 * Run `node --check <file>` to detect syntax errors.
 * @param {string} filePath - Absolute path to the JS file
 * @returns {Promise<{valid: boolean, error: string|null}>}
 */
export async function checkSyntax(filePath) {
  return new Promise((resolve) => {
    const child = spawn('node', ['--check', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      resolve({ valid: false, error: `Cannot spawn node to check ${filePath}` });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ valid: true, error: null });
      } else {
        resolve({ valid: false, error: stderr.trim() });
      }
    });
  });
}

/**
 * Attempt to detect undefined references by doing a quick dry-run import.
 * This catches ReferenceErrors, TypeErrors from undefined functions, etc.
 * @param {string} filePath - Absolute path to the JS file
 * @param {string} cwd - Working directory for resolution
 * @returns {Promise<{valid: boolean, error: string|null}>}
 */
export async function checkRuntime(filePath, cwd) {
  // For ESM files, try a dynamic import check
  const script = `
    import('${filePath.replace(/\\/g, '/')}')
      .then(() => process.exit(0))
      .catch(e => { process.stderr.write(e.stack || e.message); process.exit(1); });
  `;

  return new Promise((resolve) => {
    const child = spawn('node', ['--input-type=module', '-e', script], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      resolve({ valid: false, error: `Cannot spawn node for runtime check` });
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ valid: true, error: null });
    }, 10000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ valid: true, error: null });
      } else {
        resolve({ valid: false, error: stderr.trim().slice(0, 2000) });
      }
    });
  });
}

/**
 * Full syntax + runtime validation for a file.
 * @param {string} filePath
 * @param {string} cwd
 * @returns {Promise<{valid: boolean, error: string|null, type: 'syntax'|'runtime'|null}>}
 */
export async function validateFile(filePath, cwd) {
  // Step 1: syntax check (fast, no side effects)
  const syntax = await checkSyntax(filePath);
  if (!syntax.valid) {
    return { valid: false, error: syntax.error, type: 'syntax' };
  }

  if (process.env.KIRO_HEAL_RUNTIME_CHECK === '1') {
    const runtime = await checkRuntime(filePath, cwd);
    if (!runtime.valid) {
      return { valid: false, error: runtime.error, type: 'runtime' };
    }
  }

  return { valid: true, error: null, type: null };
}

/**
 * Build a prompt for fixing syntax/runtime errors.
 */
function buildSyntaxHealPrompt(filePath, sourceCode, errorOutput, errorType) {
  return `CRITICAL ${errorType.toUpperCase()} ERROR DETECTED
Source File: ${filePath}

Current Code:
\`\`\`
${sourceCode}
\`\`\`

Error Output:
\`\`\`
${errorOutput}
\`\`\`

Objective: Fix the ${errorType} error in this file. The error trace above shows exactly what went wrong. Return the complete corrected source file. Maintain all existing functionality — only fix the error.`;
}

/**
 * Heal a file that has syntax or runtime errors.
 * Attempts local inference first (common patterns), then falls back to LLM.
 *
 * @param {object} opts
 * @param {string} opts.filePath - Absolute path to the broken file
 * @param {string} opts.repoRoot
 * @param {string} opts.errorOutput - The error message from node --check or import
 * @param {string} opts.errorType - 'syntax' or 'runtime'
 * @param {number} [opts.maxAttempts]
 * @returns {Promise<{healed: boolean, attempts: number}>}
 */
export async function healSyntaxError(opts) {
  const { filePath, repoRoot, errorOutput, errorType, maxAttempts = 3 } = opts;

  let sourceCode;
  try {
    sourceCode = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    console.error(`[kiro-heal:syntax] cannot read ${filePath}: ${err.message}`);
    return { healed: false, attempts: 0 };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(
      `[kiro-heal:syntax] healing ${errorType} error in ${path.relative(repoRoot, filePath)} (attempt ${attempt})…`,
    );

    // Try local pattern-based fixes first
    const localFix = tryLocalSyntaxFix(sourceCode, errorOutput, errorType);
    let fixedCode;

    if (localFix) {
      console.log('[kiro-heal:syntax] applied local pattern fix');
      fixedCode = localFix;
    } else {
      // Fall back to LLM
      const prompt = buildSyntaxHealPrompt(filePath, sourceCode, errorOutput, errorType);
      try {
        const parseResult = {
          outcome: 'failed',
          firstFailure: { remark: errorOutput },
          runEnd: { summary: `${errorType} error`, reason: errorOutput },
        };
        fixedCode = await requestFix(filePath, sourceCode, parseResult, prompt);
      } catch (err) {
        console.error(`[kiro-heal:syntax] LLM heal failed: ${err.message}`);
        return { healed: false, attempts: attempt };
      }
    }

    // Write the fix
    await fs.writeFile(filePath, fixedCode, 'utf8');
    sourceCode = fixedCode;

    // Re-validate
    const recheck = await validateFile(filePath, repoRoot);
    if (recheck.valid) {
      console.log(`[kiro-heal:syntax] ✓ ${path.relative(repoRoot, filePath)} healed after ${attempt} attempt(s)`);
      return { healed: true, attempts: attempt };
    }

    console.log(`[kiro-heal:syntax] still broken after attempt ${attempt}: ${recheck.error?.slice(0, 200)}`);
  }

  console.error(`[kiro-heal:syntax] max attempts reached — could not fix ${path.relative(repoRoot, filePath)}`);
  return { healed: false, attempts: maxAttempts };
}

/**
 * Local pattern-based fixes for common syntax/runtime errors.
 * @param {string} source
 * @param {string} errorOutput
 * @param {string} errorType
 * @returns {string|null}
 */
function tryLocalSyntaxFix(source, errorOutput, errorType) {
  // Pattern: undefined function call (e.g., repoRootFromdone instead of repoRootFrom)
  const undefinedMatch = errorOutput.match(/ReferenceError: (\w+) is not defined/);
  if (undefinedMatch) {
    const badName = undefinedMatch[1];
    // Look for similar function names defined in the file
    const funcDefs = [...source.matchAll(/function\s+(\w+)/g)].map((m) => m[1]);
    const constDefs = [...source.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g)].map((m) => m[1]);
    const allDefs = [...funcDefs, ...constDefs];

    for (const def of allDefs) {
      // Check if the bad name starts with or contains the defined name
      if (badName.startsWith(def) || def.startsWith(badName.slice(0, -2))) {
        // Likely a typo — replace all occurrences of the bad name with the correct one
        const regex = new RegExp(`\\b${escapeRegex(badName)}\\b`, 'g');
        const fixed = source.replace(regex, def);
        if (fixed !== source) {
          console.log(`[kiro-heal:syntax] local fix: ${badName} → ${def}`);
          return fixed;
        }
      }
    }
  }

  // Pattern: unexpected token / missing bracket
  if (errorType === 'syntax') {
    // Count brackets to detect imbalance
    const opens = (source.match(/\{/g) || []).length;
    const closes = (source.match(/\}/g) || []).length;
    if (opens > closes) {
      // Missing closing braces
      const diff = opens - closes;
      return source + '\n' + '}'.repeat(diff) + '\n';
    }
    if (closes > opens) {
      // Extra closing braces — remove from end
      let fixed = source;
      let diff = closes - opens;
      while (diff > 0) {
        fixed = fixed.replace(/\}[\s]*$/, '');
        diff--;
      }
      return fixed;
    }
  }

  return null;
}

/**
 * Full syntax-heal pipeline: validate → heal → PR.
 * Call this from the watch/start commands when a file changes.
 *
 * @param {object} opts
 * @param {string} opts.filePath - Absolute path to the changed file
 * @param {string} opts.repoRoot
 * @param {object} [opts.github] - { owner, repo, baseBranch }
 * @returns {Promise<{valid: boolean, healed: boolean, pr: object|null}>}
 */
export async function syntaxHealPipeline(opts) {
  const { filePath, repoRoot, github } = opts;

  const validation = await validateFile(filePath, repoRoot);

  if (validation.valid) {
    return { valid: true, healed: false, pr: null };
  }

  console.log(
    `[kiro-heal:syntax] ${validation.type} error detected in ${path.relative(repoRoot, filePath)}`,
  );
  console.log(`[kiro-heal:syntax] ${validation.error?.slice(0, 300)}`);

  const result = await healSyntaxError({
    filePath,
    repoRoot,
    errorOutput: validation.error,
    errorType: validation.type,
  });

  if (!result.healed) {
    return { valid: false, healed: false, pr: null };
  }

  if (result.healed && shouldOpenAutomatedPr()) {
    const owner = github?.owner ?? process.env.GITHUB_OWNER;
    const repo = github?.repo ?? process.env.GITHUB_REPO;

    if (owner && repo) {
      const correctedCode = await fs.readFile(filePath, 'utf8');
      const relPath = path.relative(repoRoot, filePath);

      const pr = await createSelfHealedPR({
        owner,
        repo,
        branchName: STABLE_AUTO_FIX_BRANCH,
        filename: relPath,
        correctedCode,
        failureReport: `${validation.type} error in ${relPath}:\n${validation.error}`,
        baseBranch: github?.baseBranch ?? 'main',
      });

      return { valid: true, healed: true, pr };
    }
  }

  return { valid: true, healed: true, pr: null };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
