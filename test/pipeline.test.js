import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runPipeline } from '../src/pipeline.js';
import { TEST_DEFECT_COMMENT } from '../src/triage.js';

describe('pipeline triage gates', () => {
  const prevOpen = process.env.FIXLOOP_OPEN_PR;
  const prevGh = process.env.GITHUB_ACTIONS;

  before(() => {
    process.env.FIXLOOP_OPEN_PR = '0';
    delete process.env.GITHUB_ACTIONS;
  });

  after(() => {
    if (prevOpen === undefined) delete process.env.FIXLOOP_OPEN_PR;
    else process.env.FIXLOOP_OPEN_PR = prevOpen;
    if (prevGh === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = prevGh;
  });

  it('refuses to write on test_defect and quotes the product sentence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixloop-td-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    const target = path.join(dir, 'src', 'main.js');
    await fs.writeFile(target, "document.getElementById('cta-primary');\n", 'utf8');

    const outcome = await runPipeline({
      repoRoot: dir,
      config: {
        oracle: 'fixture',
        healTarget: 'tests/home.spec.js',
        healAllowlist: ['src/**'],
        maxHeal: 2,
      },
      enableHeal: true,
      runTest: async () => ({
        outcome: 'failed',
        firstFailure: {
          message: 'strict mode violation: resolved to 2 elements',
          file: 'tests/home.spec.js',
        },
      }),
    });

    assert.equal(outcome.triage.label, 'test_defect');
    assert.equal(outcome.triage.comment, TEST_DEFECT_COMMENT);
    assert.equal(outcome.healCount, 0);
    assert.equal(outcome.verified, false);
    assert.equal(outcome.pr, undefined);
    const source = await fs.readFile(target, 'utf8');
    assert.match(source, /cta-primary/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not patch flakes', async () => {
    const outcome = await runPipeline({
      repoRoot: process.cwd(),
      config: { oracle: 'fixture', healTarget: 'src/main.js', maxHeal: 1 },
      enableHeal: true,
      runTest: async () => ({
        outcome: 'failed',
        firstFailure: { message: 'Test timeout of 30000ms exceeded' },
      }),
    });
    assert.equal(outcome.triage.label, 'flake');
    assert.equal(outcome.healCount, 0);
    assert.equal(outcome.verified, false);
  });

  it('does not open a PR when the re-run is still red', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixloop-red-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'src', 'main.js'),
      "document.getElementById('cta-primary-broken');\n",
      'utf8',
    );

    let runs = 0;
    const outcome = await runPipeline({
      repoRoot: dir,
      config: {
        oracle: 'fixture',
        healTarget: 'src/main.js',
        healAllowlist: ['src/**'],
        maxHeal: 1,
      },
      enableHeal: true,
      runTest: async () => {
        runs += 1;
        return {
          outcome: 'failed',
          firstFailure: { message: 'click handler not wired', file: 'src/main.js' },
        };
      },
    });

    assert.equal(outcome.triage.label, 'product_regression');
    assert.equal(outcome.passed, false);
    assert.equal(outcome.verified, false);
    assert.equal(outcome.pr, undefined);
    assert.ok(runs >= 1);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
