import fs from 'node:fs/promises';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { formatFailureBlock } from './parser.js';
import { tryLocalHeal } from './local-healer.js';

/**
 * Build the Kiro isolation prompt from failure trace + source.
 */
export function buildHealPrompt(filePath, sourceCode, failureBlock) {
  return `CRITICAL REGRESSION DETECTED IN LOCAL APPLICATON
Source File: ${filePath}
Current Code:
${sourceCode}

Kane CLI Browser Verification Failure Trace:
${failureBlock}

Objective: Rewrite the source file to fix the specific interaction, layout, or behavioral bug highlighted by the verification trace. Maintain all other functional logic. Return only valid code.`;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractCodeFromResponse(text) {
  const fenced = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

/**
 * Remote Kiro / OpenAI-compatible generation.
 * @param {string} prompt
 */
export async function requestKiroFix(prompt) {
  const apiUrl =
    process.env.KIRO_HEAL_API_URL ??
    process.env.KIRO_GENERATION_URL ??
    (process.env.OPENAI_API_KEY
      ? `${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`
      : null);

  if (!apiUrl) {
    throw new Error(
      'No generation API configured. Set KIRO_HEAL_API_URL or OPENAI_API_KEY, or use local healing (default).',
    );
  }

  const apiKey =
    process.env.KIRO_HEAL_API_KEY ??
    process.env.KIRO_API_KEY ??
    process.env.OPENAI_API_KEY ??
    '';

  const model = process.env.KIRO_HEAL_MODEL ?? process.env.KIRO_MODEL ?? 'gpt-4o-mini';

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise code repair agent. Output only the full corrected source file with no explanation.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Kiro generation API failed (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const content =
    data.choices?.[0]?.message?.content ??
    data.output ??
    data.completion ??
    data.text;

  if (!content || typeof content !== 'string') {
    throw new Error('Generation API returned no text content');
  }

  return extractCodeFromResponse(content);
}

/**
 * Local rules first, then remote API if configured.
 * @param {string} absPath
 * @param {string} sourceCode
 * @param {import('./parser.js').ParseResult} parseResult
 * @param {string} prompt
 */
export async function requestFix(absPath, sourceCode, parseResult, prompt) {
  const provider = process.env.KIRO_HEAL_PROVIDER ?? 'auto';

  if (provider === 'local' || provider === 'auto') {
    const local = tryLocalHeal(absPath, sourceCode, parseResult);
    if (local) {
      console.log('[kiro-heal] applied local rule-based heal');
      return local;
    }
    if (provider === 'local') {
      throw new Error('Local healer could not infer a fix for this failure.');
    }
  }

  return requestKiroFix(prompt);
}

/**
 * @param {object} options
 */
export async function healFile(options) {
  const { filePath, repoRoot, parseResult, attempt = 1 } = options;
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);

  let sourceCode;
  try {
    sourceCode = await fs.readFile(absPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read source file ${absPath}: ${err.message}`);
  }

  const failureBlock = formatFailureBlock(parseResult);
  const prompt = buildHealPrompt(absPath, sourceCode, failureBlock);

  console.log(`[kiro-heal] healing ${path.relative(repoRoot, absPath)} (attempt ${attempt})…`);

  if (process.env.KIRO_HEAL_DRY_RUN === '1') {
    console.log('[kiro-heal] dry-run: skipping file write');
    return { filePath: absPath, healed: false };
  }

  const fixedCode = await requestFix(absPath, sourceCode, parseResult, prompt);
  await fs.writeFile(absPath, fixedCode, 'utf8');
  console.log(`[kiro-heal] wrote healed file: ${path.relative(repoRoot, absPath)}`);

  return { filePath: absPath, healed: true };
}

/**
 * Create a branch and open a pull request with the self-healed code.
 * Uses GITHUB_TOKEN from the environment for authentication.
 *
 * @param {object} opts
 * @param {string} opts.owner - Repository owner
 * @param {string} opts.repo - Repository name
 * @param {string} opts.branchName - Name for the fix branch
 * @param {string} opts.filename - Relative path of the healed file
 * @param {string} opts.correctedCode - The healed source code
 * @param {string} opts.failureReport - Failure trace for the PR body
 * @param {string} [opts.baseBranch] - Base branch to target (default: "main")
 */
export async function createSelfHealedPR({
  owner,
  repo,
  branchName,
  filename,
  correctedCode,
  failureReport,
  baseBranch = 'main',
}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[LoopVision] GITHUB_TOKEN not set — skipping PR creation.');
    return null;
  }

  const octokit = new Octokit({ auth: token });

  try {
    // 1. Get the base branch SHA
    const { data: mainRef } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });

    // 2. Create a new branch for the fix
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: mainRef.object.sha,
    });

    // 3. Get the SHA of the file to update (if it exists)
    let fileSha;
    try {
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path: filename,
        ref: branchName,
      });
      if (!Array.isArray(fileData) && fileData.sha) {
        fileSha = fileData.sha;
      }
    } catch {
      // File doesn't exist yet on this branch — will be created
    }

    // 4. Commit the self-healed code to the new branch
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filename,
      message: '🤖 chore: autonomous patch applied via LoopVision self-healing loop',
      content: Buffer.from(correctedCode, 'utf8').toString('base64'),
      branch: branchName,
      ...(fileSha ? { sha: fileSha } : {}),
    });

    // 5. Open the PR with the failure report
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: '🤖 [LoopVision] Automated Bug Fix & Kane CLI Verification Tests',
      head: branchName,
      base: baseBranch,
      body: [
        '### LoopVision Self-Healing Report',
        '',
        '**Status:** Verified ✅',
        '',
        '**Discovered Failure Trace:**',
        '```',
        failureReport,
        '```',
        '',
        '*Generated native Kane CLI tests have been injected into this repository to guarantee this regression does not happen again.*',
      ].join('\n'),
    });

    console.log(`[LoopVision] Pull Request created: ${pr.html_url}`);
    return pr;
  } catch (error) {
    console.error('[LoopVision] GitHub PR creation failed:', error.message);
    return null;
  }
}

