/**
 * Detect a unified diff (optionally wrapped in a markdown fence).
 * @param {string} text
 */
export function looksLikeUnifiedDiff(text) {
  const body = unwrapFence(text);
  return /^(diff --git |--- |\+\+\+ )/m.test(body) && /@@\s*-\d/.test(body);
}

/**
 * @param {string} text
 */
export function unwrapFence(text) {
  const fenced = String(text ?? '').match(/```(?:diff|patch|udiff|text)?\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Apply a single-file unified diff to `original`.
 * @param {string} original
 * @param {string} diffText
 * @returns {string}
 */
export function applyUnifiedDiff(original, diffText) {
  const body = unwrapFence(diffText);
  const origLines = original.split('\n');
  const hunks = parseHunks(body);
  if (hunks.length === 0) {
    throw new Error('Diff contained no hunks');
  }

  let lines = origLines;
  for (const hunk of hunks.slice().reverse()) {
    lines = applyHunk(lines, hunk);
  }
  return lines.join('\n');
}

/**
 * Split a multi-file unified diff into `{ path, body }` entries.
 * @param {string} diffText
 * @returns {{ path: string, body: string }[]}
 */
export function splitUnifiedDiffByFile(diffText) {
  const body = unwrapFence(diffText);
  const files = [];
  /** @type {{ path: string, lines: string[] }|null} */
  let current = null;

  const flush = () => {
    if (current?.path) files.push({ path: current.path, body: current.lines.join('\n') });
    current = null;
  };

  for (const line of body.split('\n')) {
    const git = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (git) {
      flush();
      current = { path: git[2], lines: [line] };
      continue;
    }
    const minus = line.match(/^--- (?:a\/)?(.+)$/);
    if (minus && !line.startsWith('--- /dev/null')) {
      if (!current) current = { path: minus[1], lines: [] };
      else if (!current.path) current.path = minus[1];
      current.lines.push(line);
      continue;
    }
    const plus = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (plus) {
      if (current && plus[1] !== '/dev/null') current.path = plus[1];
      current?.lines.push(line);
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return files;
}

/**
 * @param {string} original
 * @param {string} incoming
 */
export function applyHealContent(original, incoming) {
  if (looksLikeUnifiedDiff(incoming)) {
    return applyUnifiedDiff(original, incoming);
  }
  return incoming;
}

/**
 * @param {string} diffText
 */
function parseHunks(diffText) {
  const lines = diffText.split('\n');
  const hunks = [];
  let current = null;

  for (const line of lines) {
    const header = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

/**
 * @param {string[]} lines
 * @param {{ oldStart: number, oldCount: number, lines: string[] }} hunk
 */
function applyHunk(lines, hunk) {
  const start = hunk.oldStart - 1;
  if (start < 0 || start > lines.length) {
    throw new Error(`Diff hunk start ${hunk.oldStart} is out of range`);
  }

  const result = [...lines.slice(0, start)];
  let cursor = start;

  for (const raw of hunk.lines) {
    const tag = raw[0];
    const text = raw.slice(1);
    if (tag === ' ') {
      if (lines[cursor] !== text) {
        throw new Error(`Diff context mismatch at line ${cursor + 1}`);
      }
      result.push(lines[cursor]);
      cursor += 1;
    } else if (tag === '-') {
      if (lines[cursor] !== text) {
        throw new Error(`Diff deletion mismatch at line ${cursor + 1}`);
      }
      cursor += 1;
    } else if (tag === '+') {
      result.push(text);
    }
  }

  result.push(...lines.slice(cursor));
  return result;
}
