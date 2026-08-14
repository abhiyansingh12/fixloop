import path from 'node:path';

export const DEFAULT_HEAL_ALLOWLIST = [
  'src/**',
  'app/**',
  'pages/**',
  'public/**',
  'demo/**',
  'examples/**',
  'components/**',
  'lib/**',
  'routes/**',
];

export const DEFAULT_HEAL_DENYLIST = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '**/.env',
  '**/.env.*',
  '**/.envrc',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa',
  '**/id_dsa',
  '**/id_ed25519',
  '**/.ssh/**',
  '**/.aws/**',
  '**/.npmrc',
  '**/.netrc',
  '**/.pypirc',
  '**/credentials.json',
  '**/service-account*.json',
  '**/github-app.pem',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/.fixloop/**',
  '**/.kiro-heal/**',
];

const HEAL_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.html',
  '.css',
  '.vue',
  '.svelte',
  '.md',
]);

/**
 * Minimal glob matcher (`*` and `**` only).
 * @param {string} relPath
 * @param {string} pattern
 */
export function matchGlob(relPath, pattern) {
  const normalized = relPath.replace(/\\/g, '/');
  let source = String(pattern).replace(/\\/g, '/');
  source = source.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  source = source.replace(/\*\*/g, '{{GS}}').replace(/\*/g, '[^/]*');
  source = source
    .replace(/{{GS}}\//g, '(?:.*/)?')
    .replace(/\/{{GS}}/g, '(?:/.*)?')
    .replace(/{{GS}}/g, '.*');
  return new RegExp(`^${source}$`).test(normalized);
}

/**
 * @param {string} relPath
 * @param {string[]} patterns
 */
export function matchesAny(relPath, patterns) {
  return (patterns ?? []).some((pattern) => matchGlob(relPath, pattern));
}

/**
 * Resolve a heal target and reject path traversal / denylisted files.
 * @param {string} repoRoot
 * @param {string} filePath
 * @param {string[]} [allowlist]
 * @param {string[]} [denylist]
 * @param {string} [healTarget]
 */
export function assertHealPathAllowed(
  repoRoot,
  filePath,
  allowlist = DEFAULT_HEAL_ALLOWLIST,
  denylist = DEFAULT_HEAL_DENYLIST,
  healTarget,
) {
  const root = path.resolve(repoRoot);
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Heal path escapes repository: ${filePath}`);
  }

  const rel = path.relative(root, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) {
    throw new Error(`Heal path escapes repository: ${filePath}`);
  }

  if (matchesAny(rel, denylist)) {
    throw new Error(`Heal path is denylisted: ${rel}`);
  }

  const ext = path.extname(rel).toLowerCase();
  if (ext && !HEAL_EXTENSIONS.has(ext)) {
    throw new Error(`Heal path has a disallowed extension: ${rel}`);
  }

  const extra = [];
  if (healTarget) extra.push(healTarget.replace(/\\/g, '/'));
  const allowed = [...allowlist, ...extra];
  if (allowed.length > 0 && !matchesAny(rel, allowed) && !allowed.includes(rel)) {
    throw new Error(
      `Heal path is outside the allowlist: ${rel}. Add it to healAllowlist in .fixloop.json.`,
    );
  }

  return { abs, rel };
}
