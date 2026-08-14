import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertHealPathAllowed, matchGlob } from '../src/allowlist.js';

describe('allowlist', () => {
  it('matches ** globs including root files', () => {
    assert.equal(matchGlob('demo/public/js/main.js', 'demo/**'), true);
    assert.equal(matchGlob('.env', '**/.env'), true);
    assert.equal(matchGlob('src/foo.js', 'src/**'), true);
    assert.equal(matchGlob('secret.pem', '**/*.pem'), true);
  });

  it('allows demo heal target and rejects secrets', () => {
    const ok = assertHealPathAllowed(
      '/repo',
      '/repo/demo/public/js/main.js',
      undefined,
      undefined,
      'demo/public/js/main.js',
    );
    assert.equal(ok.rel, 'demo/public/js/main.js');

    assert.throws(() => assertHealPathAllowed('/repo', '/repo/.env'));
    assert.throws(() => assertHealPathAllowed('/repo', '/etc/passwd'));
    assert.throws(() =>
      assertHealPathAllowed('/repo', '/repo/node_modules/left-pad/index.js'),
    );
  });
});
