import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPublish, checkCredentials, isDemo, signIn, signedIn } from '../src/lib/admin/auth.ts';
import { POST, DELETE } from '../src/pages/api/admin/login.ts';

function configure(t, values = {}) {
  const names = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'GITHUB_TOKEN', 'SESSION_SECRET'];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function cookieJar() {
  const values = new Map();
  return {
    values,
    set(name, value, options) { values.set(name, { value, options }); },
    get(name) { return values.get(name); },
    delete(name) { values.delete(name); },
  };
}

const login = (credentials, cookies) => POST({
  request: new Request('https://club.example/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  }),
  cookies,
});

test('demo requires the demo ID and password and cannot publish even with a GitHub token', t => {
  configure(t, { ADMIN_USERNAME: 'club-operators', ADMIN_PASSWORD: '', GITHUB_TOKEN: 'test-only-token' });
  assert.equal(isDemo(), true);
  assert.equal(canPublish(), false);
  assert.equal(checkCredentials('admin', 'demo'), true);
  assert.equal(checkCredentials('club-operators', 'demo'), false);
  assert.equal(checkCredentials(undefined, 'demo'), false);
});

test('production requires both configured credentials and rejects demo credentials', t => {
  configure(t, { ADMIN_USERNAME: 'club-operators', ADMIN_PASSWORD: 'test-only-password', GITHUB_TOKEN: 'test-only-token' });
  assert.equal(isDemo(), false);
  assert.equal(canPublish(), true);
  assert.equal(checkCredentials('club-operators', 'test-only-password'), true);
  for (const [id, password] of [
    ['admin', 'test-only-password'],
    ['club-operators', 'wrong-password'],
    ['admin', 'demo'],
    [undefined, 'test-only-password'],
    ['club-operators', null],
    [{ username: 'club-operators' }, 'test-only-password'],
  ]) assert.equal(checkCredentials(id, password), false);
});

test('existing password-only configuration uses admin as its ID and still needs a publish token', t => {
  configure(t, { ADMIN_PASSWORD: 'test-only-password' });
  assert.equal(checkCredentials('admin', 'test-only-password'), true);
  assert.equal(canPublish(), false);
});

test('successful login issues a protected session and logout removes it', async t => {
  configure(t, { ADMIN_USERNAME: 'club-operators', ADMIN_PASSWORD: 'test-only-password' });
  const cookies = cookieJar();
  const response = await login({ username: 'club-operators', password: 'test-only-password' }, cookies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(signedIn(cookies), true);
  const session = cookies.values.get('kuas_admin');
  assert.equal(session.options.httpOnly, true);
  assert.equal(session.options.secure, true);
  assert.equal(session.options.sameSite, 'strict');
  assert.equal(session.options.maxAge, 12 * 3600);
  const logout = DELETE({ cookies });
  assert.equal(logout.status, 200);
  assert.equal(signedIn(cookies), false);
});

test('login does not reveal which credential was wrong and rejects password-only requests', async t => {
  configure(t, { ADMIN_USERNAME: 'club-operators', ADMIN_PASSWORD: 'test-only-password' });
  for (const credentials of [
    { username: 'wrong-id', password: 'test-only-password' },
    { username: 'club-operators', password: 'wrong-password' },
    { password: 'test-only-password' },
  ]) {
    const cookies = cookieJar();
    const response = await login(credentials, cookies);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'ID またはパスワードが違います' });
    assert.equal(cookies.values.size, 0);
  }
});

test('invalid login JSON cannot create a session', async t => {
  configure(t);
  const cookies = cookieJar();
  const response = await POST({
    request: new Request('https://club.example/api/admin/login', { method: 'POST', body: '{' }),
    cookies,
  });
  assert.equal(response.status, 400);
  assert.equal(cookies.values.size, 0);
});

test('changing either shared credential invalidates existing sessions even with SESSION_SECRET', t => {
  configure(t, { ADMIN_USERNAME: 'club-operators', ADMIN_PASSWORD: 'test-only-password', SESSION_SECRET: 'test-only-session-secret' });
  for (const [name, value] of [['ADMIN_USERNAME', 'new-operators'], ['ADMIN_PASSWORD', 'new-test-password']]) {
    const cookies = cookieJar();
    signIn(cookies);
    assert.equal(signedIn(cookies), true);
    const previous = process.env[name];
    process.env[name] = value;
    assert.equal(signedIn(cookies), false);
    process.env[name] = previous;
  }
});

test('a tampered or expired session is rejected', t => {
  configure(t, { ADMIN_PASSWORD: 'test-only-password' });
  const cookies = cookieJar();
  signIn(cookies);
  const original = cookies.get('kuas_admin').value;
  cookies.set('kuas_admin', `0.${original.split('.')[1]}`);
  assert.equal(signedIn(cookies), false);
  cookies.set('kuas_admin', original.replace(/.$/, value => value === 'a' ? 'b' : 'a'));
  assert.equal(signedIn(cookies), false);
  cookies.set('kuas_admin', original);
  t.mock.method(Date, 'now', () => Number(original.split('.')[0]) + 1);
  assert.equal(signedIn(cookies), false);
});
