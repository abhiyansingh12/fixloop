export const LABELS = /** @type {const} */ (['product_regression', 'test_defect', 'flake']);

export const TEST_DEFECT_COMMENT = 'update the test, I will not.';

const FLAKE_RE =
  /timed?\s*out|timeout|net::ERR|ECONNRESET|ECONNREFUSED|Target closed|interrupted|offline|flaky|NS_ERROR_FAILURE/i;
const TEST_DEFECT_RE =
  /strict mode violation|resolved to \d+ elements|toMatchSnapshot|snapshot|locator\([^)]+\) not found because the test used a stale selector|unable to find an element by title/i;
const PRODUCT_RE =
  /pageerror|uncaught|internal server error|\b500\b|cta-primary-broken|click handler|not wired|toHaveText|Get started|addEventListener/i;

function isTestPath(filePath) {
  const p = String(filePath ?? '').replace(/\\/g, '/');
  return (
    /\.(spec|test)\.(t|j)sx?$/.test(p) ||
    /(^|\/)(tests|e2e|playwright|__tests__)(\/|$)/.test(p)
  );
}

/**
 * @typedef {object} OracleFailure
 * @property {string} [title]
 * @property {string} [file]
 * @property {string} [message]
 * @property {string} [stack]
 * @property {string} [remark]
 * @property {number} [retries]
 * @property {boolean} [passedOnRetry]
 */

/**
 * @typedef {object} OracleResult
 * @property {'passed'|'failed'|'error'} outcome
 * @property {OracleFailure|null} [firstFailure]
 * @property {string} [rawSummary]
 * @property {object} [runEnd]
 */

/**
 * Classify a failed oracle run. Only `product_regression` may write application code.
 * @param {OracleResult} oracleResult
 * @param {{ healTarget?: string }} [opts]
 */
export function triageFailure(oracleResult, opts = {}) {
  if (!oracleResult || oracleResult.outcome === 'passed') {
    return { label: 'passed', reason: 'oracle passed', confidence: 1 };
  }

  const failure = oracleResult.firstFailure ?? {};
  const text = [
    failure.message,
    failure.stack,
    failure.remark,
    failure.title,
    oracleResult.rawSummary,
    oracleResult.runEnd?.summary,
    oracleResult.runEnd?.reason,
  ]
    .filter(Boolean)
    .join('\n');

  if (opts.healTarget && isTestPath(opts.healTarget)) {
    return {
      label: 'test_defect',
      reason: 'heal target is a test file',
      confidence: 1,
      comment: TEST_DEFECT_COMMENT,
    };
  }

  if (failure.passedOnRetry) {
    return {
      label: 'flake',
      reason: 'test passed on retry',
      confidence: 0.85,
    };
  }

  if (FLAKE_RE.test(text) && !PRODUCT_RE.test(text)) {
    return {
      label: 'flake',
      reason: `transient error: ${text.replace(/\s+/g, ' ').slice(0, 160)}`,
      confidence: 0.7,
    };
  }

  if (TEST_DEFECT_RE.test(text) || (isTestPath(failure.file) && /strict mode|snapshot/i.test(text))) {
    return {
      label: 'test_defect',
      reason: 'selector or snapshot drift in the spec',
      confidence: 0.8,
      comment: TEST_DEFECT_COMMENT,
    };
  }

  return {
    label: 'product_regression',
    reason: (failure.message || failure.remark || text || 'application interaction failed').slice(
      0,
      240,
    ),
    confidence: PRODUCT_RE.test(text) ? 0.8 : 0.6,
  };
}

/**
 * @param {{ label: string, reason?: string, comment?: string }} triage
 */
export function formatTriageMessage(triage) {
  if (triage.label === 'test_defect') {
    return `**fixloop:** \`test_defect\` — ${TEST_DEFECT_COMMENT}\n\n${triage.reason ?? ''}`;
  }
  if (triage.label === 'flake') {
    return `**fixloop:** \`flake\` — not patching.\n\n${triage.reason ?? ''}`;
  }
  if (triage.label === 'product_regression') {
    return `**fixloop:** \`product_regression\` — will patch application code only.\n\n${triage.reason ?? ''}`;
  }
  return `**fixloop:** \`${triage.label}\``;
}
