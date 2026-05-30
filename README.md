# kiro-heal

**Local self-healing** + **GitHub Auto-Verification Bot** powered by [Kane CLI](https://www.npmjs.com/package/@testmuai/kane-cli).

Turn a repository into a self-verifying app: discover routes → generate Kane `testmd` → run browser verification → auto-heal failures → open a PR (GitHub) or fix locally (CLI).

## Quick start (local)

```bash
npm install
npm run dev          # demo server + scan + Kane + heal + watch
```

Or step by step:

```bash
kiro-heal init
kiro-heal run
kiro-heal watch
```

## GitHub bot

```bash
# Terminal 1 — webhook server (needs GitHub App credentials)
cp .env.example .env   # fill GITHUB_* vars
npm run github:serve

# Terminal 2 — trigger verify on a repo
kiro-heal github verify --repo owner/name --installation-id <id>
```

Full setup: [docs/GITHUB_APP.md](docs/GITHUB_APP.md).

**Triggers:** `repository_dispatch` (`kiro-heal-verify`), `/kiro-heal verify` on issues, optional push auto-verify.

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

See `.env.example` for Kane CLI, heal provider (`local` / `auto` / API), and GitHub App variables.

## License

MIT
