import path from 'node:path';

const SHELL_META = /[;&|`$<>\n]|\$\(/;
const ALLOWED_BIN = /^(npx|npm|pnpm|yarn|bun|node|playwright)(\.cmd)?$/i;

/**
 * Split a command string into argv without a shell.
 * Quoted tokens are kept. Shell metacharacters outside quotes are rejected.
 * @param {string} command
 * @returns {{ bin: string, args: string[] }}
 */
export function splitArgv(command) {
  const raw = String(command ?? '').trim();
  if (!raw) throw new Error('Command is empty');

  const tokens = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) tokens.push(cur);
      cur = '';
      continue;
    }
    if (SHELL_META.test(ch) || (ch === '$' && raw[i + 1] === '(')) {
      throw new Error('Command contains shell metacharacters; Fixloop will not spawn a shell');
    }
    cur += ch;
  }
  if (quote) throw new Error('Command has an unclosed quote');
  if (cur) tokens.push(cur);
  if (!tokens.length) throw new Error('Command is empty');
  return { bin: tokens[0], args: tokens.slice(1) };
}

/**
 * @param {string} bin
 */
export function assertSafeSpawnBin(bin) {
  const base = path.basename(String(bin ?? ''));
  if (!ALLOWED_BIN.test(base)) {
    throw new Error(
      `Refusing to spawn "${base}". Allowed: npx, npm, pnpm, yarn, bun, node, playwright.`,
    );
  }
  return base;
}
