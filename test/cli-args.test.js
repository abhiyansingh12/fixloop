import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flagOn, flagString, parseArgv } from '../src/cli-args.js';

describe('cli argv', () => {
  it('parses commands, flags, and --no-* switches', () => {
    const { flags, positionals } = parseArgv([
      'github',
      'verify',
      '--repo',
      'acme/app',
      '--no-pr',
      '--dir=./demo',
    ]);
    assert.deepEqual(positionals, ['github', 'verify']);
    assert.equal(flagString(flags, 'repo'), 'acme/app');
    assert.equal(flagString(flags, 'dir'), './demo');
    assert.equal(flagOn(flags, 'no-pr'), true);
  });

  it('treats --help and --version as flags', () => {
    const a = parseArgv(['--help']);
    const b = parseArgv(['-v']);
    assert.equal(a.flags.help, true);
    assert.equal(b.flags.version, true);
  });
});
