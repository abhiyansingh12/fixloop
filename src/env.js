import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Load KEY=VALUE pairs from a .env file without overriding existing process.env.
 * @param {string} [filePath]
 */
export async function loadEnvFile(filePath) {
  const envPath = filePath ?? path.join(process.cwd(), '.env');
  let content;
  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
