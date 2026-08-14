import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isValidGitHubRepoName } from '../policy.js';

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [opts]
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...opts,
      stdio: opts.stdio ?? 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} repoRoot
 */
export async function detectPackageManager(repoRoot) {
  if (await exists(path.join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(repoRoot, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(repoRoot, 'bun.lockb')) || await exists(path.join(repoRoot, 'bun.lock'))) {
    return 'bun';
  }
  return 'npm';
}

/**
 * Shallow clone into workDir. Token is passed via http.extraHeader so it
 * does not appear in the remote URL or `ps` argument list.
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} opts.workDir
 * @param {string} opts.token
 * @param {string} [opts.ref]
 */
export async function cloneRepository(opts) {
  const { owner, repo, workDir, token, ref } = opts;
  if (!isValidGitHubRepoName(owner, repo)) {
    throw new Error(`Invalid GitHub repository "${owner}/${repo}"`);
  }
  if (ref && !/^[A-Za-z0-9._\/-]+$/.test(ref)) {
    throw new Error(`Invalid git ref "${ref}"`);
  }

  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workDir), { recursive: true });

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(cloneUrl, workDir);

  await run('git', args, {
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return workDir;
}

/**
 * Install production *and* dev dependencies — `next`/`vite` live in devDependencies.
 * @param {string} repoRoot
 */
export async function installDependencies(repoRoot) {
  if (!(await exists(path.join(repoRoot, 'package.json')))) return;

  const pm = await detectPackageManager(repoRoot);
  /** @type {Record<string, [string, string[]]>} */
  const commands = {
    npm: [
      'npm',
      (await exists(path.join(repoRoot, 'package-lock.json'))) ? ['ci'] : ['install'],
    ],
    pnpm: ['pnpm', ['install', '--frozen-lockfile']],
    yarn: ['yarn', ['install', '--frozen-lockfile']],
    bun: ['bun', ['install']],
  };

  const [cmd, args] = commands[pm] ?? commands.npm;
  try {
    await run(cmd, args, { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    await run('npm', ['install'], { cwd: repoRoot, stdio: 'pipe' });
  }
}
