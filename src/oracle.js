import { runPlaywright, playwrightInstalled } from './playwright-oracle.js';
import { runKaneTest, logKaneEvent } from './runner.js';
import { simulateKaneRun } from './simulator.js';
import { env, envOn } from './flags.js';

/**
 * Pick playwright | kane | fixture and run it.
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {import('./config.js').FixloopConfig} opts.config
 */
export async function runOracle(opts) {
  const { cwd, config } = opts;
  const requested = (config.oracle ?? env('ORACLE', 'playwright')).toLowerCase();

  if (requested === 'kane') {
    return runKaneTest({
      testFile: opts.testFile,
      cwd,
      timeoutSeconds: config.kaneTimeout,
      onEvent: logKaneEvent,
      targetRel: config.healTarget,
      fixturePath: config.fixtureFile,
    });
  }

  if (requested === 'fixture' || envOn('SIMULATE') || envOn('SIMULATE_KANE')) {
    return simulateKaneRun({
      cwd,
      onEvent: logKaneEvent,
      targetRel: config.healTarget,
      fixturePath: config.fixtureFile,
    });
  }

  if (requested === 'playwright') {
    if (!playwrightInstalled(cwd)) {
      console.log(
        '[fixloop] Playwright not installed — using fixture oracle. Add @playwright/test for the real default.',
      );
      return simulateKaneRun({
        cwd,
        onEvent: logKaneEvent,
        targetRel: config.healTarget,
        fixturePath: config.fixtureFile,
      });
    }
    return runPlaywright({
      cwd,
      command: config.playwrightCommand,
      reportPath: config.playwrightReport,
    });
  }

  throw new Error(`Unknown oracle "${requested}". Use playwright, kane, or fixture.`);
}
