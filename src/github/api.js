/**
 * Tiny GitHub REST client (fetch). Replaces @octokit/rest so the published
 * tarball has no third-party runtime dependencies.
 */

const API = 'https://api.github.com';

export class GitHubHttpError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   */
  constructor(message, status) {
    super(message);
    this.name = 'GitHubHttpError';
    this.status = status;
  }
}

/**
 * @param {string} token
 * @param {string} [userAgent]
 */
export function createGitHubClient(token, userAgent = 'fixloop') {
  if (!token) throw new Error('GitHub token is required');

  /**
   * @param {string} method
   * @param {string} apiPath
   * @param {object} [body]
   * @param {Record<string, string>} [extraHeaders]
   */
  async function request(method, apiPath, body, extraHeaders = {}) {
    const res = await fetch(`${API}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': userAgent,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
    if (!res.ok) {
      const message = data && typeof data === 'object' && 'message' in data ? String(data.message) : `GitHub ${res.status}`;
      throw new GitHubHttpError(message, res.status);
    }
    return { data, status: res.status };
  }

  const enc = encodeURIComponent;

  return {
    token,
    request,
    auth: async () => ({ token }),
    repos: {
      get: ({ owner, repo }) => request('GET', `/repos/${enc(owner)}/${enc(repo)}`),
      getBranch: ({ owner, repo, branch }) =>
        request('GET', `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(branch)}`),
      getContent: ({ owner, repo, path: filePath, ref }) => {
        const q = ref ? `?ref=${enc(ref)}` : '';
        return request('GET', `/repos/${enc(owner)}/${enc(repo)}/contents/${filePath.split('/').map(enc).join('/')}${q}`);
      },
      createOrUpdateFileContents: ({ owner, repo, path: filePath, message, content, branch, sha }) =>
        request('PUT', `/repos/${enc(owner)}/${enc(repo)}/contents/${filePath.split('/').map(enc).join('/')}`, {
          message,
          content,
          branch,
          ...(sha ? { sha } : {}),
        }),
    },
    git: {
      listMatchingRefs: ({ owner, repo, ref }) =>
        request('GET', `/repos/${enc(owner)}/${enc(repo)}/git/matching-refs/${ref.split('/').map(enc).join('/')}`),
      createRef: ({ owner, repo, ref, sha }) =>
        request('POST', `/repos/${enc(owner)}/${enc(repo)}/git/refs`, { ref, sha }),
    },
    pulls: {
      list: ({ owner, repo, state = 'open', per_page = 30 }) =>
        request(
          'GET',
          `/repos/${enc(owner)}/${enc(repo)}/pulls?state=${enc(state)}&per_page=${Number(per_page)}`,
        ),
      create: ({ owner, repo, title, head, base, body, draft }) =>
        request('POST', `/repos/${enc(owner)}/${enc(repo)}/pulls`, {
          title,
          head,
          base,
          body,
          draft: Boolean(draft),
        }),
      update: ({ owner, repo, pull_number, title, body }) =>
        request('PATCH', `/repos/${enc(owner)}/${enc(repo)}/pulls/${Number(pull_number)}`, {
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
        }),
    },
    issues: {
      createComment: ({ owner, repo, issue_number, body }) =>
        request('POST', `/repos/${enc(owner)}/${enc(repo)}/issues/${Number(issue_number)}/comments`, { body }),
    },
  };
}
