# GitHub App (optional)

The OSS install path is the **GitHub Action** (`templates/github/fixloop.yml`). A hosted App from a hackathon repo is not the product. This document is the secondary webhook server if you already have App credentials.

fixloop’s rule is the same on every path: triage → patch only on `product_regression` → re-run the same command → **draft PR only if green**. Still red → no PR. `test_defect` → “update the test, I will not.”

## Architecture

```
GitHub repo
    │
    ├─► GitHub Action (primary): Playwright red → fixloop/action
    │
    ├─► Webhook (optional): repository_dispatch / comment / push*
    │         └─► fixloop github serve
    │                   └─► clone → Playwright/fixture → triage → heal → re-run → draft PR if green
    │
    └─► Local CLI (npx fixloop run)
```

\* Push auto-verify only when `FIXLOOP_GITHUB_AUTO_PUSH=1`.

`/fixloop verify` comments are accepted only from **OWNER**, **MEMBER**, or **COLLABORATOR**.

The bot reuses a single `fixloop/verify` branch (and an existing open bot PR) instead of opening a new PR on every run. PRs are **draft**. There is **no auto-merge**.

Automated PRs from the **local** CLI/watchdog are off unless `FIXLOOP_OPEN_PR=1`.

## 1. Create a GitHub App

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. **Webhook URL:** `https://YOUR_HOST/api/github/webhooks`
3. **Webhook secret:** generate and save as `GITHUB_WEBHOOK_SECRET`
4. **Permissions:**
   - Contents: Read & write
   - Pull requests: Read & write
   - Issues: Read & write
   - Metadata: Read
5. **Subscribe to events:**
   - Installation
   - Repository dispatch
   - Issue comment
   - Push (optional)
6. Generate a **private key** → save PEM as `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH`

Note the **App ID** → `GITHUB_APP_ID`.

## 2. Configure environment

Copy `.env.example` and set:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=./github-app.pem
GITHUB_WEBHOOK_SECRET=your-webhook-secret
FIXLOOP_GITHUB_PORT=3939
```

For local verify without the App (PAT only):

```bash
GITHUB_TOKEN=ghp_...
npx fixloop github verify --repo your-org/your-repo --no-pr
```

## 3. Run the webhook server

```bash
npm install
npm run github:serve
```

Expose with ngrok or deploy, then update the GitHub App webhook URL.

## 4. Trigger verification

### Repository dispatch

```bash
gh api repos/OWNER/REPO/dispatches \
  -f event_type=fixloop-verify \
  -f client_payload='{"ref":"main"}'
```

Legacy event type `kiro-heal-verify` is still accepted.

### Issue comment

```
/fixloop verify
```

`/kiro-heal verify` still matches.

### CLI

```bash
npx fixloop github verify --repo owner/repo --installation-id 12345678
```

## 5. What the bot creates (only if the re-run is green)

- `.fixloop/smoke.testmd`
- `.fixloop/verification-report.md`
- `.fixloop/analysis.json`
- Healed source files (product_regression only)
- **Draft** pull request on `fixloop/verify`

If the suite is still red, Fixloop comments the triage and **does not open a PR**.

## Prefer the Action

Copy `templates/github/fixloop.yml` into the target repo. That is the install path strangers will actually use.
