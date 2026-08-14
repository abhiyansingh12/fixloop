import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeApiUrl, looksLikeSecretMaterial, redactSecrets } from '../src/secrets.js';
import { resolveChatCompletionsUrl } from '../src/policy.js';

describe('secret redaction', () => {
  it('strips OpenAI, GitHub, and Bearer tokens from logs', () => {
    const raw =
      'failed sk-abcdefghijklmnopqrstuvwxyz123456 with Bearer tok_abc and ghp_abcdefghijklmnopqrstuvwx';
    const redacted = redactSecrets(raw);
    assert.equal(redacted.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);
    assert.equal(redacted.includes('ghp_abcdefghijklmnopqrstuvwx'), false);
    assert.match(redacted, /\*\*\*/);
  });

  it('strips live env values even when they do not match a pattern', () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'custom-local-secret-value-9999';
    try {
      const redacted = redactSecrets('using custom-local-secret-value-9999 in request');
      assert.equal(redacted.includes('custom-local-secret-value-9999'), false);
      assert.match(redacted, /\*\*\*/);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it('detects dotenv dumps and PEM private keys', () => {
    assert.equal(
      looksLikeSecretMaterial('OPENAI_API_KEY=sk-test\nGITHUB_TOKEN=ghp_x\n'),
      true,
    );
    assert.equal(
      looksLikeSecretMaterial('-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----'),
      true,
    );
    assert.equal(looksLikeSecretMaterial("document.getElementById('cta-primary');"), false);
  });
});

describe('generation API URL', () => {
  it('allows https and loopback http', () => {
    assert.doesNotThrow(() => assertSafeApiUrl('https://api.openai.com/v1/chat/completions'));
    assert.doesNotThrow(() => assertSafeApiUrl('http://127.0.0.1:11434/v1/chat/completions'));
  });

  it('refuses plaintext remote URLs so API keys are not sent in the clear', () => {
    assert.throws(
      () => assertSafeApiUrl('http://evil.example/v1/chat/completions'),
      /https/,
    );
    assert.throws(
      () =>
        resolveChatCompletionsUrl({
          FIXLOOP_API_URL: 'http://evil.example/v1',
          OPENAI_API_KEY: 'sk-test-key-must-not-leak',
        }),
      /https/,
    );
  });
});
