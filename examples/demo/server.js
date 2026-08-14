import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const ROUTES = {
  '/': 'index.html',
  '/about': 'about.html',
};

async function readPublic(relativePath) {
  const filePath = path.join(PUBLIC_DIR, relativePath);
  const resolved = path.resolve(filePath);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (resolved !== publicRoot && !resolved.startsWith(publicRoot + path.sep)) {
    throw new Error('Invalid path');
  }
  return fs.readFile(resolved);
}

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    if (pathname in ROUTES) {
      const file = ROUTES[pathname];
      const body = await readPublic(file);
      res.writeHead(200, {
        'Content-Type': contentType(file),
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      return;
    }

    if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
      const relative = pathname.slice(1);
      const body = await readPublic(relative);
      res.writeHead(200, {
        'Content-Type': contentType(relative),
        'Cache-Control': pathname.startsWith('/js/') ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`[fixloop example] http://localhost:${port}`);
});
