import fs from 'node:fs/promises';
import path from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'output-',
  '.testmuai',
  '.fixloop',
  '.kiro-heal',
]);

const MAX_SCAN_FILES = 4000;
const MAX_ROUTER_ROUTES = 40;

/**
 * @param {string} dir
 * @param {(name: string) => boolean} [fileFilter]
 * @param {string[]} [files]
 */
export async function walkFiles(dir, fileFilter = () => true, files = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const ent of entries) {
    if (IGNORE_DIRS.has(ent.name) || ent.name.startsWith('output-')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(full, fileFilter, files);
      if (files.length >= MAX_SCAN_FILES) return files;
    } else if (fileFilter(ent.name)) {
      files.push(full);
      if (files.length >= MAX_SCAN_FILES) return files;
    }
  }
  return files;
}

/**
 * Strip Next/SvelteKit route groups and map dynamic segments.
 * @param {string} segment
 */
export function normalizeRouteSegment(segment) {
  const parts = segment.split('/').filter(Boolean);
  const mapped = [];
  for (const part of parts) {
    if (part.startsWith('(') && part.endsWith(')')) continue;
    if (part.startsWith('@')) continue;
    if (part === '+page.svelte' || part === '+page.tsx' || part === '+page.ts') continue;
    if (part.startsWith('[...') && part.endsWith(']')) {
      mapped.push('*');
      continue;
    }
    if (part.startsWith('[') && part.endsWith(']')) {
      mapped.push(`:${part.slice(1, -1)}`);
      continue;
    }
    mapped.push(part);
  }
  return mapped.join('/');
}

/**
 * Remix `app/routes` filename → URL path.
 * @param {string} filename  e.g. `_index.tsx`, `posts.$id.tsx`, `login.tsx`
 */
export function remixFilenameToRoute(filename) {
  const stem = filename.replace(/\.(tsx|ts|jsx|js)$/, '');
  if (stem.startsWith('_') && !stem.startsWith('_index') && !stem.includes('.')) {
    return null;
  }
  const parts = stem.split('.');
  const mapped = [];
  for (const part of parts) {
    if (part === '_index' || part === 'index' || part === '_layout') continue;
    if (part.startsWith('_')) continue;
    if (part.startsWith('$')) mapped.push(`:${part.slice(1)}`);
    else mapped.push(part);
  }
  return mapped.length ? `/${mapped.join('/')}` : '/';
}

/**
 * Map a source file to a public route, or null.
 * @param {string} repoRoot
 * @param {string} filePath
 */
export function fileToRoute(repoRoot, filePath) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/');

  const nextApp = rel.match(/^(?:src\/)?app\/(?:(.*)\/)?page\.(tsx|jsx|js)$/);
  if (nextApp) {
    const segment = normalizeRouteSegment(nextApp[1] ?? '');
    return segment ? `/${segment}` : '/';
  }

  const nextPages = rel.match(/^(?:src\/)?pages\/(.+)\.(tsx|jsx|js)$/);
  if (nextPages) {
    let segment = nextPages[1];
    if (segment === '_app' || segment === '_document' || segment.startsWith('api/')) return null;
    if (segment === 'index') return '/';
    if (segment.endsWith('/index')) segment = segment.slice(0, -6);
    segment = normalizeRouteSegment(segment);
    return segment ? `/${segment}` : '/';
  }

  const vitePages = rel.match(/^src\/pages\/(.+)\.(tsx|jsx)$/);
  if (vitePages) {
    let segment = vitePages[1];
    if (segment === 'index') return '/';
    if (segment.endsWith('/index')) segment = segment.slice(0, -6);
    return `/${normalizeRouteSegment(segment)}`;
  }

  const svelte = rel.match(/^src\/routes\/(?:(.+)\/)?\+page\.(svelte|tsx|ts|js)$/);
  if (svelte) {
    const segment = normalizeRouteSegment(svelte[1] ?? '');
    return segment ? `/${segment}` : '/';
  }

  const remix = rel.match(/^app\/routes\/([^/]+)\.(tsx|ts|jsx|js)$/);
  if (remix) {
    return remixFilenameToRoute(remix[1] + '.' + remix[2]);
  }

  const nuxt = rel.match(/^(?:src\/)?pages\/(.+)\.(vue|tsx|jsx|js|ts)$/);
  if (nuxt) {
    let segment = nuxt[1];
    if (segment === 'index') return '/';
    if (segment.endsWith('/index')) segment = segment.slice(0, -6);
    return `/${normalizeRouteSegment(segment)}`;
  }

  return null;
}

/**
 * Pull React Router `path` values out of source text.
 * @param {string} source
 */
export function extractRouterPaths(source) {
  const paths = [];
  const seen = new Set();
  const patterns = [
    /<Route\b[^>]*\spath=["']([^"']+)["']/g,
    /path:\s*['"](\/[^'"]*)['"]/g,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) {
      const route = match[1];
      if (!route || seen.has(route) || route === '*') continue;
      seen.add(route);
      paths.push(route);
      if (paths.length >= MAX_ROUTER_ROUTES) return paths;
    }
  }
  return paths;
}

/**
 * Recursively collect HTML pages under a public-style directory.
 * @param {string} dir
 * @param {string} repoRoot
 */
export async function scanHtmlTree(dir, repoRoot) {
  const routes = [];
  const files = await walkFiles(dir, (name) => name.endsWith('.html'));
  for (const file of files) {
    const relToDir = path.relative(dir, file).replace(/\\/g, '/');
    let route;
    if (relToDir === 'index.html') route = '/';
    else if (relToDir.endsWith('/index.html')) route = `/${relToDir.slice(0, -'/index.html'.length)}`;
    else route = `/${relToDir.replace(/\.html$/, '')}`;
    routes.push({
      route,
      file: path.relative(repoRoot, file),
      kind: 'static',
    });
  }
  return routes;
}
