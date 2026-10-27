/*
 * Committing to the site's repository through the GitHub REST API.
 * Each publish is one commit on the deploy branch, which Vercel builds and deploys.
 */

const REPO = () => process.env.GITHUB_REPO?.trim() || 'lingmulongtai/KUAS-Photography-Club';
const BRANCH = () => process.env.GITHUB_BRANCH?.trim() || 'main';

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

function failureMessage(status: number, detail: string) {
  if (status === 401) return 'GitHubトークンが無効か期限切れです。Vercelの GITHUB_TOKEN を更新して再デプロイしてください。';
  if (status === 403) return 'GitHubへの保存が拒否されました。トークンにこのリポジトリの Contents: Read and write 権限があるか、ブランチの保護設定を確認してください。';
  if (status === 404) return 'GitHubの保存先が見つかりません。GITHUB_REPO・GITHUB_BRANCH と、トークンの対象リポジトリを確認してください。';
  if (status === 409 || (status === 422 && /fast.?forward|reference update|already exists/i.test(detail))) {
    return '保存先がほかの操作で更新されました。入力内容はそのままで、もう一度公開してください。';
  }
  if (status === 422) return 'GitHubに保存できませんでした。保存先ブランチの保護設定と投稿内容を確認してください。';
  if (status === 429) return 'GitHubの利用回数制限に達しました。しばらく待ってから、もう一度公開してください。';
  return `GitHubへの保存に失敗しました（${status}）。しばらく待ってから、もう一度公開してください。`;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error('公開用のGitHubトークンを読み取れません。Vercelの Production の GITHUB_TOKEN と再デプロイを確認してください。');
  const res = await fetch(`https://api.github.com/repos/${REPO()}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'KUAS-Photography-Club',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new GitHubError(res.status, failureMessage(res.status, await res.text()));
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
    const r = await api<{ content: string; encoding: string }>(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(BRANCH())}`);
    return Buffer.from(r.content, 'base64').toString('utf8');
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

export type CommitFile = { path: string; sha: string } | { path: string; content: string };

/** Commit files on top of the deploy branch and move the branch to the new commit. */
export async function commit(message: string, files: CommitFile[]) {
  const branch = BRANCH().split('/').map(encodeURIComponent).join('/');
  const ref = await api<{ object: { sha: string } }>(`/git/ref/heads/${branch}`);
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
  await api(`/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
  return { sha: c.sha, url: c.html_url };
}
