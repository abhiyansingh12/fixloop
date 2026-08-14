import fs from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, scanRoutes, discoverFlows } from '../scanner.js';

const HEAL_CANDIDATES = [
  'demo/public/js/main.js',
  'public/js/main.js',
  'src/main.js',
  'src/main.tsx',
  'src/index.js',
  'src/index.tsx',
  'app/page.tsx',
  'app/page.jsx',
];

const SERVER_CANDIDATES = ['demo/server.js', 'server.js', 'index.js'];

export const FRAMEWORK_PORTS = {
  vite: 5173,
  sveltekit: 5173,
  astro: 4321,
  next: 3000,
  remix: 3000,
  nuxt: 3000,
  'react-router': 5173,
  'static-demo': 3000,
  static: 3000,
};

/**
 * @param {string} script
 * @returns {number|null}
 */
export function inferPortFromScript(script) {
  const m = String(script ?? '').match(/--port[=\s]+(\d+)|-p\s+(\d+)|PORT=(\d+)/);
  if (!m) return null;
  return Number(m[1] || m[2] || m[3]);
}

/**
 * Choose how to boot a cloned repo. Prefer package scripts (dev/start/preview)
 * over a guessed `index.js`, except for this project's demo server.
 * @param {object} opts
 * @param {string} opts.framework
 * @param {object|null} opts.pkg
 * @param {string|null} opts.serverEntry
 * @param {number} [opts.requestedPort]
 */
export function pickStartPlan(opts) {
  const { framework, pkg, serverEntry, requestedPort } = opts;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const defaultPort = requestedPort ?? FRAMEWORK_PORTS[framework] ?? 3000;
  const isDemo =
    serverEntry === 'demo/server.js' || String(serverEntry ?? '').includes('demo/server');

  if (isDemo) {
    return {
      startCommand: 'node',
      startArgs: [serverEntry],
      port: Number(process.env.PORT) || 3000,
      serverEntry,
    };
  }

  const scripts = pkg?.scripts ?? {};
  const scriptName = ['dev', 'start', 'preview', 'serve'].find((name) => scripts[name]);
  if (scriptName) {
    return {
      startCommand: npm,
      startArgs: ['run', scriptName],
      port: inferPortFromScript(scripts[scriptName]) ?? defaultPort,
      serverEntry: null,
    };
  }

  if (framework === 'next') {
    return {
      startCommand: npx,
      startArgs: ['--yes', 'next', 'dev', '-p', String(defaultPort)],
      port: defaultPort,
      serverEntry: null,
    };
  }
  if (framework === 'vite' || framework === 'sveltekit' || framework === 'react-router') {
    return {
      startCommand: npx,
      startArgs: ['--yes', 'vite', '--host', '127.0.0.1', '--port', String(defaultPort)],
      port: defaultPort,
      serverEntry: null,
    };
  }
  if (framework === 'nuxt') {
    return {
      startCommand: npx,
      startArgs: ['--yes', 'nuxt', 'dev', '--port', String(defaultPort)],
      port: defaultPort,
      serverEntry: null,
    };
  }
  if (framework === 'astro') {
    return {
      startCommand: npx,
      startArgs: ['--yes', 'astro', 'dev', '--port', String(defaultPort)],
      port: defaultPort,
      serverEntry: null,
    };
  }

  if (serverEntry) {
    return {
      startCommand: 'node',
      startArgs: [serverEntry],
      port: defaultPort,
      serverEntry,
    };
  }

  return {
    startCommand: npm,
    startArgs: ['start'],
    port: defaultPort,
    serverEntry: null,
  };
}

/**
 * @typedef {object} RepoRuntime
 * @property {string} framework
 * @property {string} startCommand
 * @property {string[]} startArgs
 * @property {string|null} serverEntry
 * @property {number} port
 * @property {string} healTarget
 * @property {{ route: string, file: string }[]} routes
 * @property {ReturnType<typeof discoverFlows>} flows
 */

/**
 * @param {string} repoRoot
 * @returns {Promise<RepoRuntime>}
 */
export async function detectRuntime(repoRoot) {
  const framework = await detectFramework(repoRoot);
  const routes = await scanRoutes(repoRoot);
  const flows = discoverFlows(routes);

  let healTarget = null;
  for (const rel of HEAL_CANDIDATES) {
    try {
      await fs.access(path.join(repoRoot, rel));
      healTarget = rel;
      break;
    } catch {
      // continue
    }
  }
  if (!healTarget && routes[0]?.file) healTarget = routes[0].file;
  if (!healTarget) healTarget = 'src/main.js';

  let serverEntry = null;
  for (const rel of SERVER_CANDIDATES) {
    try {
      await fs.access(path.join(repoRoot, rel));
      serverEntry = rel;
      break;
    } catch {
      // continue
    }
  }

  let pkg = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    // no package.json
  }

  const plan = pickStartPlan({ framework, pkg, serverEntry });

  return {
    framework,
    startCommand: plan.startCommand,
    startArgs: plan.startArgs,
    serverEntry: plan.serverEntry ?? serverEntry,
    port: plan.port,
    healTarget,
    routes,
    flows,
  };
}

/**
 * @param {RepoRuntime} runtime
 * @param {number} port
 */
export function runtimeConfigForGitHub(runtime, port) {
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    testFile: '.kiro-heal/smoke.testmd',
    healTarget: runtime.healTarget,
    demoServer: runtime.serverEntry,
    maxHeal: Number(process.env.KIRO_HEAL_MAX ?? 5),
    kaneTimeout: Number(process.env.KIRO_HEAL_TIMEOUT ?? 180),
    debounceMs: 1200,
    demoBroken: false,
  };
}
