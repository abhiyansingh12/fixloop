import fs from 'node:fs/promises';
import path from 'node:path';
import { env, envOn } from './flags.js';

const CONFIG_NAMES = ['.fixloop.json', 'fixloop.json', '.kiro-heal.json', 'kiro-heal.json'];

/**
 * @typedef {object} FixloopConfig
 * @property {string} baseUrl
 * @property {string} testFile
 * @property {string} healTarget
 * @property {string} [demoServer]
 * @property {number} maxHeal
 * @property {number} [kaneTimeout]
 * @property {number} [debounceMs]
 * @property {boolean} [demoBroken]
 * @property {string[]} [healAllowlist]
 * @property {string} [fixtureFile]
 * @property {'playwright'|'kane'|'fixture'} [oracle]
 * @property {string} [playwrightCommand]
 * @property {string} [playwrightReport]
 */

/** @type {FixloopConfig} */
export const DEFAULT_CONFIG = {
  oracle: 'playwright',
  playwrightCommand: 'npx playwright test',
  playwrightReport: 'test-results/fixloop.json',
  baseUrl: 'http://localhost:5173',
  testFile: '.fixloop/smoke.testmd',
  healTarget: 'src/main.js',
  demoServer: null,
  maxHeal: 3,
  kaneTimeout: 180,
  debounceMs: 1200,
  healAllowlist: [
    'src/**',
    'app/**',
    'pages/**',
    'public/**',
    'demo/**',
    'examples/**',
    'components/**',
    'lib/**',
    'routes/**',
  ],
  fixtureFile: '.fixloop/fixture.json',
  demoBroken: false,
};

/**
 * @param {string} repoRoot
 * @returns {Promise<FixloopConfig>}
 */
export async function loadConfig(repoRoot) {
  let fileConfig = {};
  for (const name of CONFIG_NAMES) {
    const configPath = path.join(repoRoot, name);
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      fileConfig = JSON.parse(raw);
      break;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  const demoBrokenEnv = env('DEMO_BROKEN');

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    oracle: env('ORACLE', fileConfig.oracle ?? DEFAULT_CONFIG.oracle),
    playwrightCommand: env(
      'PLAYWRIGHT_COMMAND',
      fileConfig.playwrightCommand ?? DEFAULT_CONFIG.playwrightCommand,
    ),
    playwrightReport: env(
      'PLAYWRIGHT_REPORT',
      fileConfig.playwrightReport ?? DEFAULT_CONFIG.playwrightReport,
    ),
    baseUrl: env('BASE_URL', fileConfig.baseUrl ?? DEFAULT_CONFIG.baseUrl),
    testFile: env('TEST', fileConfig.testFile ?? DEFAULT_CONFIG.testFile),
    healTarget: env('TARGET', fileConfig.healTarget ?? DEFAULT_CONFIG.healTarget),
    maxHeal: Number(env('MAX', fileConfig.maxHeal ?? DEFAULT_CONFIG.maxHeal)),
    kaneTimeout: Number(env('TIMEOUT', fileConfig.kaneTimeout ?? DEFAULT_CONFIG.kaneTimeout)),
    debounceMs: Number(env('DEBOUNCE', fileConfig.debounceMs ?? DEFAULT_CONFIG.debounceMs)),
    healAllowlist: Array.isArray(fileConfig.healAllowlist)
      ? fileConfig.healAllowlist
      : DEFAULT_CONFIG.healAllowlist,
    fixtureFile: env('FIXTURE', fileConfig.fixtureFile ?? DEFAULT_CONFIG.fixtureFile),
    demoBroken:
      demoBrokenEnv === '1'
        ? true
        : demoBrokenEnv === '0'
          ? false
          : Boolean(fileConfig.demoBroken ?? DEFAULT_CONFIG.demoBroken),
    demoServer:
      fileConfig.demoServer !== undefined ? fileConfig.demoServer : DEFAULT_CONFIG.demoServer,
  };
}

/**
 * @param {string} repoRoot
 * @param {FixloopConfig} config
 */
export function resolvePaths(repoRoot, config) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return {
    repoRoot,
    testFile: path.isAbsolute(cfg.testFile)
      ? cfg.testFile
      : path.join(repoRoot, cfg.testFile),
    healTarget: path.isAbsolute(cfg.healTarget)
      ? cfg.healTarget
      : path.join(repoRoot, cfg.healTarget),
    demoServer: cfg.demoServer
      ? path.isAbsolute(cfg.demoServer)
        ? cfg.demoServer
        : path.join(repoRoot, cfg.demoServer)
      : null,
    playwrightReport: path.isAbsolute(cfg.playwrightReport)
      ? cfg.playwrightReport
      : path.join(repoRoot, cfg.playwrightReport),
  };
}

/**
 * Write `.fixloop.json` at the repo root.
 * @param {string} repoRoot
 * @param {Partial<FixloopConfig>} config
 */
export async function saveConfig(repoRoot, config) {
  const dest = path.join(repoRoot, '.fixloop.json');
  await fs.writeFile(dest, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return dest;
}

export { envOn };
