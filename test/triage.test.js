import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTriageMessage, TEST_DEFECT_COMMENT, triageFailure } from '../src/triage.js';

function fail(overrides = {}) {
  return {
    outcome: 'failed',
    firstFailure: {
      title: 'primary CTA',
      file: 'src/main.js',
      message: 'click handler not wired',
      ...overrides,
    },
  };
}

describe('triage', () => {
  it('labels product_regression for application click failures', () => {
    const t = triageFailure(fail({ message: 'Get started button did not update — click handler not wired' }));
    assert.equal(t.label, 'product_regression');
  });

  it('labels product_regression when the selector is the broken CTA id', () => {
    const t = triageFailure(fail({ message: 'locator #cta-primary-broken not found' }));
    assert.equal(t.label, 'product_regression');
  });

  it('labels test_defect with the exact refusal sentence', () => {
    const t = triageFailure(fail({ message: 'strict mode violation: resolved to 2 elements' }));
    assert.equal(t.label, 'test_defect');
    assert.equal(t.comment, TEST_DEFECT_COMMENT);
    assert.equal(TEST_DEFECT_COMMENT, 'update the test, I will not.');
    assert.match(formatTriageMessage(t), /update the test, I will not\./);
  });

  it('labels test_defect when the heal target is a spec file', () => {
    const t = triageFailure(fail({ message: 'timeout' }), { healTarget: 'tests/home.spec.js' });
    assert.equal(t.label, 'test_defect');
    assert.equal(t.comment, 'update the test, I will not.');
  });

  it('labels flake on timeout without product signals', () => {
    const t = triageFailure(fail({ message: 'Test timeout of 30000ms exceeded', file: 'tests/home.spec.js' }));
    assert.equal(t.label, 'flake');
  });

  it('labels flake when a retry later passed', () => {
    const t = triageFailure(fail({ passedOnRetry: true, message: 'net::ERR_CONNECTION_RESET' }));
    assert.equal(t.label, 'flake');
  });

  it('does not patch on flake or test_defect messages', () => {
    const flake = formatTriageMessage({ label: 'flake', reason: 'timeout' });
    assert.match(flake, /not patching/);
    const defect = formatTriageMessage({ label: 'test_defect', reason: 'snapshot' });
    assert.match(defect, /update the test, I will not\./);
  });
});
