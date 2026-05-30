import fs from 'node:fs/promises';

/**
 * @typedef {object} GitHubBotConfig
 * @property {number|null} appId
 * @property {string|null} privateKey
 * @property {string|null} webhookSecret
 * @property {string|null} token
 * @property {number} port
 * @property {boolean} autoVerifyOnPush
 * @property {string} verifyEventType
 * @property {string} workDirBase
 */

/**
 * @returns {Promise<GitHubBotConfig>}
 */
export async function loadGitHubConfig() {
  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? null;
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (!privateKey && keyPath) {
    privateKey = await fs.readFile(keyPath, 'utf8');
  }

  return {
    appId: process.env.GITHUB_APP_ID ? Number(process.env.GITHUB_APP_ID) : null,
    privateKey,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? null,
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    port: Number(process.env.KIRO_HEAL_GITHUB_PORT ?? process.env.PORT ?? 3939),
    autoVerifyOnPush: process.env.KIRO_HEAL_GITHUB_AUTO_PUSH === '1',
    verifyEventType: process.env.KIRO_HEAL_GITHUB_EVENT ?? 'kiro-heal-verify',
    workDirBase: process.env.KIRO_HEAL_WORK_DIR ?? '/tmp/kiro-heal',
  };
}

/**
 * @param {GitHubBotConfig} config
 */
export function assertGitHubAppReady(config) {
  if (config.appId && config.privateKey) return;
  if (config.token) return;
  throw new Error(
    'GitHub auth not configured. Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (or PATH), or GITHUB_TOKEN for local verify.',
  );
}

/**
 * @param {GitHubBotConfig} config
 */
export function assertWebhookServerReady(config) {
  assertGitHubAppReady(config);
  if (!config.webhookSecret) {
    throw new Error('GITHUB_WEBHOOK_SECRET is required for `kiro-heal github serve`.');
  }
}
