import fs from 'node:fs/promises';
import path from 'node:path';
import { initProject, runPipeline } from '../pipeline.js';
import { loadGitHubConfig } from './config.js';
import { createApp, createOctokit, getDefaultBranch, getInstallationToken } from './client.js';
import { cloneRepository, installDependencies } from './clone.js';
import { detectRuntime, runtimeConfigForGitHub } from './detect.js';
import { buildAnalysisJson, buildVerificationReport } from './report.js';
import { createVerificationPullRequest, postComment } from './pr.js';
import { startRepoServer } from './runtime.js';
import { isValidGitHubRepoName } from '../policy.js';

/**
 * @typedef {object} VerifyOptions
 * @property {string} owner
 * @property {string} repo
 * @property {number} [installationId]
 * @property {string} [ref]
 * @property {boolean} [openPr]
 * @property {number} [issueNumber]
 * @property {(msg: string) => void} [log]
 */

/**
 * Run full GitHub auto-verification on a repository.
 * @param {VerifyOptions} options
 */
export async function verifyGitHubRepository(options) {
  const log = options.log ?? console.log;
  const ghConfig = await loadGitHubConfig();
  const octokit = await createOctokit({
    installationId: options.installationId,
    config: ghConfig,
  });

  const owner = options.owner;
  const repo = options.repo;
  if (!isValidGitHubRepoName(owner, repo)) {
    throw new Error(`Invalid GitHub repository "${owner}/${repo}"`);
  }
  const baseBranch = options.ref ?? (await getDefaultBranch(octokit, owner, repo));

  let token = ghConfig.token;
  if (options.installationId) {
    const app = await createApp(ghConfig);
    if (!app) throw new Error('GitHub App credentials required for installation verify');
    token = await getInstallationToken(app, options.installationId);
  }
  if (!token) throw new Error('No clone token available');

  const workDir = path.join(
    ghConfig.workDirBase,
    `${owner}-${repo}-${Date.now()}`,
  );

  log(`[fixloop:github] cloning ${owner}/${repo}@${baseBranch}…`);

  try {
    await cloneRepository({
      owner,
      repo,
      workDir,
      token,
      ref: baseBranch,
    });

    log('[fixloop:github] installing dependencies…');
    await installDependencies(workDir);

    const runtime = await detectRuntime(workDir);
    log(`[fixloop:github] framework=${runtime.framework} routes=${runtime.routes.length}`);

    const port = 3000 + Math.floor(Math.random() * 2000);
    const server = await startRepoServer(runtime, workDir, port);
    const config = runtimeConfigForGitHub(runtime, port);

    try {
      log('[fixloop:github] scaffolding smoke tests…');
      await initProject(workDir, config);

      log('[fixloop:github] triage → heal (product_regression only) → re-run…');
      const outcome = await runPipeline({
        repoRoot: workDir,
        config,
        enableHeal: true,
        issueNumber: options.issueNumber,
      });

      const changedFiles = await collectGitChanges(workDir, runtime.healTarget);

      const reportMarkdown = buildVerificationReport({
        passed: outcome.passed,
        healCount: outcome.healCount ?? 0,
        lastResult: outcome.lastResult,
        routes: runtime.routes,
        flows: runtime.flows,
        framework: runtime.framework,
        baseUrl: config.baseUrl,
        changedFiles,
        triage: outcome.triage,
        verified: outcome.verified,
      });

      const analysisJson = buildAnalysisJson({
        owner,
        repo,
        branch: baseBranch,
        passed: outcome.passed,
        healCount: outcome.healCount ?? 0,
        framework: runtime.framework,
        routes: runtime.routes,
        flows: runtime.flows,
        changedFiles,
        triage: outcome.triage,
        verified: outcome.verified,
      });

      await fs.mkdir(path.join(workDir, '.fixloop'), { recursive: true });
      await fs.writeFile(
        path.join(workDir, '.fixloop/verification-report.md'),
        reportMarkdown,
        'utf8',
      );
      await fs.writeFile(path.join(workDir, '.fixloop/analysis.json'), analysisJson, 'utf8');

      let prUrl = null;
      const mayOpenPr = options.openPr !== false && outcome.verified && outcome.passed;
      if (!outcome.passed) {
        log('[fixloop:github] re-run still red — not opening a PR');
      } else if (mayOpenPr) {
        log('[fixloop:github] opening draft pull request…');
        const extraPaths = [
          '.fixloop/smoke.testmd',
          '.fixloop/verification-report.md',
          '.fixloop/analysis.json',
          runtime.healTarget,
        ];
        const { pr } = await createVerificationPullRequest({
          octokit,
          owner,
          repo,
          repoRoot: workDir,
          baseBranch,
          reportMarkdown,
          analysisJson,
          passed: outcome.passed,
          extraPaths,
        });
        prUrl = pr.html_url;
        log(`[fixloop:github] draft PR: ${prUrl}`);
      }

      if (options.issueNumber) {
        const summary = outcome.passed
          ? '**fixloop:** re-run passed after patch (draft PR, not merged).'
          : outcome.triage?.label === 'test_defect'
            ? '**fixloop:** `test_defect` — update the test, I will not.'
            : '**fixloop:** suite still red — not opening a PR.';
        await postComment(
          octokit,
          owner,
          repo,
          options.issueNumber,
          `${summary}\n\n${prUrl ? `[View pull request](${prUrl})` : reportMarkdown.slice(0, 6000)}`,
        );
      }

      return {
        passed: outcome.passed,
        healCount: outcome.healCount ?? 0,
        reportMarkdown,
        analysisJson,
        prUrl,
        framework: runtime.framework,
        flows: runtime.flows,
        verified: outcome.verified,
        triage: outcome.triage,
      };
    } finally {
      await server.stop();
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {string} workDir
 * @param {string} healTarget
 */
async function collectGitChanges(workDir, healTarget) {
  const paths = [
    '.fixloop/smoke.testmd',
    '.fixloop/verification-report.md',
    '.fixloop/analysis.json',
    healTarget,
  ];
  const existing = [];
  for (const rel of paths) {
    try {
      await fs.access(path.join(workDir, rel));
      existing.push(rel);
    } catch {
      // skip
    }
  }
  return existing;
}
