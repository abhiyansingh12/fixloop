import fs from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, scanRoutes, discoverFlows } from '../scanner.js';

const HEAL_CANDIDATES = [
  'demo/public/js/main.js',
  'public/js/main.js',
  'src/main.js',
  'src/index.js',
  'app/page.tsx',
  'app/page.jsx',
];

const SERVER_CANDIDATES = ['demo/server.js', 'server.js', 'index.js'];

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
  if (!healTarget) healTarget = 'demo/public/js/main.js';

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

  let startCommand = 'node';
  let startArgs = serverEntry ? [serverEntry] : [];
  let port = 3000;

  let pkg = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    // no package.json
  }

  if (pkg?.scripts) {
    if (!serverEntry && pkg.scripts.dev) {
      startCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      startArgs = ['run', 'dev'];
      port = Number(process.env.PORT) || 3000;
    } else if (!serverEntry && pkg.scripts.start) {
      startCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      startArgs = ['run', 'start'];
    }
  }

  if (serverEntry?.includes('demo/server')) {
    port = 3000;
  }

  return {
    framework,
    startCommand,
    startArgs,
    serverEntry,
    port,
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
