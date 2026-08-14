import fs from 'node:fs/promises';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { formatFailureBlock } from './parser.js';
import { tryLocalHeal, WORKING_MAIN_JS } from './local-healer.js';
import {
  isValidGitHubRepoName,
  resolveChatCompletionsUrl,
  selectHealBranch,
  STABLE_AUTO_FIX_BRANCH,
} from './policy.js';
import { assertHealPathAllowed, DEFAULT_HEAL_ALLOWLIST } from './allowlist.js';
import { applyHealContent } from './patch.js';

/**
 * Build the repair prompt from failure trace + source.
 */
export function buildHealPrompt(filePath, sourceCode, failureBlock) {
  return `CRITICAL REGRESSION DETECTED IN LOCAL APPLICATION
Source File: ${filePath}

Current Code:
${sourceCode}

Kane / Playwright verification failure trace:
${failureBlock}

Objective: Fix only the application bug. Never edit tests or snapshots.
Prefer a unified diff (--- a/${filePath} / +++ b/${filePath} with @@ hunks).
If a diff is not practical, return the complete corrected file in one fenced code block.
Do not modify unrelated logic, secrets, or files.`;
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
  const apiUrl = resolveChatCompletionsUrl();

  if (!apiUrl) {
    throw new Error(
      'No generation API configured. Set FIXLOOP_API_URL or OPENAI_API_KEY, or use local healing (default).',
    );
  }

  const apiKey =
    process.env.FIXLOOP_API_KEY ??
    process.env.KIRO_HEAL_API_KEY ??
    process.env.KIRO_API_KEY ??
    process.env.OPENAI_API_KEY ??
    '';

  const model = process.env.FIXLOOP_MODEL ?? process.env.KIRO_HEAL_MODEL ?? process.env.KIRO_MODEL ?? 'gpt-4o-mini';

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
            'You are a precise code repair agent. Prefer a unified diff. If you must rewrite, output only the full corrected source file.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Generation API failed (${res.status}): ${errText.slice(0, 500)}`);
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
  const provider = process.env.FIXLOOP_PROVIDER ?? process.env.KIRO_HEAL_PROVIDER ?? 'auto';

  if (provider === 'local' || provider === 'auto') {
    const local = tryLocalHeal(absPath, sourceCode, parseResult);
    if (local) {
      console.log('[fixloop] applied local rule-based heal');
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
  const { filePath, repoRoot, parseResult, attempt = 1, allowlist, healTarget } = options;
  const { abs, rel } = assertHealPathAllowed(
    repoRoot,
    filePath,
    allowlist ?? DEFAULT_HEAL_ALLOWLIST,
    undefined,
    healTarget,
  );

  let sourceCode;
  try {
    sourceCode = await fs.readFile(abs, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read source file ${abs}: ${err.message}`);
  }

  const failureBlock = formatFailureBlock(parseResult);
  const prompt = buildHealPrompt(rel, sourceCode, failureBlock);

  console.log(`[fixloop] healing ${rel} (attempt ${attempt})…`);

  if (process.env.FIXLOOP_DRY_RUN === '1' || process.env.KIRO_HEAL_DRY_RUN === '1') {
    console.log('[fixloop] dry-run: skipping file write');
    return { filePath: abs, healed: false };
  }

  const incoming = await requestFix(abs, sourceCode, parseResult, prompt);
  const fixedCode = applyHealContent(sourceCode, incoming);
  if (!fixedCode || !String(fixedCode).trim()) {
    throw new Error('Heal produced an empty file — refusing to write');
  }
  await fs.writeFile(abs, fixedCode, 'utf8');
  console.log(`[fixloop] wrote healed file: ${rel}`);

  return { filePath: abs, healed: true };
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
  draft = true,
}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[fixloop] GITHUB_TOKEN not set — skipping PR creation.');
    return null;
  }

  if (!isValidGitHubRepoName(owner, repo)) {
    console.error('[fixloop] invalid GITHUB_OWNER / GITHUB_REPO — skipping PR creation.');
    return null;
  }

  const octokit = new Octokit({ auth: token });

  try {
    const { data: openPrs } = await octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      per_page: 30,
    });
    const selected = selectHealBranch(openPrs, branchName ?? STABLE_AUTO_FIX_BRANCH);
    const headBranch = selected.branch;

    // 1. Get the base branch SHA
    const { data: refs } = await octokit.git.listMatchingRefs({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    if (!refs.length) {
      console.error(`[fixloop] base branch "${baseBranch}" not found`);
      return null;
    }
    const baseSha = refs[0].object.sha;

    // 2. Create the heal branch if it does not already exist
    try {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${headBranch}`,
        sha: baseSha,
      });
    } catch (err) {
      if (err.status !== 422) throw err;
    }

    // 3. Get the SHA of the file to update (if it exists)
    let fileSha;
    try {
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path: filename,
        ref: headBranch,
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
      message: 'fixloop: verified product_regression patch',
      content: Buffer.from(correctedCode, 'utf8').toString('base64'),
      branch: headBranch,
      ...(fileSha ? { sha: fileSha } : {}),
    });

    const prBody = [
      '### fixloop report',
      '',
      '**Status:** Re-run passed after patch (draft PR, not merged)',
      '',
      failureReport,
      '',
      'This branch is reused (`fixloop/auto-fix`). Only `product_regression` failures may write application code.',
    ].join('\n');

    if (selected.reusePr) {
      const existing = openPrs.find((pr) => pr.head?.ref === headBranch);
      if (existing) {
        await octokit.pulls.update({
          owner,
          repo,
          pull_number: existing.number,
          body: prBody,
        });
        console.log(`[fixloop] updated existing pull request: ${existing.html_url}`);
        return existing;
      }
    }

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: 'fixloop: verified product regression fix',
      head: headBranch,
      base: baseBranch,
      draft,
      body: prBody,
    });

    console.log(`[fixloop] draft pull request created: ${pr.html_url}`);
    return pr;
  } catch (error) {
    console.error('[fixloop] GitHub PR creation failed:', error.message);
    return null;
  }
}

