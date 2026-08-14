import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferPortFromScript, pickStartPlan } from '../src/github/detect.js';
import { applyPortToArgs } from '../src/github/runtime.js';

describe('start plan', () => {
  it('prefers npm run dev over a guessed index.js', () => {
    const plan = pickStartPlan({
      framework: 'next',
      pkg: { scripts: { dev: 'next dev --port 4000', start: 'next start' } },
      serverEntry: 'index.js',
    });
    assert.equal(plan.startCommand === 'npm' || plan.startCommand === 'npm.cmd', true);
    assert.deepEqual(plan.startArgs, ['run', 'dev']);
    assert.equal(plan.port, 4000);
  });

  it('keeps the demo server as node demo/server.js', () => {
    const plan = pickStartPlan({
      framework: 'static-demo',
      pkg: { scripts: { start: 'node bin/kiro-heal.js start' } },
      serverEntry: 'demo/server.js',
    });
    assert.equal(plan.startCommand, 'node');
    assert.deepEqual(plan.startArgs, ['demo/server.js']);
  });

  it('rewrites -p flags when GitHub verify picks a random port', () => {
    assert.deepEqual(applyPortToArgs(['next', 'dev', '-p', '3000'], 4123), [
      'next',
      'dev',
      '-p',
      '4123',
    ]);
  });

  it('parses ports from scripts', () => {
    assert.equal(inferPortFromScript('vite --port 5173'), 5173);
  });
});
