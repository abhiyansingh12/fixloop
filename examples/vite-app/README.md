# Fixloop Vite + Playwright example

Golden path: a real Vite app and a real Playwright spec.

```bash
cd examples/vite-app
npm install
npx playwright install chromium
npm test
```

To see Fixloop heal a product regression, break the click handler in `src/main.js`, then from the **repository root**:

```bash
npx fixloop run --dir examples/vite-app --command "npx playwright test"
```
