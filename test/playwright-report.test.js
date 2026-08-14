import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonDocument, parsePlaywrightJson } from '../src/playwright-report.js';

const sample = {
  suites: [
    {
      file: 'tests/home.spec.js',
      specs: [
        {
          title: 'primary CTA completes checkout',
          file: 'tests/home.spec.js',
          tests: [
            {
              results: [
                {
                  status: 'failed',
                  error: {
                    message: 'Error: click handler not wired\nexpect(page).toHaveURL(/#confirmed/)',
                    stack: 'Error: click handler not wired\n    at tests/home.spec.js:6:3',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('playwright JSON report', () => {
  it('extracts the first failed spec', () => {
    const parsed = parsePlaywrightJson(sample);
    assert.equal(parsed.outcome, 'failed');
    assert.equal(parsed.oracle, 'playwright');
    assert.match(parsed.firstFailure.message, /click handler not wired/);
    assert.equal(parsed.firstFailure.file, 'tests/home.spec.js');
    assert.equal(parsed.tests.length, 1);
  });

  it('marks passed when every spec passed', () => {
    const parsed = parsePlaywrightJson({
      suites: [
        {
          specs: [{ title: 'ok', tests: [{ results: [{ status: 'passed' }] }] }],
        },
      ],
    });
    assert.equal(parsed.outcome, 'passed');
    assert.equal(parsed.firstFailure, null);
  });

  it('detects passed-on-retry flakes', () => {
    const parsed = parsePlaywrightJson({
      suites: [
        {
          specs: [
            {
              title: 'flaky',
              file: 'tests/x.spec.js',
              tests: [
                {
                  results: [
                    { status: 'failed', error: { message: 'timeout' } },
                    { status: 'passed' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(parsed.tests[0].passedOnRetry, true);
  });

  it('pulls a JSON object out of mixed stdout', () => {
    const json = extractJsonDocument('noise\n{"ok":true,"suites":[]}\nmore');
    assert.deepEqual(json, { ok: true, suites: [] });
    assert.equal(extractJsonDocument('no json here'), null);
  });
});
