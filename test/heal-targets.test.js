import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSpawnBin, splitArgv } from '../src/argv.js';
import { extractPathsFromTrace, resolveHealTargets } from '../src/heal-targets.js';
import { splitUnifiedDiffByFile } from '../src/patch.js';

describe('argv', () => {
  it('splits quoted tokens without a shell', () => {
    const { bin, args } = splitArgv('npx playwright test --config="playwright.config.js"');
    assert.equal(bin, 'npx');
    assert.deepEqual(args, ['playwright', 'test', '--config=playwright.config.js']);
  });

  it('rejects shell metacharacters', () => {
    assert.throws(() => splitArgv('npx playwright test; rm -rf /'), /shell metacharacters/);
    assert.throws(() => splitArgv('npx playwright test && true'), /shell metacharacters/);
  });

  it('allows only known package-manager bins', () => {
    assert.equal(assertSafeSpawnBin('npx'), 'npx');
    assert.throws(() => assertSafeSpawnBin('bash'), /Refusing to spawn/);
  });
});

describe('heal targets from traces', () => {
  it('extracts application files and skips specs', () => {
    const stack = [
      'Error: click failed',
      '    at Object.<anonymous> (src/main.js:12:3)',
      '    at tests/home.spec.js:4:1',
    ].join('\n');
    assert.deepEqual(extractPathsFromTrace(stack), ['src/main.js', 'tests/home.spec.js']);
    const targets = resolveHealTargets({
      repoRoot: '/repo',
      config: { healTarget: 'src/main.js', healAllowlist: ['src/**'] },
      oracleResult: { firstFailure: { stack, file: 'tests/home.spec.js' } },
    });
    assert.deepEqual(targets, ['src/main.js']);
  });
});

describe('multi-file unified diff', () => {
  it('splits diff --git files', () => {
    const diff = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      'diff --git a/src/b.js b/src/b.js',
      '--- a/src/b.js',
      '+++ b/src/b.js',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
    ].join('\n');
    const files = splitUnifiedDiffByFile(diff);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, 'src/a.js');
    assert.equal(files[1].path, 'src/b.js');
  });
});
