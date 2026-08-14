/**
 * Minimal argv parser. Replaces clipanion.
 * @param {string[]} argv
 */
export function parseArgv(argv) {
  const flags = /** @type {Record<string, string|boolean>} */ ({});
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a === '--version' || a === '-v' || a === '-V') {
      flags.version = true;
      continue;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }
    positionals.push(a);
  }
  return { flags, positionals };
}

/** @param {Record<string, string|boolean>} flags @param {string} name */
export function flagString(flags, name) {
  const v = flags[name];
  if (v === undefined || v === true || v === false) return undefined;
  return String(v);
}

/** @param {Record<string, string|boolean>} flags @param {string} name */
export function flagOn(flags, name) {
  return flags[name] === true;
}
