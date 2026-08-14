# Publish fixloop to npm

There is no compile step. The package is ESM JavaScript. `npm publish` packs `bin/`, `src/`, `action.yml`, and docs. Tests run first (`prepublishOnly`).

Do **not** put an npm token in the repo, in a workflow file, or in a chat. If a token was pasted anywhere, revoke it on npm (**Access Tokens → Delete**). You do not need a replacement token if Trusted Publisher is set up.

## 1. First publish — done

[`fixloop@1.0.0`](https://www.npmjs.com/package/fixloop) is on npm (`abhiyansingh`). It went out from a laptop with `--no-provenance` (provenance only works on GitHub Actions). Later versions should go out via GitHub Release.

The GitHub tree is **1.0.1** (zero runtime npm dependencies). After Trusted Publisher is saved, cut a GitHub Release tagged `v1.0.1` so npm matches.

```bash
npm install -g fixloop
npx fixloop --help
```

## 2. Trusted Publisher (do this now)

This is how later versions publish. No long-lived write token. No OTP on CI.

1. [npmjs.com/package/fixloop/access](https://www.npmjs.com/package/fixloop/access) → **Trusted Publisher**
2. GitHub Actions:
   - Organization or user: `abhiyansingh12`
   - Repository: `fixloop`
   - Workflow filename: `publish.yml` (filename only, including `.yml`)
   - Environment name: **leave empty** (the workflow does not use a GitHub environment)
   - Allowed actions: check **Allow npm publish** only. Leave **Allow npm stage publish** unchecked (`publish.yml` runs `npm publish`, not `npm stage publish`)
3. **Set up connection**

OIDC is already on the workflow (`permissions: id-token: write`). Node in that workflow is 22+, which npm requires for trusted publishing.

You do **not** need a GitHub `NPM_TOKEN` secret for this path.

## 3. Later versions (GitHub Release)

Do not republish `1.0.0`.

1. Bump `"version"` in `package.json` (never reuse a version)
2. Commit and push to `main`
3. GitHub → **Releases → Draft a new release**
   - Tag: `v1.0.1` (must match the package version)
   - Target: `main`
   - Publish release

That runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). You can also run **Actions → Publish npm package → Run workflow**.

## 4. Optional: GitHub `NPM_TOKEN`

Skip this unless Trusted Publisher is not saved yet and you still need a CI fallback.

1. npmjs.com → **Access Tokens** → new **granular** token
   - Packages: **Read and write** (or only `fixloop`)
   - Organizations: **No access** (required if you have no orgs)
2. GitHub repo **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the new token

Once Trusted Publisher works, delete that token on npm and remove the GitHub secret.

## 5. After a leaked token

1. npm → **Access Tokens → Delete** the leaked token
2. Anyone who saw it can publish as you until you delete it
3. Do not create a replacement if Trusted Publisher is already connected

## 6. Laptop publish (last resort)

Only if GitHub Actions cannot publish. Never reuse a version that is already on npm.

```bash
git checkout main
git pull
npm ci
FIXLOOP_OPEN_PR=0 npm test
npm whoami                               # expect abhiyansingh
npm publish --access public --no-provenance
```

If a browser opens, complete **passkey** login. Do **not** pass `--otp=` unless you use a TOTP authenticator app.
