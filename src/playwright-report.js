/**
 * Flatten a Playwright JSON reporter document into oracle failures.
 * @param {object} json
 */
export function parsePlaywrightJson(json) {
  const tests = [];

  function walkSuites(suites) {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const results = test.results ?? [];
          const last = results[results.length - 1] ?? {};
          const passedOnRetry =
            results.some((r) => r.status === 'passed') &&
            results.some((r) => r.status === 'failed' || r.status === 'timedOut');
          tests.push({
            title: spec.title ?? test.title ?? '',
            file: spec.file || suite.file || '',
            status: last.status ?? test.status ?? 'unknown',
            message: last.error?.message ?? '',
            stack: last.error?.stack ?? '',
            retries: Math.max(0, results.length - 1),
            passedOnRetry,
          });
        }
      }
      walkSuites(suite.suites);
    }
  }

  walkSuites(json?.suites ?? []);
  if (tests.length === 0 && Array.isArray(json?.tests)) {
    for (const t of json.tests) {
      tests.push({
        title: t.title ?? '',
        file: t.file ?? '',
        status: t.status ?? 'unknown',
        message: t.error?.message ?? '',
        stack: t.error?.stack ?? '',
        retries: t.retry ?? 0,
        passedOnRetry: Boolean(t.ok && t.retry),
      });
    }
  }

  const failed = tests.filter((t) => t.status === 'failed' || t.status === 'timedOut');
  const first = failed[0] ?? null;
  return {
    outcome: failed.length === 0 ? 'passed' : 'failed',
    firstFailure: first
      ? {
          ...first,
          remark: first.message || first.title,
          step: 1,
          raw: first,
        }
      : null,
    tests,
    rawSummary: first?.message || (failed.length ? `${failed.length} failed` : 'passed'),
    runEnd: {
      type: 'run_end',
      status: failed.length === 0 ? 'passed' : 'failed',
      summary: first?.message || (failed.length === 0 ? 'Playwright passed' : 'Playwright failed'),
      reason: first?.title || '',
    },
    steps: tests.map((t, i) => ({
      step: i + 1,
      status: t.status === 'passed' ? 'passed' : 'failed',
      remark: t.message || t.title,
    })),
    oracle: 'playwright',
    events: [],
  };
}

/**
 * Pull a JSON object out of mixed CLI stdout.
 * @param {string} text
 */
export function extractJsonDocument(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
