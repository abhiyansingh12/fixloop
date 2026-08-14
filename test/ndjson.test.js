import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNdjsonParser } from '../src/ndjson.js';

describe('ndjson parser', () => {
  it('parses complete lines and a trailing object', () => {
    const objects = [];
    const parser = createNdjsonParser({ onObject: (o) => objects.push(o) });
    parser.push('{"a":1}\n{"b":2}\n{"c":');
    parser.push('3}');
    parser.end();
    assert.deepEqual(objects, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('skips invalid lines', () => {
    const objects = [];
    const invalid = [];
    const parser = createNdjsonParser({
      onObject: (o) => objects.push(o),
      onInvalid: (_err, line) => invalid.push(line),
    });
    parser.push('not-json\n{"ok":true}\n\n');
    parser.end();
    assert.deepEqual(objects, [{ ok: true }]);
    assert.deepEqual(invalid, ['not-json']);
  });
});
