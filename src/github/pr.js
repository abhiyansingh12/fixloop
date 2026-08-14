import fs from 'node:fs/promises';
import path from 'node:path';
import { isHealBotPullRequest, STABLE_VERIFY_BRANCH } from '../policy.js';

/**
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} baseBranch
 */
async function getHeadSha(octokit, owner, repo, baseBranch) {
  const { data } = await octokit.repos.getBranch({ owner, repo, branch: baseBranch });
  return data.commit.sha;
}

/**
 * Create or update files on the stable verify branch and open (or update) a PR.
 * @param {object} opts
 */
export async function createVerificationPullRequest(opts) {
  const {
    octokit,
    owner,
    repo,
    repoRoot,
    baseBranch,
    reportMarkdown,
    analysisJson,
    passed,
    extraPaths = [],
  } = opts;

  const { data: openPrs } = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    per_page: 30,
  });
  const existing = openPrs.find(
    (pr) =>
      isHealBotPullRequest(pr) &&
      (pr.head?.ref?.startsWith('fixloop/verify') || pr.head?.ref?.startsWith('kiro-heal/verify')),
  );
  const branch = existing?.head?.ref ?? STABLE_VERIFY_BRANCH;
  const baseSha = await getHeadSha(octokit, owner, repo, baseBranch);

  let refData;
  try {
    const created = await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
    refData = created.data;
  } catch (err) {
    if (err.status !== 422) throw err;
    refData = { ref: `refs/heads/${branch}` };
  }

  const filesToCommit = new Map();

  const reportPath = '.fixloop/verification-report.md';
  const analysisPath = '.fixloop/analysis.json';
  filesToCommit.set(reportPath, reportMarkdown);
  filesToCommit.set(analysisPath, analysisJson);

  for (const rel of extraPaths) {
    if (rel.includes('..') || path.isAbsolute(rel)) continue;
    const abs = path.join(repoRoot, rel);
    try {
      const content = await fs.readFile(abs, 'utf8');
      filesToCommit.set(rel, content);
    } catch {
      // skip missing
    }
  }

  try {
    const testmd = path.join(repoRoot, '.fixloop/smoke.testmd');
    const testContent = await fs.readFile(testmd, 'utf8');
    filesToCommit.set('.fixloop/smoke.testmd', testContent);
  } catch {
    // optional
  }

  for (const [filePath, content] of filesToCommit) {
    let sha;
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
      if (!Array.isArray(data) && data.sha) sha = data.sha;
    } catch {
      // new file
    }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `fixloop: update ${filePath}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  const title = passed
    ? 'fixloop: verified product regression fix'
    : 'fixloop: verification findings (suite still red — do not merge)';

  const body = `${reportMarkdown}\n\n---\n\n### Next steps\n\n- Re-run passed after patch is required before this PR exists on the Action path.\n- Draft only. No auto-merge.\n- Comment \`/fixloop verify\` (collaborators only) or drop in \`templates/github/fixloop.yml\`.`;

  if (existing) {
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: existing.number,
      title,
      body,
    });
    return { pr: existing, branch, ref: refData, reused: true };
  }

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title,
    head: branch,
    base: baseBranch,
    body,
    draft: true,
  });

  return { pr, branch, ref: refData, reused: false };
}

/**
 * Post a comment on an issue or PR.
 */
export async function postComment(octokit, owner, repo, issueNumber, body) {
  await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
}
