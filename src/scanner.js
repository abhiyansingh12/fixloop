import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChatCompletionsUrl } from './policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

const ROUTE_PATTERNS = [
  { framework: 'next-app', glob: /app\/(.+)\/page\.(tsx|jsx|js)$/ },
  { framework: 'next-pages', glob: /pages\/(.+)\.(tsx|jsx|js)$/ },
  { framework: 'vite-react', glob: /src\/pages\/(.+)\.(tsx|jsx)$/ },
];

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'output-',
  '.testmuai',
]);

const MAX_SCAN_FILES = 4000;

/**
 * Walk directory tree (shallow-safe for hackathon repos).
 * @param {string} dir
 * @param {string[]} [files]
 */
async function walk(dir, files = []) {
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
      await walk(full, files);
    } else if (/\.(tsx|jsx|js|ts)$/.test(ent.name)) {
      files.push(full);
      if (files.length >= MAX_SCAN_FILES) return files;
    }
  }
  return files;
}

/**
 * Map file path to a public URL route.
 * @param {string} repoRoot
 * @param {string} filePath
 */
export function fileToRoute(repoRoot, filePath) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/');

  for (const { glob } of ROUTE_PATTERNS) {
    const m = rel.match(glob);
    if (!m) continue;
    let segment = m[1];
    if (segment === 'index') return '/';
    if (segment.endsWith('/index')) segment = segment.slice(0, -6);
    return `/${segment}`;
  }

  return null;
}

/**
 * Static HTML pages under demo/public (or any public/).
 * @param {string} repoRoot
 */
export async function scanStaticPages(repoRoot) {
  const routes = [];
  const candidates = [
    path.join(repoRoot, 'demo/public'),
    path.join(repoRoot, 'public'),
  ];

  for (const dir of candidates) {
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.html')) continue;
      const route = name === 'index.html' ? '/' : `/${name.replace(/\.html$/, '')}`;
      routes.push({
        route,
        file: path.relative(repoRoot, path.join(dir, name)),
        kind: 'static',
      });
    }
  }

  return routes;
}

/**
 * Discover route-bearing files in a repository.
 * @param {string} repoRoot
 */
