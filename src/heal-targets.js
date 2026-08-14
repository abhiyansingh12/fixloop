import path from 'node:path';
import { assertHealPathAllowed, DEFAULT_HEAL_ALLOWLIST } from './allowlist.js';

const MAX_TARGETS = 3;
const FRAME_RE =
  /(?:^|[\s(])((?:[.]{1,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:js|jsx|ts|tsx|mjs|cjs|vue|svelte|html)):\d+/g;

function isTestPath(filePath) {
  const p = String(filePath ?? '').replace(/\\/g, '/');
  return (
    /\.(spec|test)\.(t|j)sx?$/.test(p) ||
    /(^|\/)(tests|e2e|playwright|__tests__)(\/|$)/.test(p)
  );
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractPathsFromTrace(text) {
  const found = [];
  const src = String(text ?? '');
  FRAME_RE.lastIndex = 0;
  let m;
  while ((m = FRAME_RE.exec(src))) {
    const rel = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
    if (rel.startsWith('http:') || rel.startsWith('https:')) continue;
    if (!found.includes(rel)) found.push(rel);
  }
  return found;
}

/**
 * Ordered heal candidates: CLI override, config, then application files from the failure stack.
 * Test files are never candidates.
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} opts.config
 * @param {object} [opts.oracleResult]
 * @param {string} [opts.override]
 * @returns {string[]}
 */
export function resolveHealTargets(opts) {
  const { repoRoot, config, oracleResult, override } = opts;
  const allowlist = config?.healAllowlist ?? DEFAULT_HEAL_ALLOWLIST;
  const configured = [];
  if (override) configured.push(override);
  const ht = config?.healTarget;
  if (Array.isArray(ht)) configured.push(...ht);
  else if (ht) configured.push(ht);

  const failure = oracleResult?.firstFailure ?? {};
  const fromTrace = extractPathsFromTrace(
    [failure.file, failure.stack, failure.message, oracleResult?.rawSummary].filter(Boolean).join('\n'),
  );

  const ordered = [...configured, ...fromTrace];
  const out = [];
  for (const candidate of ordered) {
    if (!candidate || isTestPath(candidate)) continue;
    try {
      const { rel } = assertHealPathAllowed(repoRoot, candidate, allowlist, undefined, config?.healTarget);
      if (!out.includes(rel)) out.push(rel);
    } catch {
      // skip paths that fail allow/deny
    }
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}
