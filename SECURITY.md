# Security

kiro-heal clones repositories, installs dependencies, starts a dev server, and may rewrite source files. Treat it as a privileged automation agent.

## GitHub App

Minimum permissions:

- Contents: Read & write (clone + commit healed files)
- Pull requests: Read & write
- Issues: Read & write (comment replies)
- Metadata: Read

Do **not** grant administration, secrets, or workflow scopes.

Webhook requirements:

- `GITHUB_WEBHOOK_SECRET` is required; unsigned payloads are rejected
- `/kiro-heal verify` is accepted only from OWNER, MEMBER, or COLLABORATOR
- One verification job runs per repository at a time
- Clone tokens are passed as `Authorization: Bearer` headers, not in the git remote URL

## Local healer

- Automated PRs stay off unless `KIRO_HEAL_OPEN_PR=1`
- Writes are limited to `healAllowlist` (default: `src/`, `app/`, `pages/`, `public/`, `demo/`, `components/`, `lib/`, `routes/`)
- `.env`, `*.pem`, lockfiles, `node_modules`, and `.git` are denylisted
- Prefer unified diffs; empty writes are refused
- Watch-mode `import()` of changed JS is off unless `KIRO_HEAL_RUNTIME_CHECK=1`

## Secrets

Never commit `.env`, `github-app.pem`, or GitHub App private keys. Rotate a leaked webhook secret or App key immediately.

## Reporting

Open a private report via GitHub Security Advisories on this repository, or email the maintainer listed on the GitHub profile.
