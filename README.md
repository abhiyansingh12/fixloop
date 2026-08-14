# fixloop

[![CI](https://github.com/abhiyansingh12/fixloop/actions/workflows/ci.yml/badge.svg)](https://github.com/abhiyansingh12/fixloop/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/fixloop.svg)](https://www.npmjs.com/package/fixloop)
[![license](https://img.shields.io/npm/l/fixloop.svg)](LICENSE)
[![node](https://img.shields.io/node/v/fixloop.svg)](package.json)

Triage is the feature. Every failure gets one label: `product_regression`, `test_defect`, or `flake`. **Only `product_regression` may write application code.** `test_defect` comments **“update the test, I will not.”** That single rule is why you would use this instead of a generic coding agent.

Playwright is the default oracle. After a patch, Fixloop **re-runs the same command**. If the suite is still red, **it does not open a PR.** PRs are **draft**. There is **no auto-merge**.

Install: `npx fixloop`. Config: `.fixloop.json`. Action: `abhiyansingh12/fixloop@v1.0.1` (pin a tag in production, not `@main`).

## Install (GitHub Action)

Copy [`templates/github/fixloop.yml`](templates/github/fixloop.yml) into `.github/workflows/fixloop.yml`:

```yaml
- name: Fixloop
  uses: abhiyansingh12/fixloop@v1.0.1
  with:
    command: npx playwright test
```

Permissions: `contents: write`, `pull-requests: write`. The Action uses `github.token` itself. Outputs: `triage`, `verified`, `passed`, `healed`.

## Golden path (Vite + Playwright)

```bash
cd examples/vite-app
npm install
npx playwright install chromium
npm test
```

Break the click handler in `examples/vite-app/src/main.js`, then from the repo root:

```bash
npm install -g fixloop
npx fixloop run --dir examples/vite-app --command "npx playwright test"
```

```json
{
  "oracle": "playwright",
  "healTarget": "src/main.js",
  "playwrightCommand": "npx playwright test"
}
```

A Next app is the same shape: point `healTarget` at `app/page.tsx` (or `src/app/page.tsx`).

## Triage

| Label | What Fixloop does |
| --- | --- |
| `product_regression` | Patch allowlisted application code, re-run the same command, draft PR only if green |
| `test_defect` | Comment **update the test, I will not.** No writes. |
| `flake` | Not patching. Timeouts, net errors, passed-on-retry — unless the heal target is app code and the spec is waiting on UI |

## Safety

- Writes limited to `healAllowlist` (default: `src/`, `app/`, `pages/`, `public/`, `examples/`, …)
- `.env`, `*.pem`, `*.key`, SSH keys, `.npmrc`, lockfiles, `node_modules`, `.git` are denylisted; `healTarget` cannot override that
- Logs and PR text run through secret redaction
- Generation APIs must be https (or localhost)
- Unified diffs preferred; empty writes refused
- One stable branch: `fixloop/auto-fix`
- Local CLI does not open PRs unless `FIXLOOP_OPEN_PR=1`
- **Zero runtime npm dependencies**

## Limits

- Triage is heuristic. A timeout with no UI assertion is still a flake.
- Healing can write more than one allowlisted file when the model returns a multi-file diff, or when the Playwright stack names application files
- Playwright is spawned as argv (no shell). `;&|$` in `--command` is rejected
- Local heals cover known patterns; a generation API is optional.
- The Action must run in a workflow that already installed the app and Playwright.

## CLI

```bash
npx fixloop init
npx fixloop run --command "npx playwright test"
npx fixloop ci --command "npx playwright test"
npx fixloop watch
npx fixloop scan
```

Kane is optional (`oracle: "kane"`). Without Kane or Playwright, Fixloop uses `.fixloop/fixture.json`. `kiro-heal` still forwards to `fixloop` for one release.

## Examples

- [`examples/vite-app`](examples/vite-app) — Vite + Playwright
- [`examples/demo`](examples/demo) — legacy CTA demo

## Docs

- [SECURITY.md](SECURITY.md)
- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

MIT
