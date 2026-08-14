import fs from 'node:fs/promises';
import path from 'node:path';

/** Built-in fixture used when a repo has not recorded its own. */
export const DEFAULT_FIXTURE = {
  target: 'demo/public/js/main.js',
  failIfAny: ['cta-primary-broken', 'HEAL_BROKEN'],
  passIfAny: ["getElementById('cta-primary')", 'getElementById("cta-primary")'],
  steps: [
    { remark: 'Opened application', pass: true },
    { remark: 'Primary navigation visible', pass: true },
    {
      remark: 'Primary CTA interaction',
      failRemark: 'Get started button did not update status — click handler not wired',
    },
  ],
};

/**
 * @typedef {object} SimulatorFixture
 * @property {string} [target]
 * @property {string[]} [failIfAny]
 * @property {string[]} [passIfAny]
 * @property {string[]} [passIfAll]
 * @property {{ remark: string, pass?: boolean, failRemark?: string }[]} [steps]
 */

/**
 * Decide whether the heal-target source should fail the simulated run.
 * @param {string} source
 * @param {SimulatorFixture} fixture
 */
export function evaluateFixture(source, fixture) {
  const failIfAny = fixture.failIfAny ?? [];
  const passIfAny = fixture.passIfAny ?? [];
  const passIfAll = fixture.passIfAll ?? [];

  for (const needle of failIfAny) {
    if (needle && source.includes(needle)) {
      return { broken: true, reason: `source contains fail marker: ${needle}` };
    }
  }
  for (const needle of passIfAll) {
    if (needle && !source.includes(needle)) {
      return { broken: true, reason: `source missing required text: ${needle}` };
    }
  }
  if (passIfAny.length > 0 && !passIfAny.some((needle) => needle && source.includes(needle))) {
    return { broken: true, reason: 'source missing all passIfAny markers' };
  }
  return { broken: false, reason: 'fixture checks passed' };
}

/**
 * Load `.kiro-heal/fixture.json` or an explicit path. Missing file → default fixture.
 * @param {string} cwd
 * @param {string} [explicitPath]
 */
export async function loadFixture(cwd, explicitPath) {
  const candidates = [
    explicitPath,
    process.env.KIRO_HEAL_FIXTURE,
    path.join(cwd, '.kiro-heal', 'fixture.json'),
  ].filter(Boolean);

  for (const rel of candidates) {
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    try {
      const raw = await fs.readFile(abs, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_FIXTURE, ...parsed, path: abs };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  return { ...DEFAULT_FIXTURE, path: null };
}
