import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyHealContent, applyUnifiedDiff, looksLikeUnifiedDiff } from '../src/patch.js';

describe('unified diff', () => {
  it('applies a single hunk', () => {
    const original = ['a', 'b', 'c'].join('\n');
    const diff = [
      '--- a/file.js',
      '+++ b/file.js',
      '@@ -1,3 +1,3 @@',
      ' a',
      '-b',
      '+B',
      ' c',
    ].join('\n');
    assert.equal(looksLikeUnifiedDiff(diff), true);
    assert.equal(applyUnifiedDiff(original, diff), ['a', 'B', 'c'].join('\n'));
  });

  it('falls back to full file when the payload is not a diff', () => {
    assert.equal(applyHealContent('old', 'new file'), 'new file');
  });

  it('rejects context mismatches', () => {
    const original = 'hello\n';
    const diff = '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-nope\n+yes\n';
    assert.throws(() => applyUnifiedDiff(original, diff));
  });
});
