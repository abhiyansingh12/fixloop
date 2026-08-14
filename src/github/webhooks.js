import { Webhooks } from '@octokit/webhooks';
import { loadGitHubConfig } from './config.js';
import { verifyGitHubRepository } from './verify.js';
import { isTrustedCommentAuthor, isVerifyComment } from '../policy.js';

/** One in-flight verify per owner/repo so overlapping webhooks cannot stampede PRs. */
const inflight = new Set();

/**
 * @param {string} key
 * @param {(msg: string) => void} log
 * @param {() => Promise<unknown>} fn
 */
export async function runExclusiveVerify(key, log, fn) {
  if (inflight.has(key)) {
    log(`[fixloop:github] verify already running for ${key} — skipping`);
    return { skipped: true };
  }
  inflight.add(key);
  try {
    return await fn();
  } finally {
    inflight.delete(key);
  }
}

/**
 * @param {object} payload
 */
export function shouldHandleVerifyComment(payload) {
  if (!isVerifyComment(payload?.comment?.body)) return false;
  if (!payload.installation?.id) return false;
  if (!isTrustedCommentAuthor(payload.comment?.author_association)) return false;
  return true;
}

/**
 * @param {object} opts
 * @param {(msg: string) => void} [opts.log]
 */
export async function createWebhookHandlers(opts = {}) {
  const config = await loadGitHubConfig();
  const log = opts.log ?? console.log;

  if (!config.webhookSecret) {
    throw new Error('GITHUB_WEBHOOK_SECRET is required for webhook server');
  }

  const webhooks = new Webhooks({ secret: config.webhookSecret });

  webhooks.on('installation.created', async ({ payload }) => {
    log(`[fixloop:github] app installed on ${payload.installation.account?.login}`);
  });

  webhooks.on('repository_dispatch', async ({ payload }) => {
    if (
      payload.action !== config.verifyEventType &&
      payload.action !== 'fixloop-verify' &&
      payload.action !== 'kiro-heal-verify'
    ) {
      return;
    }

    const repo = payload.repository;
    const installationId = payload.installation?.id;
    if (!repo || !installationId) return;

    const owner = repo.owner.login;
    const name = repo.name;
    const key = `${owner}/${name}`;
    log(`[fixloop:github] repository_dispatch ${payload.action} → ${key}`);

    void runExclusiveVerify(key, log, () =>
      verifyGitHubRepository({
        owner,
        repo: name,
        installationId,
        ref: payload.client_payload?.ref,
        openPr: payload.client_payload?.openPr !== false,
        log,
      }),
    ).catch((err) => log(`[fixloop:github] verify failed: ${err.message}`));
  });

  webhooks.on('issue_comment.created', async ({ payload }) => {
    if (!shouldHandleVerifyComment(payload)) {
      if (isVerifyComment(payload.comment?.body) && !isTrustedCommentAuthor(payload.comment?.author_association)) {
        log(
          `[fixloop:github] ignoring /fixloop verify from ${payload.comment?.user?.login} (${payload.comment?.author_association})`,
        );
      }
      return;
    }

    const repo = payload.repository;
    const key = repo.full_name;
    log(`[fixloop:github] issue comment verify → ${key}`);

    void runExclusiveVerify(key, log, () =>
      verifyGitHubRepository({
        owner: repo.owner.login,
        repo: repo.name,
        installationId: payload.installation.id,
        issueNumber: payload.issue.number,
        log,
      }),
    ).catch((err) => log(`[fixloop:github] verify failed: ${err.message}`));
  });

  webhooks.on('push', async ({ payload }) => {
    if (!config.autoVerifyOnPush) return;
    if (payload.ref !== `refs/heads/${payload.repository.default_branch}`) return;

    const installationId = payload.installation?.id;
    if (!installationId) return;

    const repo = payload.repository;
    const key = repo.full_name;
    log(`[fixloop:github] auto verify on push → ${key}`);

    void runExclusiveVerify(key, log, () =>
      verifyGitHubRepository({
        owner: repo.owner.login,
        repo: repo.name,
        installationId,
        ref: payload.repository.default_branch,
        log,
      }),
    ).catch((err) => log(`[fixloop:github] verify failed: ${err.message}`));
  });

  return webhooks;
}
