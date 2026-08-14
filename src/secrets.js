/**
 * Secret handling: redact keys in logs/PRs, refuse plaintext API URLs,
 * and treat credential files as unhealable.
 */

const SECRET_ENV_KEYS = [
  'OPENAI_API_KEY',
  'FIXLOOP_API_KEY',
  'KIRO_HEAL_API_KEY',
  'KIRO_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'KANE_API_KEY',
];

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._\-+=/]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * Values currently loaded in the process environment that must never be logged.
 * @param {NodeJS.ProcessEnv} [envObj]
 * @returns {string[]}
 */
export function collectSecretValues(envObj = process.env) {
  const values = [];
  for (const key of SECRET_ENV_KEYS) {
    const v = envObj[key];
    if (v && String(v).length >= 8) values.push(String(v));
  }
  return values;
}

/**
 * Replace known secret patterns and live env values with a placeholder.
 * @param {unknown} input
 * @param {string[]} [extraValues]
 * @returns {string}
 */
export function redactSecrets(input, extraValues = []) {
  let text = String(input ?? '');
  const extras = [...collectSecretValues(), ...extraValues].filter((v) => v && v.length >= 8);
  extras.sort((a, b) => b.length - a.length);
  for (const value of extras) {
    text = text.split(value).join('***');
  }
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, '***');
  }
  return text;
}

/**
 * Generation APIs must be HTTPS, except a local model on loopback.
 * @param {string|null|undefined} url
 */
export function assertSafeApiUrl(url) {
  if (!url) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid generation API URL.');
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && loopback) return;
  throw new Error(
    'Generation API URL must be https (or http://localhost for a local model). Refusing to send API keys over plaintext.',
  );
}

/**
 * True when file contents look like a dotenv / private-key dump.
 * @param {string} source
 */
export function looksLikeSecretMaterial(source) {
  const text = String(source ?? '');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length === 0) return false;
  const envish = lines.filter((l) => /^[A-Z][A-Z0-9_]+=/.test(l.trim()));
  if (envish.length < 2) return false;
  return envish.some((l) =>
    /(API_KEY|SECRET|TOKEN|PRIVATE_KEY|PASSWORD|WEBHOOK_SECRET)=/i.test(l),
  );
}
