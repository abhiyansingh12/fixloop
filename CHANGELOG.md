# Changelog

## 1.0.1

- Zero runtime npm dependencies (GitHub REST, webhook HMAC, NDJSON, and file watching use Node builtins)
- GitHub Action uses `github.token` by default (no `GITHUB_TOKEN` env required in the consumer workflow)
- Action outputs: `triage`, `verified`, `passed`, `healed`
- Template pins `abhiyansingh12/fixloop@v1.0.1` instead of `@main`
- Timeouts on UI assertions against application code are `product_regression`, not `flake`
- CI on Node 18 and 22; `node --check` on every JS file
- Maintainer-only docs removed from the public tree and npm tarball

## 1.0.0

- First npm publish: triage `product_regression` | `test_defect` | `flake`
- Only `product_regression` may write application code
- Re-run the same Playwright command; still red → no PR
- Draft PRs on `fixloop/auto-fix`; no auto-merge
