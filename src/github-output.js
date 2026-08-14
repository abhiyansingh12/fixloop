import fs from 'node:fs';

/**
 * Write step outputs when running as a GitHub Action.
 * @param {Record<string, string|boolean|number|undefined|null>} fields
 */
export function writeGithubOutput(fields) {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) return false;
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const text = value === undefined || value === null ? '' : String(value);
    if (text.includes('\n')) {
      chunks.push(`${key}<<FIXLOOP_EOF\n${text}\nFIXLOOP_EOF`);
    } else {
      chunks.push(`${key}=${text}`);
    }
  }
  if (!chunks.length) return false;
  fs.appendFileSync(dest, `${chunks.join('\n')}\n`);
  return true;
}
