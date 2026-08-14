import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runExclusiveVerify, shouldHandleVerifyComment } from '../src/github/webhooks.js';

describe('webhook comment gate', () => {
  it('accepts collaborator verify comments', () => {
    assert.equal(
      shouldHandleVerifyComment({
        comment: { body: '/kiro-heal verify', author_association: 'COLLABORATOR' },
        installation: { id: 42 },
      }),
      true,
    );
  });

  it('rejects verify comments from outsiders', () => {
    assert.equal(
      shouldHandleVerifyComment({
        comment: { body: '/kiro-heal verify', author_association: 'NONE' },
        installation: { id: 42 },
      }),
      false,
    );
  });

  it('rejects comments without an installation', () => {
    assert.equal(
      shouldHandleVerifyComment({
        comment: { body: '/kiro-heal verify', author_association: 'OWNER' },
      }),
      false,
    );
  });
});

describe('exclusive verify lock', () => {
  it('skips overlapping runs for the same repo', async () => {
    let started = 0;
    let finished = 0;
    const logs = [];
    const log = (msg) => logs.push(msg);

    const first = runExclusiveVerify('acme/app', log, async () => {
      started += 1;
      await new Promise((r) => setTimeout(r, 50));
      finished += 1;
      return 'ok';
    });

    const second = runExclusiveVerify('acme/app', log, async () => {
      started += 1;
      finished += 1;
      return 'should-not-run';
    });

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, 'ok');
    assert.deepEqual(b, { skipped: true });
    assert.equal(started, 1);
    assert.equal(finished, 1);
    assert.match(logs.join('\n'), /already running/);
  });
});
