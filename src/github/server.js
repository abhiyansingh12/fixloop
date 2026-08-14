import http from 'node:http';
import { loadGitHubConfig } from './config.js';
import { createWebhookHandlers } from './webhooks.js';
import { redactSecrets } from '../secrets.js';

/**
 * Start GitHub webhook HTTP server.
 * @param {object} [opts]
 * @param {number} [opts.port]
 */
export async function startGitHubWebhookServer(opts = {}) {
  const config = await loadGitHubConfig();
  const port = opts.port ?? config.port;
  const webhooks = await createWebhookHandlers(opts);

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'fixloop-github' }));
      return;
    }

    if (req.url !== '/api/github/webhooks' || req.method !== 'POST') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const chunks = [];
    let received = 0;
    for await (const chunk of req) {
      received += chunk.length;
      if (received > 1024 * 1024) {
        res.writeHead(413);
        res.end('Payload too large');
        return;
      }
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const id = req.headers['x-github-delivery'];
    const name = req.headers['x-hub-signature-256']
      ? 'x-hub-signature-256'
      : 'x-hub-signature';
    const sig = req.headers[name];

    try {
      await webhooks.verifyAndReceive({
        id: String(id),
        name: req.headers['x-github-event'],
        payload: rawBody,
        signature: String(sig),
      });
      res.writeHead(200);
      res.end('ok');
    } catch (err) {
      console.error('[fixloop:github] webhook error:', redactSecrets(err.message));
      res.writeHead(400);
      res.end('Webhook Error');
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`[fixloop:github] webhook server http://0.0.0.0:${port}/api/github/webhooks`);
  console.log(`[fixloop:github] health http://0.0.0.0:${port}/health`);

  return { server, port };
}
