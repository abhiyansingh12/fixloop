# Contributing

## Setup

```bash
git clone https://github.com/abhiyansingh12/fixloop
cd fixloop
npm ci
```

Node 18 or newer.

## Tests

```bash
FIXLOOP_OPEN_PR=0 npm test
npm run lint
```

Do not add runtime npm dependencies. GitHub, NDJSON, and watching must stay on Node builtins.

## Product rules (do not weaken)

- Only `product_regression` may write application code
- `test_defect` must keep the sentence **update the test, I will not.**
- Flakes are not patched
- A still-red re-run must not open a PR
- PRs are draft; never auto-merge
- `.env`, keys, PEM, `.npmrc`, and `.aws/` stay denylisted even if `healTarget` points at them

## Pull requests

- Add or update a test with the behavior change
- Note the change in `CHANGELOG.md`
- Keep the Action pinned to a released tag in `templates/github/fixloop.yml`
