# Changelog

## 1.0.2

- npm publish from GitHub Actions uses npm 11 + OIDC (Trusted Publisher). Empty `NODE_AUTH_TOKEN` no longer blocks auth.
- Release workflow fails if the Git tag does not match `package.json` version.

## 1.0.1

- Zero runtime npm dependencies (GitHub REST, webhook HMAC, NDJSON, and file watching use Node builtins)
- GitHub Action uses `github.token` by default (no `GITHUB_TOKEN` env required in the consumer workflow)
- Action outputs: `triage`, `verified`, `passed`, `healed`
- Template pins `abhiyansingh12/fixloop@v1.0.2` instead of `@main`
- Timeouts on UI assertions against application code are `product_regression`, not `flake`
- Heal targets come from config **and** Playwright stacks; multi-file unified diffs apply per allowlisted file
- Playwright `--command` is argv-only (no shell)
- Public TypeScript types (`index.d.ts`); CodeQL on `main`
- CI on Node 18 and 22; `node --check` on every JS file
- Maintainer-only docs removed from the public tree and npm tarball

## 1.0.0

- First npm publish: triage `product_regression` | `test_defect` | `flake`
- Only `product_regression` may write application code
- Re-run the same Playwright command; still red → no PR
- Draft PRs on `fixloop/auto-fix`; no auto-merge
