# kiro-heal

**Local self-healing** + **GitHub Auto-Verification Bot**. Scan a repo, generate Kane `testmd` smoke tests, run browser verification (or an offline fixture simulator), auto-heal failures, and optionally open a PR.

> GitHub repo: [`abhiyansingh12/hackkk`](https://github.com/abhiyansingh12/hackkk). The CLI and npm package are **kiro-heal**.

## Install

```bash
# from this repository (until the package is published)
npm install github:abhiyansingh12/hackkk

# after npm publish
# npm install -g kiro-heal
```

Real browser verification uses optional [`@testmuai/kane-cli`](https://www.npmjs.com/package/@testmuai/kane-cli):

```bash
npm install -D @testmuai/kane-cli
kane-cli login
```

Without Kane, kiro-heal uses a **recorded fixture** (`.kiro-heal/fixture.json`, see `templates/fixture.json`). Copy that file into a target repo to describe pass/fail markers for the heal target.

## Quick start (local)

```bash
npm install
cp .env.example .env   # optional
npm test
npm run dev            # demo server + scan + heal + watch (injects a demo bug)
```

```bash
npx kiro-heal init --broken   # --broken only for this demo app
npx kiro-heal run
npx kiro-heal watch
```

## GitHub bot

```bash
cp .env.example .env   # fill GITHUB_* vars
npm run github:serve
kiro-heal github verify --repo owner/name --installation-id <id>
```

Full setup: [docs/GITHUB_APP.md](docs/GITHUB_APP.md). Security notes: [SECURITY.md](SECURITY.md).

**Triggers:** `repository_dispatch` (`kiro-heal-verify`), `/kiro-heal verify` on issues (collaborators only), optional push auto-verify.

Automated pull requests are **off by default**. Set `KIRO_HEAL_OPEN_PR=1` to allow the bot to open or update a PR. Existing open `kiro-heal/*` PRs are reused.

Heals are limited to `healAllowlist` in `.kiro-heal.json` (source folders only). The model is asked for a unified diff; whole-file overwrites are a fallback.

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

See [`.env.example`](.env.example). The CLI loads `.env` from the current working directory on startup.

To publish the npm package, add `NPM_TOKEN` to repo secrets and create a GitHub Release. The [publish workflow](.github/workflows/publish.yml) runs tests and `npm publish`.

## License

MIT
