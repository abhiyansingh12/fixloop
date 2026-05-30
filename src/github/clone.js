import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

/**
 * Shallow clone into workDir.
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} opts.workDir
 * @param {string} opts.token
 * @param {string} [opts.ref]
 */
export async function cloneRepository(opts) {
  const { owner, repo, workDir, token, ref } = opts;
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workDir), { recursive: true });

  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(cloneUrl, workDir);

  await run('git', args, { stdio: 'pipe' });
  return workDir;
}

/**
 * @param {string} repoRoot
 */
export async function installDependencies(repoRoot) {
  try {
    await fs.access(path.join(repoRoot, 'package.json'));
  } catch {
    return;
  }
  const lock = path.join(repoRoot, 'package-lock.json');
  let hasLock = false;
  try {
    await fs.access(lock);
    hasLock = true;
  } catch {
    // no lock
  }

  const args = hasLock ? ['ci', '--omit=dev'] : ['install', '--omit=dev'];
  try {
    await run('npm', args, { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    await run('npm', ['install'], { cwd: repoRoot, stdio: 'pipe' });
  }
}
