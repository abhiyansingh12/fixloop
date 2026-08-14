import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_NAMES = ['.kiro-heal.json', 'kiro-heal.json'];

/**
 * @typedef {object} KiroHealConfig
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
 */

/** @type {KiroHealConfig} */
export const DEFAULT_CONFIG = {
  baseUrl: 'http://localhost:3000',
  testFile: '.kiro-heal/smoke.testmd',
  healTarget: 'demo/public/js/main.js',
  demoServer: 'demo/server.js',
  maxHeal: 5,
  kaneTimeout: 180,
  debounceMs: 1200,
  healAllowlist: [
    'src/**',
    'app/**',
    'pages/**',
    'public/**',
    'demo/**',
    'components/**',
    'lib/**',
    'routes/**',
  ],
  fixtureFile: '.kiro-heal/fixture.json',
  demoBroken: false,
};

/**
 * @param {string} repoRoot
 * @returns {Promise<KiroHealConfig>}
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

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    baseUrl: process.env.KIRO_HEAL_BASE_URL ?? fileConfig.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    testFile: process.env.KIRO_HEAL_TEST ?? fileConfig.testFile ?? DEFAULT_CONFIG.testFile,
    healTarget:
      process.env.KIRO_HEAL_TARGET ?? fileConfig.healTarget ?? DEFAULT_CONFIG.healTarget,
    maxHeal: Number(process.env.KIRO_HEAL_MAX ?? fileConfig.maxHeal ?? DEFAULT_CONFIG.maxHeal),
    kaneTimeout: Number(
      process.env.KIRO_HEAL_TIMEOUT ?? fileConfig.kaneTimeout ?? DEFAULT_CONFIG.kaneTimeout,
    ),
    debounceMs: Number(
      process.env.KIRO_HEAL_DEBOUNCE ?? fileConfig.debounceMs ?? DEFAULT_CONFIG.debounceMs,
    ),
    healAllowlist: Array.isArray(fileConfig.healAllowlist)
      ? fileConfig.healAllowlist
      : DEFAULT_CONFIG.healAllowlist,
    fixtureFile: process.env.KIRO_HEAL_FIXTURE ?? fileConfig.fixtureFile ?? DEFAULT_CONFIG.fixtureFile,
    demoBroken:
      process.env.KIRO_HEAL_DEMO_BROKEN === '1'
        ? true
        : process.env.KIRO_HEAL_DEMO_BROKEN === '0'
          ? false
          : Boolean(fileConfig.demoBroken ?? DEFAULT_CONFIG.demoBroken),
  };
}

/**
 * @param {string} repoRoot
 * @param {KiroHealConfig} config
 */
export function resolvePaths(repoRoot, config) {
  return {
    repoRoot,
    testFile: path.isAbsolute(config.testFile)
      ? config.testFile
      : path.join(repoRoot, config.testFile),
    healTarget: path.isAbsolute(config.healTarget)
      ? config.healTarget
      : path.join(repoRoot, config.healTarget),
    demoServer: config.demoServer
      ? path.isAbsolute(config.demoServer)
        ? config.demoServer
        : path.join(repoRoot, config.demoServer)
      : null,
  };
}
