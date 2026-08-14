/**
 * Line-delimited JSON parser. Replaces the `ndjson` package.
 * @param {object} opts
 * @param {(obj: object) => void} opts.onObject
 * @param {(err: Error, line: string) => void} [opts.onInvalid]
 */
export function createNdjsonParser({ onObject, onInvalid }) {
  let buf = '';

  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onObject(JSON.parse(trimmed));
    } catch (err) {
      onInvalid?.(err instanceof Error ? err : new Error(String(err)), trimmed);
    }
  }

  return {
    /** @param {string} chunk */
    push(chunk) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    },
    end() {
      if (buf) handleLine(buf);
      buf = '';
    },
  };
}
