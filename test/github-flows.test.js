import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverFlows, buildTestmdFromRoutes } from '../src/scanner.js';
import { buildVerificationReport } from '../src/github/report.js';

describe('github flow discovery', () => {
  it('tags login and dashboard routes', () => {
    const flows = discoverFlows([
      { route: '/', file: 'app/page.tsx' },
      { route: '/login', file: 'app/login/page.tsx' },
      { route: '/dashboard', file: 'app/dashboard/page.tsx' },
    ]);
    assert.equal(flows.find((f) => f.route === '/login')?.flowKind, 'login');
    assert.equal(flows.find((f) => f.route === '/dashboard')?.flowKind, 'dashboard');
  });

  it('builds testmd with flow-aware steps', () => {
    const md = buildTestmdFromRoutes(
      [{ route: '/login', file: 'pages/login.tsx' }],
      'http://localhost:3000',
    );
    assert.match(md, /login/i);
    assert.match(md, /login form/i);
  });
});

describe('verification report', () => {
  it('includes pass status and flows', () => {
    const report = buildVerificationReport({
      passed: true,
      healCount: 1,
      framework: 'next',
      baseUrl: 'http://127.0.0.1:3000',
      flows: [{ route: '/login', flowKind: 'login', file: 'x' }],
      routes: [{ route: '/login', file: 'x' }],
    });
    assert.match(report, /Passed/);
    assert.match(report, /login/);
  });
});
