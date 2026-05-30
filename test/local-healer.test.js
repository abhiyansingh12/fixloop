import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tryLocalHeal } from '../src/local-healer.js';
import { createAccumulator, ingestEvent, finalizeAccumulator } from '../src/parser.js';

describe('local-healer', () => {
  it('fixes broken CTA selector in main.js', () => {
    const broken = "document.getElementById('cta-primary-broken');";
    const state = createAccumulator();
    ingestEvent(state, {
      step: 3,
      status: 'failed',
      remark: 'Could not click Get started button',
    });
    finalizeAccumulator(state, 1);

    const fixed = tryLocalHeal('/app/demo/public/js/main.js', broken, state);
    assert.ok(fixed?.includes('cta-primary'));
    assert.ok(!fixed?.includes('cta-primary-broken'));
  });
});
