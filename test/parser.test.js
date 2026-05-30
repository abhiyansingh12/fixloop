import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStreamParser,
  formatFailureBlock,
  ingestEvent,
  parseLine,
  createAccumulator,
  finalizeAccumulator,
} from '../src/parser.js';

describe('parser', () => {
  it('parses progress and run_end events from a stream', () => {
    const events = [];
    const parser = createStreamParser((e) => events.push(e));

    parser.push('{"step":1,"status":"passed","remark":"ok"}\n');
    parser.push('{"step":2,"status":"failed","remark":"Element covered by modal"}\n');
    parser.push(
      '{"type":"run_end","status":"failed","summary":"Step 2 failed","reason":"assertion"}\n',
    );

    const result = parser.flush(1);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.firstFailure?.step, 2);
    assert.equal(result.firstFailure?.remark, 'Element covered by modal');
    assert.equal(result.runEnd?.type, 'run_end');
    assert.equal(events.length, 3);
  });

  it('ignores invalid lines', () => {
    assert.equal(parseLine('not json'), null);
    assert.equal(parseLine(''), null);
  });

  it('formatFailureBlock includes step and run_end', () => {
    const state = createAccumulator();
    ingestEvent(state, { step: 1, status: 'failed', remark: 'timeout' });
    ingestEvent(state, { type: 'run_end', status: 'failed', summary: 'fail' });
    finalizeAccumulator(state, 1);
    const block = formatFailureBlock(state);
    assert.match(block, /step_failure/);
    assert.match(block, /run_end/);
  });
});
