/*
 * Committing to the site's repository through the GitHub REST API.
 * Each publish is one commit on the deploy branch, which Vercel builds and deploys.
 */

const REPO = () => process.env.GITHUB_REPO || 'lingmulongtai/KUAS-Photography-Club';
const BRANCH = () => process.env.GITHUB_BRANCH || 'main';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${REPO()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/** Store a file's bytes (base64) and return its blob sha, to commit later. */
export async function createBlob(base64: string) {
  const r = await api<{ sha: string }>('/git/blobs', { method: 'POST', body: JSON.stringify({ content: base64, encoding: 'base64' }) });
  return r.sha;
}

/** A text file on the deploy branch, or null if it doesn't exist. */
export async function readText(path: string) {
  try {
    const r = await api<{ content: string; encoding: string }>(`/contents/${encodeURI(path)}?ref=${BRANCH()}`);
    return Buffer.from(r.content, 'base64').toString('utf8');
  } catch (e) {
    if (String(e).includes('GitHub 404')) return null;
    throw e;
  }
}

export type CommitFile = { path: string; sha: string } | { path: string; content: string };

/** Commit files on top of the deploy branch and move the branch to the new commit. */
export async function commit(message: string, files: CommitFile[]) {
  const ref = await api<{ object: { sha: string } }>(`/git/ref/heads/${BRANCH()}`);
  const head = await api<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);
  const tree = await api<{ sha: string }>('/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: head.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', ...('sha' in f ? { sha: f.sha } : { content: f.content }) })),
    }),
  });
  const c = await api<{ sha: string; html_url: string }>('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
  });
  await api(`/git/refs/heads/${BRANCH()}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  return { sha: c.sha, url: c.html_url };
}
