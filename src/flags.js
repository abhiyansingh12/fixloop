/**
 * Read FIXLOOP_* first, then legacy KIRO_HEAL_* for one release.
 * @param {string} key  suffix, e.g. "OPEN_PR"
 * @param {string} [fallback]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function env(key, fallback, envObj = process.env) {
  const a = envObj[`FIXLOOP_${key}`];
  if (a !== undefined && a !== '') return a;
  const b = envObj[`KIRO_HEAL_${key}`];
  if (b !== undefined && b !== '') return b;
  return fallback;
}

export function envOn(key, envObj = process.env) {
  return env(key, undefined, envObj) === '1';
}
