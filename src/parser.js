/**
 * NDJSON stream accumulator — parses Kane CLI --agent stdout line-by-line.
 * Progress events: { step, status, remark }
 * Terminal event:   { type: "run_end", status, summary, reason, ... }
 */

/**
 * @typedef {object} KaneProgressEvent
 * @property {number} step
 * @property {'passed'|'failed'} status
 * @property {string} remark
 */

/**
 * @typedef {object} KaneRunEndEvent
 * @property {'run_end'} type
 * @property {'passed'|'failed'} status
 * @property {string} [summary]
 * @property {string} [reason]
 * @property {Record<string, unknown>} [final_state]
 * @property {Record<string, unknown>} [context]
 */

/**
 * @typedef {object} ParseFailure
 * @property {number} step
 * @property {string} remark
 * @property {KaneProgressEvent} raw
 */

/**
 * @typedef {object} ParseResult
 * @property {'passed'|'failed'|'error'} outcome
 * @property {KaneRunEndEvent|null} runEnd
 * @property {ParseFailure|null} firstFailure
 * @property {KaneProgressEvent[]} steps
 * @property {object[]} events
 */

/**
 * Parse a single NDJSON line from Kane CLI stdout.
 * @param {string} line
 * @returns {object|null}
 */
export function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Classify and ingest one parsed Kane event into accumulator state.
 * @param {object} state
 * @param {object} obj
 */
export function ingestEvent(state, obj) {
  state.events.push(obj);

  if (obj.type === 'run_end') {
    state.runEnd = /** @type {KaneRunEndEvent} */ (obj);
    return;
  }

  if (typeof obj.step === 'number') {
    const progress = /** @type {KaneProgressEvent} */ (obj);
    state.steps.push(progress);
    if (progress.status === 'failed' && !state.firstFailure) {
      state.firstFailure = {
        step: progress.step,
        remark: progress.remark ?? 'Unknown step failure',
        raw: progress,
      };
    }
  }
}

/**
 * @returns {ParseResult}
 */
export function createAccumulator() {
  return {
    outcome: 'error',
    runEnd: null,
    firstFailure: null,
    steps: [],
    events: [],
  };
}

/**
 * Finalize accumulator after stream ends.
 * @param {ReturnType<typeof createAccumulator>} state
 * @param {number} [exitCode]
 * @returns {ParseResult}
 */
export function finalizeAccumulator(state, exitCode = 0) {
  if (state.runEnd) {
    state.outcome = state.runEnd.status === 'passed' ? 'passed' : 'failed';
  } else if (state.firstFailure) {
    state.outcome = 'failed';
  } else if (exitCode !== 0) {
    state.outcome = 'failed';
  } else {
    state.outcome = 'error';
  }
  return state;
}

/**
 * Build an NDJSON failure block string for the healer prompt.
 * @param {ParseResult} result
 * @returns {string}
 */
export function formatFailureBlock(result) {
  const parts = [];

  if (result.firstFailure) {
    parts.push(
      JSON.stringify(
        {
          kind: 'step_failure',
          step: result.firstFailure.step,
          remark: result.firstFailure.remark,
          event: result.firstFailure.raw,
        },
        null,
        2,
      ),
    );
  }

  if (result.runEnd) {
    parts.push(JSON.stringify({ kind: 'run_end', ...result.runEnd }, null, 2));
  }

  if (parts.length === 0) {
    parts.push(
      JSON.stringify(
        {
          kind: 'unknown_failure',
          steps: result.steps,
          exit_hint: 'No run_end or step failure captured',
        },
        null,
        2,
      ),
    );
  }

  return parts.join('\n\n');
}

/**
 * Create a line handler that processes streaming stdout without buffering the full output.
 * @param {(obj: object) => void} [onEvent]
 * @returns {{ push: (chunk: string) => void, flush: () => ParseResult, getState: () => ReturnType<typeof createAccumulator> }}
 */
export function createStreamParser(onEvent) {
  const state = createAccumulator();
  let buffer = '';

  return {
    getState: () => state,

    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const obj = parseLine(line);
        if (!obj) continue;
        ingestEvent(state, obj);
        onEvent?.(obj);
      }
    },

    flush(exitCode = 0) {
      if (buffer.trim()) {
        const obj = parseLine(buffer);
        if (obj) {
          ingestEvent(state, obj);
          onEvent?.(obj);
        }
        buffer = '';
      }
      return finalizeAccumulator(state, exitCode);
    },
  };
}
