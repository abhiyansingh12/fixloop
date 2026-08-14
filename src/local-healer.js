import path from 'node:path';

/** Canonical working demo/main.js for fallback restore */
export const WORKING_MAIN_JS = `/**
 * Demo app interactions — minimal, no framework.
 */
(function init() {
  const cta = document.getElementById('cta-primary');
  const status = document.getElementById('status-banner');

  if (!cta || !status) return;

  cta.addEventListener('click', () => {
    status.textContent =
      'Pipeline connected. Playwright can verify this interaction on the next run.';
    status.dataset.state = 'success';
    cta.setAttribute('aria-pressed', 'true');
  });
})();
`;

/**
 * Deterministic fixes for the examples/demo CTA regression.
 * @param {string} absPath
 * @param {string} sourceCode
 * @param {import('./parser.js').ParseResult} parseResult
 * @returns {string|null}
 */
export function tryLocalHeal(absPath, sourceCode, parseResult) {
  const base = path.basename(absPath);
  const trace = [
    parseResult.firstFailure?.remark ?? '',
    parseResult.runEnd?.summary ?? '',
    parseResult.runEnd?.reason ?? '',
  ]
    .join(' ')
    .toLowerCase();

  if (base === 'main.js') {
    if (sourceCode.includes('cta-primary-broken')) {
      return sourceCode.replace(/cta-primary-broken/g, 'cta-primary');
    }
    if (!sourceCode.includes('addEventListener') || sourceCode.includes('HEAL_BROKEN')) {
      return WORKING_MAIN_JS;
    }
    if (trace.includes('button') || trace.includes('get started') || trace.includes('click')) {
      if (!sourceCode.includes("'cta-primary'") && !sourceCode.includes('"cta-primary"')) {
        return WORKING_MAIN_JS;
      }
    }
  }

  if (base === 'index.html') {
    if (sourceCode.includes('bug-overlay') || trace.includes('overlay') || trace.includes('modal')) {
      return sourceCode.replace(
        /\s*<div[^>]*class="[^"]*bug-overlay[^"]*"[^>]*>[\s\S]*?<\/div>\s*/i,
        '\n',
      );
    }
  }

  return null;
}
