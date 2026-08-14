# Fixloop Vite + Playwright example

This is the golden path: a real Vite app and a real Playwright spec.

```bash
cd examples/vite-app
npm install
npx playwright install chromium
npm test
```

To see Fixloop heal a product regression, break the click handler in `src/main.js`, then from the repo root:

```bash
npx fixloop run --cwd examples/vite-app --command "npx playwright test"
```
