import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FIXTURE, evaluateFixture } from '../src/fixture.js';

describe('fixture evaluator', () => {
  it('fails on demo broken markers and passes on the working CTA', () => {
    const broken = evaluateFixture("getElementById('cta-primary-broken')", DEFAULT_FIXTURE);
    assert.equal(broken.broken, true);

    const ok = evaluateFixture("document.getElementById('cta-primary')", DEFAULT_FIXTURE);
    assert.equal(ok.broken, false);
  });

  it('honors passIfAll', () => {
    const result = evaluateFixture('alpha', {
      failIfAny: [],
      passIfAny: [],
      passIfAll: ['alpha', 'beta'],
    });
    assert.equal(result.broken, true);
  });
});
