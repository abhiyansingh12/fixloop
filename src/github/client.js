import { createGitHubClient } from './api.js';
import { createInstallationToken } from './jwt.js';
import { loadGitHubConfig } from './config.js';

/**
 * @param {import('./config.js').GitHubBotConfig} [config]
 */
export async function createApp(config) {
  const cfg = config ?? (await loadGitHubConfig());
  if (!cfg.appId || !cfg.privateKey) return null;
  return {
    appId: cfg.appId,
    privateKey: cfg.privateKey,
    async getInstallationOctokit(installationId) {
      const token = await createInstallationToken(cfg.appId, cfg.privateKey, installationId);
      return createGitHubClient(token);
    },
  };
}

/**
 * @param {{ getInstallationOctokit: (id: number) => Promise<{ auth: () => Promise<{ token: string }> }> }} app
 * @param {number} installationId
 */
export async function getInstallationToken(app, installationId) {
  const octokit = await app.getInstallationOctokit(installationId);
  const auth = await octokit.auth();
  if (auth && typeof auth === 'object' && 'token' in auth && auth.token) {
    return auth.token;
  }
  throw new Error('Could not resolve installation access token');
}

/**
 * GitHub client for an installation (GitHub App) or PAT (local / Actions).
 * @param {object} opts
 * @param {number} [opts.installationId]
 * @param {import('./config.js').GitHubBotConfig} [opts.config]
 */
export async function createOctokit(opts = {}) {
  const config = opts.config ?? (await loadGitHubConfig());

  if (opts.installationId && config.appId && config.privateKey) {
    const app = await createApp(config);
    if (!app) throw new Error('GitHub App not configured');
    return app.getInstallationOctokit(opts.installationId);
  }

  if (config.token) {
    return createGitHubClient(config.token);
  }

  throw new Error('Need installationId + GitHub App credentials, or GITHUB_TOKEN');
}

/**
 * @param {ReturnType<typeof createGitHubClient>} octokit
 */
export async function getDefaultBranch(octokit, owner, repo) {
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch ?? 'main';
}
