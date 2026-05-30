import { spawn } from 'node:child_process';
import { waitForHttp } from '../pipeline.js';

/**
 * @param {import('./detect.js').RepoRuntime} runtime
 * @param {string} repoRoot
 * @param {number} port
 */
export async function startRepoServer(runtime, repoRoot, port) {
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
  };

  const child = spawn(runtime.startCommand, runtime.startArgs, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];

  child.stdout?.on('data', (c) => logs.push(c.toString()));
  child.stderr?.on('data', (c) => logs.push(c.toString()));

  try {
    await waitForHttp(baseUrl, 45000);
  } catch (err) {
    child.kill('SIGTERM');
    throw new Error(
      `Dev server did not become ready at ${baseUrl}: ${err.message}\n${logs.slice(-8).join('')}`,
    );
  }

  return {
    baseUrl,
    port,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 400));
      if (!child.killed) child.kill('SIGKILL');
    },
  };
}
