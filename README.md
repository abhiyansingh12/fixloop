# kiro-heal

**Local self-healing** + **GitHub Auto-Verification Bot**. Scan a repo, generate Kane `testmd` smoke tests, run browser verification (or an offline simulator), auto-heal failures, and optionally open a PR.

> This repository is named `hackkk` on GitHub. The CLI, npm package, and docs use **kiro-heal**. Older bot PRs may still say "LoopVision" — that was the hackathon name for the same tool.

## Quick start (local)

```bash
npm install
cp .env.example .env   # optional
npm test               # unit + simulated pipeline tests
npm run dev            # demo server + scan + heal + watch (injects a demo bug)
```

Or step by step:

```bash
npx kiro-heal init --broken   # --broken only for this demo app
npx kiro-heal run
npx kiro-heal watch
```

Kane CLI is optional. If `kane-cli` is missing or not logged in, kiro-heal uses an offline NDJSON simulator so the loop still runs.

## GitHub bot

```bash
# Terminal 1 — webhook server (needs GitHub App credentials)
cp .env.example .env   # fill GITHUB_* vars
npm run github:serve

# Terminal 2 — trigger verify on a repo
kiro-heal github verify --repo owner/name --installation-id <id>
```

Full setup: [docs/GITHUB_APP.md](docs/GITHUB_APP.md).

**Triggers:** `repository_dispatch` (`kiro-heal-verify`), `/kiro-heal verify` on issues (collaborators only), optional push auto-verify.

Automated pull requests are **off by default**. Set `KIRO_HEAL_OPEN_PR=1` when you actually want the bot to open or update a PR. Existing open `kiro-heal/*` PRs are reused instead of creating a new branch every run.

## Commands

| Command | Description |
|--------|-------------|
| `kiro-heal init` | Scan repo, scaffold `.kiro-heal/smoke.testmd` |
| `kiro-heal start` | Demo server + init + E2E heal + watch |
| `kiro-heal run` | One-shot Kane + heal loop |
| `kiro-heal watch` | Re-run on file changes |
| `kiro-heal scan` | Regenerate testmd only |
| `kiro-heal github serve` | Webhook server for GitHub App |
| `kiro-heal github verify` | Clone remote repo, verify, open PR |

## Environment

See [`.env.example`](.env.example) for Kane CLI, heal provider (`local` / `auto` / API), GitHub App variables, and `KIRO_HEAL_OPEN_PR`.

The CLI loads `.env` from the current working directory on startup.

## License

MIT
