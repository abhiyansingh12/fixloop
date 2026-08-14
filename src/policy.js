const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export const HEAL_BRANCH_PREFIX = 'kiro-heal/';
export const STABLE_AUTO_FIX_BRANCH = 'kiro-heal/auto-fix';
export const STABLE_VERIFY_BRANCH = 'kiro-heal/verify';

/**
 * Automated PRs are opt-in. The hackathon loop opened a unique branch per
 * heal, which flooded the repo with duplicate pull requests.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function shouldOpenAutomatedPr(env = process.env) {
  return env.KIRO_HEAL_OPEN_PR === '1';
}

/**
 * Only repo collaborators (write access) may trigger `/kiro-heal verify`.
 * @param {string} [association]
 */
export function isTrustedCommentAuthor(association) {
  return TRUSTED_ASSOCIATIONS.has(String(association ?? '').toUpperCase());
}

/**
 * @param {string} [body]
 */
export function isVerifyComment(body) {
  return /^\/kiro-heal\s+verify\b/i.test(String(body ?? '').trim());
}

/**
 * Prefer an explicit generation URL; only fall back to OpenAI when a key is set.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function resolveChatCompletionsUrl(env = process.env) {
  if (env.KIRO_HEAL_API_URL) return env.KIRO_HEAL_API_URL;
  if (env.KIRO_GENERATION_URL) return env.KIRO_GENERATION_URL;
  if (env.OPENAI_API_KEY) {
    const base = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    return `${base}/chat/completions`;
  }
  return null;
}

/**
 * @param {string} [owner]
 * @param {string} [repo]
 */
export function isValidGitHubRepoName(owner, repo) {
  const part = /^[A-Za-z0-9_.-]+$/;
  return part.test(String(owner ?? '')) && part.test(String(repo ?? ''));
}

/**
 * @param {{ head?: { ref?: string }, title?: string }} pr
 */
export function isHealBotPullRequest(pr) {
  const ref = pr?.head?.ref ?? '';
  return ref.startsWith(HEAL_BRANCH_PREFIX);
}

/**
 * Pick an existing open heal PR's branch, otherwise a stable branch name.
 * @param {{ head?: { ref?: string } }[]} openPrs
 * @param {string} [stableBranch]
 */
export function selectHealBranch(openPrs, stableBranch = STABLE_AUTO_FIX_BRANCH) {
  const existing = (openPrs ?? []).find((pr) => isHealBotPullRequest(pr));
  if (existing?.head?.ref) {
    return { branch: existing.head.ref, reusePr: true };
  }
  return { branch: stableBranch, reusePr: false };
}