/**
 * Closed-loop: fail → heal → re-run until pass or max heal cycles.
 * Does not open a PR — the pipeline opens a draft PR only after a green re-run.
 */
export async function healLoop({
  runTest,
  resolveTarget,
  repoRoot,
  maxHealAttempts = 5,
  allowlist,
  healTarget,
  skipInitialRun = false,
  initialResult = null,
}) {
  let healCount = 0;
  let lastResult = initialResult;
  let firstSkipped = Boolean(skipInitialRun && initialResult);

  while (true) {
    if (firstSkipped) {
      firstSkipped = false;
      lastResult = initialResult;
    } else {
      console.log(
        `[fixloop] verification${healCount > 0 ? ` (after heal #${healCount})` : ''}…`,
      );
      lastResult = await runTest();
    }

    if (lastResult.outcome === 'passed') {
      console.log('[fixloop] ✓ verification passed.');
      return { passed: true, healCount, lastResult, attempts: healCount + 1 };
    }

    const target = await resolveTarget();
    if (!target) {
      console.error(
        '[fixloop] test failed but no heal target. Set healTarget in .fixloop.json or --target.',
      );
      return { passed: false, healCount, lastResult, attempts: healCount + 1 };
    }

    if (healCount >= maxHealAttempts) {
      console.error(`[fixloop] max heal attempts (${maxHealAttempts}) reached.`);
      return { passed: false, healCount, lastResult, attempts: healCount + 1 };
    }

    await healFile({
      filePath: target,
      repoRoot,
      parseResult: lastResult,
      attempt: healCount + 1,
      allowlist,
      healTarget,
    });
    healCount += 1;
  }
}

/**
 * Restore the example CTA handler (used by tests and `fixloop start`).
 * @param {string} filePath
 */
export async function restoreHealTarget(filePath) {
  await fs.writeFile(filePath, WORKING_MAIN_JS, 'utf8');
}
