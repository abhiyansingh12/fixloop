import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SKIP = new Set([
  'node_modules',
  '.git',
  'test-results',
  'playwright-report',
  'dist',
  'build',
  '.fixloop',
  '.kiro-heal',
]);

/**
 * @param {string} filePath
 * @param {Set<string>} skipDirs
 */
export function shouldSkipWatchPath(filePath, skipDirs = DEFAULT_SKIP) {
  const parts = filePath.replaceAll('\\', '/').split('/');
  if (parts.some((p) => skipDirs.has(p))) return true;
  const base = path.basename(filePath);
  if (base === 'package-lock.json') return true;
  return false;
}

/**
 * Recursive fs.watch. Replaces chokidar.
 * @param {string} root
 * @param {(absPath: string) => void} onChange
 * @param {object} [opts]
 * @param {Set<string>} [opts.skipDirs]
 * @returns {fs.FSWatcher}
 */
export function watchTree(root, onChange, opts = {}) {
  const skipDirs = opts.skipDirs ?? DEFAULT_SKIP;
  return fs.watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const abs = path.join(root, filename.toString());
    if (shouldSkipWatchPath(abs, skipDirs)) return;
    onChange(abs);
  });
}
