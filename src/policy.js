import { env, envOn } from './flags.js';

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export const HEAL_BRANCH_PREFIX = 'fixloop/';
export const LEGACY_HEAL_BRANCH_PREFIX = 'kiro-heal/';
export const STABLE_AUTO_FIX_BRANCH = 'fixloop/auto-fix';
export const STABLE_VERIFY_BRANCH = 'fixloop/verify';

/**
 * Local CLI stays opt-in. GitHub Actions may open a *draft* PR after a green re-run.
 * @param {NodeJS.ProcessEnv} [envObj]
 */
export function shouldOpenAutomatedPr(envObj = process.env) {
  if (env('OPEN_PR', undefined, envObj) === '0') return false;
  if (envOn('OPEN_PR', envObj)) return true;
  return envObj.GITHUB_ACTIONS === 'true' && Boolean(envObj.GITHUB_TOKEN);
}

export function isTrustedCommentAuthor(association) {
  return TRUSTED_ASSOCIATIONS.has(String(association ?? '').toUpperCase());
}

export function isVerifyComment(body) {
  const text = String(body ?? '').trim();
  return /^\/(fixloop|kiro-heal)\s+verify\b/i.test(text);
}

export function resolveChatCompletionsUrl(envObj = process.env) {
  if (envObj.FIXLOOP_API_URL) return envObj.FIXLOOP_API_URL;
  if (envObj.KIRO_HEAL_API_URL) return envObj.KIRO_HEAL_API_URL;
  if (envObj.KIRO_GENERATION_URL) return envObj.KIRO_GENERATION_URL;
  if (envObj.OPENAI_API_KEY) {
    const base = (envObj.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    return `${base}/chat/completions`;
  }
  return null;
}

export function isValidGitHubRepoName(owner, repo) {
  const part = /^[A-Za-z0-9_.-]+$/;
  return part.test(String(owner ?? '')) && part.test(String(repo ?? ''));
}

export function isHealBotPullRequest(pr) {
  const ref = pr?.head?.ref ?? '';
  return ref.startsWith(HEAL_BRANCH_PREFIX) || ref.startsWith(LEGACY_HEAL_BRANCH_PREFIX);
}

export function selectHealBranch(openPrs, stableBranch = STABLE_AUTO_FIX_BRANCH) {
  const existing = (openPrs ?? []).find((pr) => isHealBotPullRequest(pr));
  if (existing?.head?.ref) {
    return { branch: existing.head.ref, reusePr: true };
  }
  return { branch: stableBranch, reusePr: false };
}
