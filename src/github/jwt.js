import crypto from 'node:crypto';

/**
 * GitHub App RS256 JWT. Node crypto only — no jsonwebtoken / universal-github-app-jwt.
 * @param {string|number} appId
 * @param {string} privateKeyPem
 * @param {number} [nowSeconds]
 */
export function createAppJwt(appId, privateKeyPem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: String(appId),
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign('sha256', Buffer.from(unsigned), key).toString('base64url');
  return `${unsigned}.${signature}`;
}

/**
 * @param {string|number} appId
 * @param {string} privateKeyPem
 * @param {number} installationId
 */
export async function createInstallationToken(appId, privateKeyPem, installationId) {
  const jwt = createAppJwt(appId, privateKeyPem);
  const res = await fetch(`https://api.github.com/app/installations/${Number(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'fixloop',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) {
    const message = data?.message ? String(data.message) : `GitHub ${res.status}`;
    throw new Error(`Could not resolve installation access token: ${message}`);
  }
  return data.token;
}
