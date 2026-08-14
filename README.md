# fixloop

Triage is the feature. Every failure gets one label: `product_regression`, `test_defect`, or `flake`. **Only `product_regression` may write application code.** `test_defect` comments **“update the test, I will not.”** That single rule is why you would use this instead of a generic coding agent.

Playwright is the default oracle. Fixloop reads the JSON report from the same command CI already ran. Kane stays as an optional adapter. You do not `kane-cli login` to try an unknown GitHub App.

The OSS install path is a **GitHub Action**, not a hosted App. Drop in a workflow that runs when Playwright goes red. After a patch, Fixloop **re-runs the same command**. If the suite is still red, **it does not open a PR.**

Safety is the product: allowlist, unified diffs, no `.env`, one stable branch (`fixloop/auto-fix`), **draft PR**, **no auto-merge**.

```
npx fixloop
.fixloop.json
uses: abhiyansingh12/fixloop@main   # Action name: fixloop/action (root action.yml)
```

> Product name is **fixloop** (`npx fixloop`, `.fixloop.json`, Action `fixloop/action`). GitHub: [`abhiyansingh12/fixloop`](https://github.com/abhiyansingh12/fixloop).

## Install (GitHub Action)

Copy [`templates/github/fixloop.yml`](templates/github/fixloop.yml) into `.github/workflows/fixloop.yml` in your app repo:

```yaml
- name: Fixloop
  uses: abhiyansingh12/fixloop@main
  with:
    command: npx playwright test
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Permissions needed: `contents: write`, `pull-requests: write`. The Action runs `npx playwright test` (or your `--command`), triages the JSON report, patches **only** on `product_regression`, re-runs the **same** command, and opens a **draft** PR on `fixloop/auto-fix` only if that re-run is green.

## Golden path (Vite + Playwright)

The README path is a real Vite app with a real Playwright spec — not the old CTA demo.

```bash
cd examples/vite-app
npm install
npx playwright install chromium
npm test
```

Break the click handler in `examples/vite-app/src/main.js`, then from the repo root:

```bash
```bash
npm install -g fixloop
# until 1.0.0 is on npm:
# npm install github:abhiyansingh12/fixloop
npx fixloop run --dir examples/vite-app --command "npx playwright test"
```

Add `.fixloop.json` in the app:

```json
{
  "oracle": "playwright",
  "healTarget": "src/main.js",
  "playwrightCommand": "npx playwright test"
}
```

A Next app is the same shape: point `healTarget` at `app/page.tsx` (or `src/app/page.tsx`) and keep `playwrightCommand` as the command CI already uses.

## Triage

| Label | What Fixloop does |
| --- | --- |
| `product_regression` | Patch allowlisted application code, re-run the same command, draft PR only if green |
| `test_defect` | Comment **update the test, I will not.** No writes. |
| `flake` | Not patching. Timeouts, net errors, passed-on-retry. |

## Safety

- Writes limited to `healAllowlist` in `.fixloop.json` (default: `src/`, `app/`, `pages/`, `public/`, `examples/`, …)
- `.env`, `*.pem`, `*.key`, SSH keys, `.npmrc`, lockfiles, `node_modules`, `.git` are denylisted
- API error bodies, PR text, and logs run through secret redaction (`sk-`, `ghp_`, live `OPENAI_API_KEY` / `GITHUB_TOKEN`)
- Generation APIs must be https (or localhost). Keys go in `.env` or Actions secrets, never in the workflow file.
- Prefer unified diffs; empty writes are refused
- One stable branch: `fixloop/auto-fix`
- Draft PRs only. Never auto-merge
- Local CLI does not open PRs unless `FIXLOOP_OPEN_PR=1`
- GitHub Actions may open a draft PR after a **green** re-run (`GITHUB_TOKEN`); set `FIXLOOP_OPEN_PR=0` to disable

## CLI

```bash
npx fixloop init
npx fixloop run --command "npx playwright test"
npx fixloop ci --command "npx playwright test"
npx fixloop watch
npx fixloop scan
```

| Command | Description |
| --- | --- |
| `fixloop init` | Scan routes, write `.fixloop/smoke.testmd` |
| `fixloop run` | Triage → maybe heal → re-run |
| `fixloop ci` | Action entry: same as run; `test_defect` exits 0; still-red exits 1 and **does not** open a PR |
| `fixloop watch` | Re-run on file changes |
| `fixloop scan` | Regenerate smoke testmd |
| `fixloop start` | Optional example server + init + run + watch (`examples/demo`) |
| `fixloop github serve` | Optional webhook server (secondary to the Action) |
| `fixloop github verify` | Optional clone + verify (secondary) |

Kane is optional: `oracle: "kane"` in `.fixloop.json`, or `FIXLOOP_ORACLE=kane`. Without Kane or Playwright, Fixloop uses a recorded fixture (`.fixloop/fixture.json`).

## Examples

- **Golden path:** [`examples/vite-app`](examples/vite-app) — Vite + Playwright
- **Legacy CTA demo:** [`examples/demo`](examples/demo) — `cta-primary-broken` lives here, not in the README path

## Environment

See [`.env.example`](.env.example). `FIXLOOP_*` is canonical; `KIRO_HEAL_*` is read for one release.

## Publish to npm

Step-by-step: [docs/PUBLISH.md](docs/PUBLISH.md).

Short version: first publish from your laptop with `--otp=` (npm 2FA). Then add a **new** granular token as GitHub secret `NPM_TOKEN`, turn on Trusted Publisher for workflow `publish.yml`, and cut a GitHub Release (`v1.0.1`, …) to publish later versions.

## License

MIT
