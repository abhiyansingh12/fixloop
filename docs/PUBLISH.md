# Publish fixloop to npm

There is no compile step. The package is ESM JavaScript. `npm publish` packs `bin/`, `src/`, `action.yml`, and docs. Tests run first (`prepublishOnly`).

Do **not** put an npm token in the repo, in a workflow file, or in a chat. If a token was pasted anywhere, revoke it on npm (**Access Tokens → Delete**) and create a new one.

## 1. First publish — done

[`fixloop@1.0.0`](https://www.npmjs.com/package/fixloop) is on npm (`abhiyansingh`).

That first publish was from a laptop with `--no-provenance` (provenance only works on GitHub Actions). Later versions should go out via GitHub Release so they get provenance.

Laptop publish (if you ever need it again):

```bash
git checkout main
git pull
npm ci
FIXLOOP_OPEN_PR=0 npm test
npm whoami                               # expect abhiyansingh
npm publish --access public --no-provenance
```

If a browser opens, complete **passkey** login. Do **not** pass `--otp=` unless you use a TOTP authenticator app. Never reuse a version that is already on npm.

```bash
npm install -g fixloop
npx fixloop --help
```

## 2. GitHub secret (later versions)

1. npmjs.com → **Access Tokens** → new **granular** token
   - Packages: **Read and write** (or only `fixloop`)
   - Organizations: **No access** (required if you have no orgs)
2. GitHub repo **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the new token

## 3. Trusted Publisher (no OTP on CI)

The package is on npm. Wire Trusted Publisher so CI can publish without a one-time password:

1. [npmjs.com/package/fixloop](https://www.npmjs.com/package/fixloop) → **Settings → Trusted Publisher**
2. Add GitHub Actions:
   - Organization or user: `abhiyansingh12`
   - Repository: `fixloop`
   - Workflow filename: `publish.yml`
3. Save

Later publishes can use OIDC (`id-token: write` is already on the workflow). Keep `NPM_TOKEN` as a fallback until Trusted Publisher is saved.

## 4. Later versions (GitHub Release)

1. Merge the work into `main`
2. Bump `"version"` in `package.json` (never reuse a version)
3. Commit, push, merge
4. GitHub → **Releases → Draft a new release**
   - Tag: `v1.0.1` (match the package version)
   - Target: `main`
   - Publish release

That runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). You can also run the workflow by hand: **Actions → Publish npm package → Run workflow**.

## 5. After a leaked token

1. npm → **Access Tokens → Delete** the leaked token
2. Create a new granular token
3. Update the GitHub secret `NPM_TOKEN`
4. Anyone who saw the old token can publish as you until you delete it
