# Security

fixloop clones repositories, installs dependencies, starts a dev server, and may rewrite source files. Treat it as a privileged automation agent.

## GitHub Action (primary)

Minimum permissions on the consumer workflow:

- Contents: Read & write (commit healed files)
- Pull requests: Read & write (draft PRs only)

Do **not** grant administration, secrets, or workflow scopes. Do **not** auto-merge.

The Action:

- Re-runs the same Playwright command after a patch
- Opens a PR only if that re-run is green
- Opens that PR as a **draft** on `fixloop/auto-fix`
- Never writes tests (`test_defect` → “update the test, I will not.”)
- Never writes `.env`, `*.pem`, lockfiles, or paths outside `healAllowlist`

## GitHub App (optional / secondary)

Minimum permissions if you still run `fixloop github serve`:

- Contents: Read & write
- Pull requests: Read & write
- Issues: Read & write (comment replies)
- Metadata: Read

Webhook requirements:

- `GITHUB_WEBHOOK_SECRET` is required; unsigned payloads are rejected
- `/fixloop verify` is accepted only from OWNER, MEMBER, or COLLABORATOR
- One verification job runs per repository at a time
- Clone tokens are passed as `Authorization: Bearer` headers, not in the git remote URL

## Local healer

- Automated PRs stay off unless `FIXLOOP_OPEN_PR=1` (Actions may draft after a green re-run)
- Writes are limited to `healAllowlist` (default: `src/`, `app/`, `pages/`, `public/`, `demo/`, `examples/`, `components/`, `lib/`, `routes/`)
- `.env`, `*.pem`, lockfiles, `node_modules`, and `.git` are denylisted
- Prefer unified diffs; empty writes are refused
- Watch-mode `import()` of changed JS is off unless `FIXLOOP_RUNTIME_CHECK=1`

## Secrets

Never commit `.env`, `github-app.pem`, or GitHub App private keys. Rotate a leaked webhook secret or App key immediately.

## Reporting

Open a private report via GitHub Security Advisories on this repository, or email the maintainer listed on the GitHub profile.
