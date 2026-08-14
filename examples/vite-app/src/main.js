const app = document.querySelector('#app');

app.innerHTML = `
  <main>
    <h1>Checkout</h1>
    <p>Pay and continue to the confirmation page.</p>
    <button id="cta-primary" type="button">Pay now</button>
    <p id="status" hidden></p>
  </main>
`;

const button = document.querySelector('#cta-primary');
const status = document.querySelector('#status');

button.addEventListener('click', () => {
  status.hidden = false;
  status.textContent = 'Paid. Confirmation is next.';
  window.location.hash = '#confirmed';
});