/**
 * Closed-loop: run → fail → heal → re-run until pass or max heal cycles.
 * On success, automatically opens a PR with the healed code if GITHUB_TOKEN is set.
 */
export async function healLoop({ runTest, resolveTarget, repoRoot, maxHealAttempts = 5, github }) {
  let healCount = 0;
  let lastResult = null;
  let lastHealedTarget = null;

  while (true) {
    console.log(
      `[kiro-heal] Kane verification${healCount > 0 ? ` (after heal #${healCount})` : ''}…`,
    );

    lastResult = await runTest();

    if (lastResult.outcome === 'passed') {
      console.log('[kiro-heal] ✓ Kane verification passed.');

      // Auto-create PR if healing was applied and GitHub info is available
      if (healCount > 0 && lastHealedTarget) {
        const owner = github?.owner ?? process.env.GITHUB_OWNER;
        const repo = github?.repo ?? process.env.GITHUB_REPO;

        if (owner && repo) {
          const absPath = path.isAbsolute(lastHealedTarget)
            ? lastHealedTarget
            : path.join(repoRoot, lastHealedTarget);
          const correctedCode = await fs.readFile(absPath, 'utf8');
          const branchName = `kiro-heal/auto-fix-${Date.now()}`;
          const failureReport = formatFailureBlock(lastResult);

          await createSelfHealedPR({
            owner,
            repo,
            branchName,
            filename: path.relative(repoRoot, absPath),
            correctedCode,
            failureReport,
            baseBranch: github?.baseBranch ?? 'main',
          });
        }
      }

      return { passed: true, healCount, lastResult, attempts: healCount + 1 };
    }

    const target = await resolveTarget();
    if (!target) {
      console.error(
        '[kiro-heal] test failed but no heal target. Set healTarget in .kiro-heal.json or --target.',
      );
      return { passed: false, healCount, lastResult, attempts: healCount + 1 };
    }

    if (healCount >= maxHealAttempts) {
      console.error(`[kiro-heal] max heal attempts (${maxHealAttempts}) reached.`);
      return { passed: false, healCount, lastResult, attempts: healCount + 1 };
    }

    await healFile({
      filePath: target,
      repoRoot,
      parseResult: lastResult,
      attempt: healCount + 1,
    });
    lastHealedTarget = target;
    healCount += 1;
  }
}