export async function scanRoutes(repoRoot) {
  const files = await walk(repoRoot);
  const routes = [];
  const seen = new Set();

  for (const file of files) {
    const route = fileToRoute(repoRoot, file);
    if (route && !seen.has(route)) {
      seen.add(route);
      routes.push({ route, file: path.relative(repoRoot, file), kind: 'framework' });
    }
  }

  for (const r of await scanStaticPages(repoRoot)) {
    if (!seen.has(r.route)) {
      seen.add(r.route);
      routes.push(r);
    }
  }

  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Lightweight LLM scaffold for testmd — uses same API as healer when configured.
 * @param {string} prompt
 */
async function llmComplete(prompt) {
  const apiUrl = resolveChatCompletionsUrl();

  if (!apiUrl) return null;

  const apiKey = process.env.KIRO_HEAL_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  const model = process.env.KIRO_HEAL_MODEL ?? 'gpt-4o-mini';

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You write Kane CLI testmd markdown files. Output only markdown with YAML frontmatter and ## step sections.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

/** @typedef {'login'|'signup'|'dashboard'|'checkout'|'settings'|'search'|'crud'|'navigation'|'generic'} FlowKind */

const FLOW_RULES = [
  { kind: 'login', pattern: /\/(login|signin|sign-in)(\/|$)/i },
  { kind: 'signup', pattern: /\/(signup|sign-up|register)(\/|$)/i },
  { kind: 'dashboard', pattern: /\/(dashboard|home|app)(\/|$)/i },
  { kind: 'checkout', pattern: /\/(checkout|cart|payment)(\/|$)/i },
  { kind: 'settings', pattern: /\/(settings|profile|account)(\/|$)/i },
  { kind: 'search', pattern: /\/(search|find)(\/|$)/i },
  { kind: 'crud', pattern: /\/(admin|manage|edit|new|create)(\/|$)/i },
];

/**
 * Tag routes with semantic user-flow kinds for GitHub / Kane scaffolding.
 * @param {{ route: string, file: string, kind?: string }[]} routes
 */
export function discoverFlows(routes) {
  const flows = [];
  for (const route of routes) {
    let flowKind = 'generic';
    for (const { kind, pattern } of FLOW_RULES) {
      if (pattern.test(route.route)) {
        flowKind = kind;
        break;
      }
    }
    if (route.route === '/') flowKind = 'navigation';
    flows.push({ ...route, flowKind });
  }
  return flows;
}

/**
 * @param {FlowKind} flowKind
 */
function flowStepCopy(flowKind, url) {
  switch (flowKind) {
    case 'login':
      return [`Open ${url}.`, 'Verify a login form with email/username and password fields is visible.'];
    case 'signup':
      return [`Open ${url}.`, 'Verify a registration form is visible and can be submitted.'];
    case 'dashboard':
      return [`Open ${url}.`, 'Verify authenticated dashboard content loads without errors.'];
    case 'checkout':
      return [`Open ${url}.`, 'Verify checkout or cart UI is visible.'];
    case 'settings':
      return [`Open ${url}.`, 'Verify settings or profile controls are visible.'];
    case 'search':
      return [`Open ${url}.`, 'Verify a search input is visible and accepts text.'];
    case 'crud':
      return [`Open ${url}.`, 'Verify list or form UI for managing records is visible.'];
    case 'navigation':
      return [`Open ${url}.`, 'Verify primary navigation and main content are visible.'];
    default:
      return [
        `Open ${url}.`,
        'Verify the page renders visible content and has no blocking error overlay.',
      ];
  }
}

/**
 * Build semantic test objectives from discovered routes (template fallback).
 * @param {{ route: string, file: string }[]} routes
 * @param {string} baseUrl
 */
export function buildTestmdFromRoutes(routes, baseUrl = 'http://localhost:3000') {
  const lines = [
    '---',
    'mode: testing',
    '---',
    '',
    '# kiro-heal auto-scaffolded smoke flow',
    '',
  ];

  if (routes.length === 0) {
    lines.push('## Open application');
    lines.push(`Open ${baseUrl} and verify the page loads without errors.`);
    lines.push('');
    lines.push('## Check primary navigation');
    lines.push('Verify that primary navigation links are visible.');
    lines.push('');
    lines.push('## Interact with primary CTA');
    lines.push('Click the "Get started" button and verify the status message updates.');
    return lines.join('\n');
  }

  const flows = discoverFlows(routes);
  for (const { route, flowKind } of flows.slice(0, 8)) {
    const url = `${baseUrl.replace(/\/$/, '')}${route}`;
    const title =
      flowKind !== 'generic'
        ? `${flowKind} — ${route === '/' ? 'Home' : route}`
        : route === '/'
          ? 'Home'
          : route.slice(1).replace(/\//g, ' / ');
    const [openLine, verifyLine] = flowStepCopy(flowKind, url);
    lines.push(`## ${title}`);
    lines.push(openLine);
    lines.push(verifyLine);
    lines.push('');
  }

  lines.push('## Interact with primary CTA');
  lines.push('On the home page, click the "Get started" button.');
  lines.push(
    'Verify the status banner text changes to confirm the click handler fired successfully.',
  );

  return lines.join('\n');
}

/**
 * Load base template and merge route scan.
 */
export async function loadBaseTemplate() {
  const templatePath = path.join(TEMPLATE_DIR, 'base-flow.testmd');
  try {
    return await fs.readFile(templatePath, 'utf8');
  } catch {
    return buildTestmdFromRoutes([]);
  }
}

/**
 * Scan repo and write a Kane testmd file.
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.outputPath
 * @param {string} [options.baseUrl]
 * @param {boolean} [options.useLlm]
 */
/**
 * Detect likely web framework from repository layout.
 * @param {string} repoRoot
 */
export async function detectFramework(repoRoot) {
  const checks = [
    { name: 'next', path: 'next.config.js' },
    { name: 'next', path: 'next.config.mjs' },
    { name: 'vite', path: 'vite.config.ts' },
    { name: 'vite', path: 'vite.config.js' },
    { name: 'remix', path: 'remix.config.js' },
    { name: 'nuxt', path: 'nuxt.config.ts' },
    { name: 'sveltekit', path: 'svelte.config.js' },
  ];
  for (const { name, path: rel } of checks) {
    try {
      await fs.access(path.join(repoRoot, rel));
      return name;
    } catch {
      // continue
    }
  }
  try {
    await fs.access(path.join(repoRoot, 'demo/server.js'));
    return 'static-demo';
  } catch {
    // continue
  }
  try {
    await fs.access(path.join(repoRoot, 'public/index.html'));
    return 'static';
  } catch {
    return 'unknown';
  }
}

export async function scaffoldTest(options) {
  const { repoRoot, outputPath, baseUrl = 'http://localhost:3000', useLlm = false } = options;
  const routes = await scanRoutes(repoRoot);

  let content = buildTestmdFromRoutes(routes, baseUrl);

  if (useLlm && routes.length > 0) {
    const prompt = `Generate a Kane CLI testmd file for these routes at base URL ${baseUrl}:\n${routes.map((r) => `- ${r.route} (${r.file})`).join('\n')}\nUse ## headings per step.`;
    const llmMd = await llmComplete(prompt);
    if (llmMd) content = llmMd;
  }

  const outAbs = path.isAbsolute(outputPath) ? outputPath : path.join(repoRoot, outputPath);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.writeFile(outAbs, content, 'utf8');

  const flows = discoverFlows(routes);
  const framework = await detectFramework(repoRoot);

  return { outputPath: outAbs, routes, flows, framework, content };
}
