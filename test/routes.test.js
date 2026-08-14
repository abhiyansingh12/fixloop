import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractRouterPaths,
  fileToRoute,
  normalizeRouteSegment,
  remixFilenameToRoute,
} from '../src/routes.js';
import { scanStaticPages } from '../src/scanner.js';

describe('fileToRoute', () => {
  it('maps Next app dir including root page and route groups', () => {
    assert.equal(fileToRoute('/repo', '/repo/app/page.tsx'), '/');
    assert.equal(fileToRoute('/repo', '/repo/app/login/page.tsx'), '/login');
    assert.equal(
      fileToRoute('/repo', '/repo/app/(marketing)/about/page.tsx'),
      '/about',
    );
    assert.equal(fileToRoute('/repo', '/repo/app/blog/[slug]/page.tsx'), '/blog/:slug');
  });

  it('maps SvelteKit and Remix files', () => {
    assert.equal(fileToRoute('/repo', '/repo/src/routes/+page.svelte'), '/');
    assert.equal(fileToRoute('/repo', '/repo/src/routes/login/+page.svelte'), '/login');
    assert.equal(fileToRoute('/repo', '/repo/app/routes/_index.tsx'), '/');
    assert.equal(fileToRoute('/repo', '/repo/app/routes/login.tsx'), '/login');
    assert.equal(fileToRoute('/repo', '/repo/app/routes/posts.$id.tsx'), '/posts/:id');
  });
});

describe('route helpers', () => {
  it('normalizes groups and remix filenames', () => {
    assert.equal(normalizeRouteSegment('(app)/settings'), 'settings');
    assert.equal(remixFilenameToRoute('_index.tsx'), '/');
    assert.equal(remixFilenameToRoute('dashboard.tsx'), '/dashboard');
  });

  it('extracts React Router paths', () => {
    const source = `
      const router = createBrowserRouter([
        { path: '/', element: <Home /> },
        { path: '/login', element: <Login /> },
      ]);
      <Route path="/checkout" element={<Checkout />} />
    `;
    const paths = extractRouterPaths(source);
    assert.ok(paths.includes('/'));
    assert.ok(paths.includes('/login'));
    assert.ok(paths.includes('/checkout'));
  });
});

describe('nested static HTML', () => {
  it('maps public/docs/guide.html to /docs/guide', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-heal-html-'));
    const nested = path.join(dir, 'public', 'docs');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(dir, 'public', 'index.html'), '<h1>home</h1>');
    await fs.writeFile(path.join(nested, 'guide.html'), '<h1>guide</h1>');
    try {
      const routes = await scanStaticPages(dir);
      assert.ok(routes.some((r) => r.route === '/' && r.file === 'public/index.html'));
      assert.ok(routes.some((r) => r.route === '/docs/guide' && r.file === 'public/docs/guide.html'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
