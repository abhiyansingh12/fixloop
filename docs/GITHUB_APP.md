# GitHub Auto-Verification Bot

kiro-heal runs **locally** (CLI) and as a **GitHub App** (webhooks). Both paths use the same pipeline: scan → Kane tests → verify → heal → re-verify → PR.

## Architecture

```
GitHub repo
    │
    ├─► Webhook (repository_dispatch / comment / push*)
    │         └─► kiro-heal github serve
    │                   └─► clone → detect → Kane → heal → PR
    │
    └─► Local CLI (kiro-heal start / run / watch)
              └─► same pipeline on your machine
```

\* Push auto-verify only when `KIRO_HEAL_GITHUB_AUTO_PUSH=1`.

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
KIRO_HEAL_GITHUB_PORT=3939
```

For local verify without the App (PAT only):

```bash
GITHUB_TOKEN=ghp_...
kiro-heal github verify --repo your-org/your-repo --no-pr
```

## 3. Run the webhook server

```bash
npm install
npm run github:serve
```

Expose with ngrok or deploy to Railway/Fly/Render:

```bash
ngrok http 3939
```

Update the GitHub App webhook URL to the public URL.

## 4. Trigger verification

### Repository dispatch (recommended)

```bash
gh api repos/OWNER/REPO/dispatches \
  -f event_type=kiro-heal-verify \
  -f client_payload='{"ref":"main"}'
```

### Issue comment

Comment on any issue:

```
/kiro-heal verify
```

### CLI (manual)

```bash
kiro-heal github verify --repo owner/repo --installation-id 12345678
```

## 5. What the bot creates

- `.kiro-heal/smoke.testmd` — Kane tests from discovered routes & flows
- `.kiro-heal/verification-report.md` — pass/fail report
- `.kiro-heal/analysis.json` — structured metadata
- Healed source files (when the heal loop fixes regressions)
- **Pull request** on branch `kiro-heal/verify-<timestamp>`

## Flow discovery

Routes are scanned from Next.js, Vite, and static HTML layouts. Paths are tagged as `login`, `signup`, `dashboard`, `checkout`, `settings`, `search`, `crud`, or `navigation` for richer Kane steps.

## CI without hosted bot

Copy `templates/github/kiro-heal-verify.yml` to `.github/workflows/` in target repos, or run `kiro-heal run` in your own Actions job.
