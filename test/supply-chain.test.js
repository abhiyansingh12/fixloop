import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createWebhookHub, verifyGitHubSignature } from '../src/github/webhooks.js';
import { createAppJwt } from '../src/github/jwt.js';
import { shouldSkipWatchPath } from '../src/watch-files.js';
import { createGitHubClient, GitHubHttpError } from '../src/github/api.js';
import { readFileSync } from 'node:fs';

describe('GitHub webhook signature', () => {
  it('accepts a valid sha256 HMAC and rejects a bad one', () => {
    const secret = 's3cret';
    const body = '{"ok":true}';
    const good = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    assert.doesNotThrow(() => verifyGitHubSignature(secret, body, good));
    assert.throws(() => verifyGitHubSignature(secret, body, good.replace(/.$/, '0')), /Invalid webhook signature/);
    assert.throws(() => verifyGitHubSignature(secret, body, ''), /Missing webhook signature/);
  });

  it('dispatches event.action after verification', async () => {
    const secret = 's3cret';
    const payload = JSON.stringify({ action: 'created', comment: { body: 'hi' } });
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
    const hub = createWebhookHub({ secret });
    const seen = [];
    hub.on('issue_comment.created', ({ payload: p }) => seen.push(p.action));
    await hub.verifyAndReceive({ name: 'issue_comment', payload, signature });
    assert.deepEqual(seen, ['created']);
  });
});

describe('GitHub App JWT', () => {
  it('signs an RS256 token that verifies with the public key', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const jwt = createAppJwt(42, pem, 1_700_000_000);
    const [header, payload, signature] = jwt.split('.');
    const ok = crypto.verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    );
    assert.equal(ok, true);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(claims.iss, '42');
  });
});

describe('package.json', () => {
  it('has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
  });
});

describe('GitHub REST client', () => {
  it('calls api.github.com with a bearer token and surfaces status', async () => {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ default_branch: 'main' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    try {
      const gh = createGitHubClient('tok');
      const { data } = await gh.repos.get({ owner: 'acme', repo: 'app' });
      assert.equal(data.default_branch, 'main');
      assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app');
      assert.match(calls[0].init.headers.Authorization, /^Bearer tok$/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws GitHubHttpError with status', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 });
    try {
      const gh = createGitHubClient('tok');
      await assert.rejects(() => gh.git.createRef({ owner: 'a', repo: 'b', ref: 'refs/heads/x', sha: '1' }), (err) => {
        assert.equal(err instanceof GitHubHttpError, true);
        assert.equal(err.status, 422);
        return true;
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('watch skip paths', () => {
  it('skips node_modules, .git, and lockfiles', () => {
    assert.equal(shouldSkipWatchPath('/app/node_modules/foo.js'), true);
    assert.equal(shouldSkipWatchPath('/app/.git/HEAD'), true);
    assert.equal(shouldSkipWatchPath('/app/package-lock.json'), true);
    assert.equal(shouldSkipWatchPath('/app/src/main.js'), false);
  });
});
