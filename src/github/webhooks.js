import { Webhooks } from '@octokit/webhooks';
import { loadGitHubConfig } from './config.js';
import { verifyGitHubRepository } from './verify.js';

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
    log(`[kiro-heal:github] app installed on ${payload.installation.account?.login}`);
  });

  webhooks.on('repository_dispatch', async ({ payload }) => {
    if (payload.action !== config.verifyEventType) return;

    const repo = payload.repository;
    const installationId = payload.installation?.id;
    if (!repo || !installationId) return;

    const [owner, name] = [repo.owner.login, repo.name];
    log(`[kiro-heal:github] repository_dispatch ${config.verifyEventType} → ${owner}/${name}`);

    void verifyGitHubRepository({
      owner,
      repo: name,
      installationId,
      ref: payload.client_payload?.ref,
      openPr: payload.client_payload?.openPr !== false,
      log,
    }).catch((err) => log(`[kiro-heal:github] verify failed: ${err.message}`));
  });

  webhooks.on('issue_comment.created', async ({ payload }) => {
    const body = payload.comment.body?.trim() ?? '';
    if (!/^\/kiro-heal\s+verify\b/i.test(body)) return;

    const repo = payload.repository;
    const installationId = payload.installation?.id;
    if (!installationId) return;

    log(`[kiro-heal:github] issue comment verify → ${repo.full_name}`);

    void verifyGitHubRepository({
      owner: repo.owner.login,
      repo: repo.name,
      installationId,
      issueNumber: payload.issue.number,
      log,
    }).catch((err) => log(`[kiro-heal:github] verify failed: ${err.message}`));
  });

  webhooks.on('push', async ({ payload }) => {
    if (!config.autoVerifyOnPush) return;
    if (payload.ref !== `refs/heads/${payload.repository.default_branch}`) return;

    const installationId = payload.installation?.id;
    if (!installationId) return;

    const repo = payload.repository;
    log(`[kiro-heal:github] auto verify on push → ${repo.full_name}`);

    void verifyGitHubRepository({
      owner: repo.owner.login,
      repo: repo.name,
      installationId,
      ref: payload.repository.default_branch,
      log,
    }).catch((err) => log(`[kiro-heal:github] verify failed: ${err.message}`));
  });

  return webhooks;
}
