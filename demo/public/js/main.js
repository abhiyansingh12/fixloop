/**
 * Demo app interactions — minimal, no framework.
 */
(function init() {
  if (typeof document === 'undefined') {
    console.error('Document is not defined. This script should be run in a browser environment.');
    return;
  }

  const cta = document.getElementById('cta-primarybroken');
  const status = document.getElementById('status-banner');

  if (!cta || !status) return;

  cta.addEventListener('click', () => {
    status.textContent =
      'Pipeline connected. Kane CLI can verify this interaction on the next run.';
    status.dataset.state = 'success';
    cta.setAttribute('aria-pressed', 'true');
  });
})();