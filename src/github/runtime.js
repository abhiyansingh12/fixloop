import { spawn } from 'node:child_process';
import { waitForHttp } from '../pipeline.js';
import { redactSecrets } from '../secrets.js';

/**
 * @param {string[]} args
 * @param {number} port
 */
export function applyPortToArgs(args, port) {
  const next = [...args];
  for (let i = 0; i < next.length; i += 1) {
    if ((next[i] === '-p' || next[i] === '--port') && next[i + 1]) {
      next[i + 1] = String(port);
    } else if (typeof next[i] === 'string' && next[i].startsWith('--port=')) {
      next[i] = `--port=${port}`;
    }
  }
  return next;
}

/**
 * @param {import('./detect.js').RepoRuntime} runtime
 * @param {string} repoRoot
 * @param {number} port
 */
export async function startRepoServer(runtime, repoRoot, port) {
  if (!runtime.startCommand || !runtime.startArgs?.length) {
    throw new Error(
      `No start command detected for framework=${runtime.framework}. Set a "dev" or "start" script in package.json.`,
    );
  }

  const startArgs = applyPortToArgs(runtime.startArgs, port);
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'development',
  };

  const child = spawn(runtime.startCommand, startArgs, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const urls = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const logs = [];

  child.stdout?.on('data', (c) => logs.push(c.toString()));
  child.stderr?.on('data', (c) => logs.push(c.toString()));

  let lastError = null;
  for (const baseUrl of urls) {
    try {
      await waitForHttp(baseUrl, 45000);
      return {
        baseUrl,
        port,
        async stop() {
          child.kill('SIGTERM');
          await new Promise((r) => setTimeout(r, 400));
          if (!child.killed) child.kill('SIGKILL');
        },
      };
    } catch (err) {
      lastError = err;
    }
  }

  child.kill('SIGTERM');
  throw new Error(
    redactSecrets(
      `Dev server did not become ready on port ${port}: ${lastError?.message ?? 'unknown'}\n${logs.slice(-12).join('')}`,
    ),
  );
}
