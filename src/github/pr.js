import fs from 'node:fs/promises';
import path from 'node:path';

const BOT_BRANCH_PREFIX = 'kiro-heal/verify-';

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
 * Create or update files on a new branch and open a PR.
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

  const branch = `${BOT_BRANCH_PREFIX}${Date.now()}`;
  const baseSha = await getHeadSha(octokit, owner, repo, baseBranch);

  const { data: refData } = await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  const filesToCommit = new Map();

  const reportPath = '.kiro-heal/verification-report.md';
  const analysisPath = '.kiro-heal/analysis.json';
  filesToCommit.set(reportPath, reportMarkdown);
  filesToCommit.set(analysisPath, analysisJson);

  for (const rel of extraPaths) {
    const abs = path.join(repoRoot, rel);
    try {
      const content = await fs.readFile(abs, 'utf8');
      filesToCommit.set(rel, content);
    } catch {
      // skip missing
    }
  }

  try {
    const testmd = path.join(repoRoot, '.kiro-heal/smoke.testmd');
    const testContent = await fs.readFile(testmd, 'utf8');
    filesToCommit.set('.kiro-heal/smoke.testmd', testContent);
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
      message: `chore(kiro-heal): update ${filePath}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  const title = passed
    ? 'chore(kiro-heal): verification passed — Kane tests & report'
    : 'chore(kiro-heal): verification findings — tests, fixes & report';

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title,
    head: branch,
    base: baseBranch,
    body: `${reportMarkdown}\n\n---\n\n### Next steps\n\n- Review generated \`.kiro-heal/smoke.testmd\` Kane tests\n- Merge when CI / Kane verification is green\n- Re-run verification: \`repository_dispatch\` event \`kiro-heal-verify\` or comment \`/kiro-heal verify\` on an issue`,
  });

  return { pr, branch, ref: refData };
}

/**
 * Post a comment on an issue or PR.
 */
export async function postComment(octokit, owner, repo, issueNumber, body) {
  await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
}
