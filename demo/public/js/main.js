/**
 * Demo app interactions — minimal, no framework.
 */
(function init() {
  const cta = document.getElementById('cta-primary');
  const status = document.getElementById('status-banner');

  if (!cta || !status) return;

  cta.addEventListener('click', () => {
    status.textContent =
      'Pipeline connected. Kane CLI can verify this interaction on the next run.';
    status.dataset.state = 'success';
    cta.setAttribute('aria-pressed', 'true');
  });
})();
