import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHealBotPullRequest,
  isTrustedCommentAuthor,
  isValidGitHubRepoName,
  isVerifyComment,
  resolveChatCompletionsUrl,
  selectHealBranch,
  shouldOpenAutomatedPr,
  STABLE_AUTO_FIX_BRANCH,
} from '../src/policy.js';

describe('policy', () => {
  it('keeps automated PRs off unless KIRO_HEAL_OPEN_PR=1', () => {
    assert.equal(shouldOpenAutomatedPr({}), false);
    assert.equal(shouldOpenAutomatedPr({ KIRO_HEAL_OPEN_PR: '0' }), false);
    assert.equal(shouldOpenAutomatedPr({ KIRO_HEAL_OPEN_PR: '1' }), true);
  });

  it('only trusts write-access comment authors', () => {
    assert.equal(isTrustedCommentAuthor('OWNER'), true);
    assert.equal(isTrustedCommentAuthor('MEMBER'), true);
    assert.equal(isTrustedCommentAuthor('COLLABORATOR'), true);
    assert.equal(isTrustedCommentAuthor('CONTRIBUTOR'), false);
    assert.equal(isTrustedCommentAuthor('NONE'), false);
    assert.equal(isTrustedCommentAuthor(undefined), false);
  });

  it('matches /kiro-heal verify comments', () => {
    assert.equal(isVerifyComment('/kiro-heal verify'), true);
    assert.equal(isVerifyComment('  /kiro-heal verify please'), true);
    assert.equal(isVerifyComment('please /kiro-heal verify'), false);
    assert.equal(isVerifyComment('/kiro-heal status'), false);
  });

  it('prefers KIRO_HEAL_API_URL over the OpenAI fallback', () => {
    assert.equal(
      resolveChatCompletionsUrl({
        KIRO_HEAL_API_URL: 'https://example.test/v1/chat/completions',
        OPENAI_API_KEY: 'sk-test',
      }),
      'https://example.test/v1/chat/completions',
    );
    assert.equal(
      resolveChatCompletionsUrl({ OPENAI_API_KEY: 'sk-test' }),
      'https://api.openai.com/v1/chat/completions',
    );
    assert.equal(resolveChatCompletionsUrl({}), null);
  });

  it('rejects unsafe GitHub owner/repo names', () => {
    assert.equal(isValidGitHubRepoName('abhiyansingh12', 'hackkk'), true);
    assert.equal(isValidGitHubRepoName('abhi', 'hackkk.git'), true);
    assert.equal(isValidGitHubRepoName('abhi', '../etc'), false);
    assert.equal(isValidGitHubRepoName('abhi;rm', 'hackkk'), false);
    assert.equal(isValidGitHubRepoName('', 'hackkk'), false);
  });

  it('reuses an existing kiro-heal PR branch instead of minting a timestamped one', () => {
    const openPrs = [
      { head: { ref: 'feature/human' }, title: 'human pr' },
      { head: { ref: 'kiro-heal/auto-fix-111' }, title: 'old bot pr' },
    ];
    const selected = selectHealBranch(openPrs, STABLE_AUTO_FIX_BRANCH);
    assert.equal(selected.reusePr, true);
    assert.equal(selected.branch, 'kiro-heal/auto-fix-111');
    assert.equal(isHealBotPullRequest(openPrs[1]), true);
    assert.equal(isHealBotPullRequest(openPrs[0]), false);
  });

  it('uses a stable branch when no bot PR is open', () => {
    const selected = selectHealBranch([], STABLE_AUTO_FIX_BRANCH);
    assert.deepEqual(selected, { branch: STABLE_AUTO_FIX_BRANCH, reusePr: false });
  });
});
