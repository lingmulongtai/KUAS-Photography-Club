import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../src/lib/admin/auth.ts';
import { readText } from '../src/lib/admin/github.ts';
import { POST as uploadPhoto } from '../src/pages/api/admin/photo.ts';
import { POST as publishTrip } from '../src/pages/api/admin/trip.ts';
import { POST as publishSchedule } from '../src/pages/api/admin/schedule.ts';

const blobSha = '1'.repeat(40);
const headSha = '2'.repeat(40);
const baseTreeSha = '3'.repeat(40);
const treeSha = '4'.repeat(40);
const commitSha = '5'.repeat(40);
const commitUrl = `https://github.com/lingmulongtai/KUAS-Photography-Club/commit/${commitSha}`;
const photo = { name: '01.jpg', alt: '撮影した風景', by: '写真部' };
const trip = {
  slug: 'publish-test', title: '撮影会', date: '2026-10-28', place: '京都',
  summary: 'みんなで撮影しました。', body: '撮影会の記録です。', photos: [photo],
};

function configure(t, values = {}) {
  const settings = {
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'test-only-password', GITHUB_TOKEN: 'test-only-token',
    SESSION_SECRET: undefined, ADMIN_DEMO: undefined, GITHUB_REPO: undefined, GITHUB_BRANCH: undefined,
    VERCEL: '1', NODE_ENV: 'production', ...values,
  };
  const previous = new Map(Object.keys(settings).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(settings)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function signedInCookies() {
  const values = new Map();
  const cookies = {
    set(name, value, options) { values.set(name, { value, options }); },
    get(name) { return values.get(name); },
  };
  signIn(cookies);
  return cookies;
}

const context = (path, body, cookies) => ({
  cookies,
  request: new Request(`https://club.example/api/admin/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function mockPublishing(t, rejectRef = false) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname.replace('/repos/lingmulongtai/KUAS-Photography-Club', '');
    calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    assert.equal(init.headers.authorization, 'Bearer test-only-token');
    assert.equal(init.cache, 'no-store');
    if (path === '/git/blobs') return response({ sha: blobSha }, 201);
    if (path === '/contents/src/content/trips/publish-test.md') return response({ message: 'Not Found' }, 404);
    if (path === '/git/ref/heads/main') return response({ object: { sha: headSha } });
    if (path === `/git/commits/${headSha}`) return response({ tree: { sha: baseTreeSha } });
    if (path === '/git/trees') return response({ sha: treeSha }, 201);
    if (path === '/git/commits') return response({ sha: commitSha, html_url: commitUrl }, 201);
    if (path === '/git/refs/heads/main') {
      return rejectRef
        ? response({ message: 'Update is not a fast forward' }, 422)
        : response({ object: { sha: commitSha } });
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  });
  return calls;
}

test('upload and publish save the photo and Markdown in one commit before reporting the commit SHA', async t => {
  configure(t);
  const calls = mockPublishing(t);
  const cookies = signedInCookies();
  const uploaded = await uploadPhoto(context('photo', { data: '/9j/2Q==' }, cookies));
  assert.equal(uploaded.status, 200);
  assert.deepEqual(await uploaded.json(), { sha: blobSha });

  const saved = await publishTrip(context('trip', { mode: 'new', trip, blobs: { [photo.name]: blobSha } }, cookies));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, commit: commitUrl, sha: commitSha, page: '/trips/publish-test/' });
  const tree = calls.find(call => call.path === '/git/trees').body;
  assert.equal(tree.base_tree, baseTreeSha);
  assert.deepEqual(tree.tree[0], { path: 'public/photos/publish-test/01.jpg', mode: '100644', type: 'blob', sha: blobSha });
  assert.equal(tree.tree[1].path, 'src/content/trips/publish-test.md');
  assert.match(tree.tree[1].content, /src: \/photos\/publish-test\/01\.jpg/);
  assert.match(tree.tree[1].content, /撮影会の記録です。/);
  assert.deepEqual(calls.find(call => call.path === '/git/commits').body.parents, [headSha]);
  assert.deepEqual(calls.at(-1), { path: '/git/refs/heads/main', method: 'PATCH', body: { sha: commitSha, force: false } });
});

test('a rejected branch update reports a real error instead of claiming publication succeeded', async t => {
  configure(t);
  mockPublishing(t, true);
  const saved = await publishTrip(context('trip', { mode: 'new', trip, blobs: { [photo.name]: blobSha } }, signedInCookies()));
  assert.equal(saved.status, 400);
  const body = await saved.json();
  assert.match(body.error, /ほかの操作で更新/);
  assert.equal(body.ok, undefined);
  assert.equal(body.demo, undefined);
  assert.equal(body.sha, undefined);
});

test('missing production credentials never create a fake photo, trip, or schedule publication', async t => {
  configure(t, { GITHUB_TOKEN: undefined });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('GitHub must not be called without credentials'); });
  const cookies = signedInCookies();
  for (const [handler, path, input] of [
    [uploadPhoto, 'photo', { data: '/9j/2Q==' }],
    [publishTrip, 'trip', { mode: 'new', trip, blobs: {} }],
    [publishSchedule, 'schedule', { month: '2026-10', weeklyMeeting: false, noMeeting: [], events: [] }],
  ]) {
    const saved = await handler(context(path, input, cookies));
    assert.equal(saved.status, 503);
    const body = await saved.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(body.demo, undefined);
    assert.equal(body.ok, undefined);
  }
});

test('expired and unauthorized tokens surface a useful error without disclosing the credential', async t => {
  configure(t);
  const cookies = signedInCookies();
  for (const status of [401, 403]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => response({ message: 'GitHub failure' }, status));
    const uploaded = await uploadPhoto(context('photo', { data: '/9j/2Q==' }, cookies));
    assert.equal(uploaded.status, 502);
    const body = await uploaded.json();
    assert.match(body.error, status === 401 ? /期限切れ/ : /Read and write/);
    assert.doesNotMatch(body.error, /test-only-token/);
    assert.equal(body.sha, undefined);
    mocked.mock.restore();
  }
});

test('reading the deploy branch encodes its ref as a single query value', async t => {
  configure(t, { GITHUB_BRANCH: 'feature/photo#1' });
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('ref'), 'feature/photo#1');
    assert.equal(parsed.hash, '');
    return response({ encoding: 'base64', content: Buffer.from('写真の記録').toString('base64') });
  });
  assert.equal(await readText('src/content/trips/publish-test.md'), '写真の記録');
});
