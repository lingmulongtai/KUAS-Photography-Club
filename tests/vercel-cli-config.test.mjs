import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const cli = require('@vercel/cli-config');
const fromCli = createRequire(require.resolve('@vercel/cli-config'));
const z = fromCli('zod');

const upstreamExports = [
  'CRED_STORAGE_CONFIG_VALUES', 'CRED_STORAGE_VALUES', 'DEFAULT_CRED_STORAGE',
  'authConfigHasUsableTokenData', 'authConfigSchema', 'credStorageSchema',
  'defaultAuthConfig', 'defaultGlobalConfig', 'deleteAuthConfig', 'deleteAuthConfigFile',
  'getAuthConfigFilePath', 'getCachePath', 'getConfigFilePath', 'getDataPath',
  'getDefaultAuthConfig', 'getGlobalPathConfig', 'getLikelyEffectiveCredStorage',
  'globalConfigSchema', 'guidanceConfigSchema', 'parseAuthConfig', 'parseAuthFileConfig',
  'parseGlobalConfig', 'readAuthConfig', 'readAuthConfigFile', 'readAuthFileConfig',
  'readConfigFile', 'readGlobalConfigFile', 'telemetryConfigSchema', 'tryReadAuthConfig',
  'updatesConfigSchema', 'writeAuthConfig', 'writeAuthConfigFile', 'writeConfigFile',
  'writeGlobalConfigFile',
].sort();

test('local CLI config retains the upstream CJS and ESM exports', async () => {
  assert.deepEqual(Object.keys(cli).sort(), upstreamExports);
  const esm = await import('@vercel/cli-config');
  assert.deepEqual(Object.keys(esm).sort(), [...upstreamExports, 'default'].sort());
  assert.equal(esm.parseAuthConfig, cli.parseAuthConfig);
  assert.equal(require('@vercel/cli-config/paths').getAuthConfigFilePath, cli.getAuthConfigFilePath);
});

test('Vercel file tracing includes CLI modules and the patched Zod', async () => {
  const { nodeFileTrace } = await import('@vercel/nft');
  const result = await nodeFileTrace(['node_modules/@vercel/oidc/dist/token-util.js'], { base: process.cwd() });
  const files = new Set([...result.fileList].map((file) => file.replaceAll('\\', '/')));
  for (const file of ['types.js', 'schema.js', 'schema.zod.js', 'cli-config.js', 'cred-storage.js', 'paths.js']) {
    assert(files.has(`vendor/vercel-cli-config/lib/${file}`), `${file} was not traced`);
  }
  assert(files.has('node_modules/zod/package.json'), 'Zod was not traced');
  assert.equal(result.warnings.size, 0);
});

test('CLI config resolves patched Zod and rejects oversized bounded collections early', () => {
  assert.equal(fromCli('zod/package.json').version, '4.6.7');
  const checks = [
    cli.globalConfigSchema.array().max(1).safeParse(Array(100).fill(null)),
    z.set(z.string()).max(1).safeParse(new Set([1, 2, 3])),
    z.map(z.string(), z.string()).max(1).safeParse(new Map([[1, 1], [2, 2]])),
  ];
  for (const result of checks) {
    assert.equal(result.success, false);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, 'too_big');
  }
  assert.equal(cli.globalConfigSchema.array().max(1).safeParse([{}]).success, true);
});

test('auth and global settings preserve valid data and reject invalid inputs', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kuas-cli-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const auth = { token: 'dummy-token', refreshToken: 'dummy-refresh', expiresAt: 1234, tokenSource: 'env', extra: 'retained' };
  const settings = { currentTeam: 'example', credStorage: 'file', telemetry: { enabled: false }, extra: 'retained' };
  cli.writeAuthConfig(dir, auth);
  cli.writeGlobalConfigFile(cli.getConfigFilePath(dir), settings);
  assert.deepEqual(cli.readAuthConfig(dir), auth);
  assert.deepEqual(cli.readAuthFileConfig(cli.getAuthConfigFilePath(dir)), { token: 'dummy-token', refreshToken: 'dummy-refresh', expiresAt: 1234, extra: 'retained' });
  assert.deepEqual(cli.readGlobalConfigFile(cli.getConfigFilePath(dir)), settings);
  assert.throws(() => cli.parseAuthConfig({ token: ['invalid'] }));
  assert.throws(() => cli.parseGlobalConfig({ credStorage: 'invalid' }), /credStorage/);
  const before = readFileSync(cli.getAuthConfigFilePath(dir), 'utf8');
  cli.writeAuthConfig(dir, { token: 'ignored', skipWrite: true });
  assert.equal(readFileSync(cli.getAuthConfigFilePath(dir), 'utf8'), before);
  cli.deleteAuthConfig(dir);
  assert.equal(cli.tryReadAuthConfig(dir), null);
});

test('OIDC accepts dummy environment and file tokens without accessing real credentials', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kuas-oidc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `e30.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.signature`;
  const tokenFile = join(dir, 'oidc-token');
  writeFileSync(tokenFile, token);
  const script = "const x=require('@vercel/oidc'); x.getVercelOidcToken().then(t=>{if(t!==process.env.EXPECTED) process.exit(1)}).catch(()=>process.exit(1))";
  for (const values of [{ VERCEL_OIDC_TOKEN: token }, { VERCEL_OIDC_TOKEN_FILE: tokenFile }]) {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, EXPECTED: token, ...values },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('OIDC reads and invalidates only isolated dummy CLI credentials', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kuas-oidc-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const assert = require('node:assert/strict');
    const cli = require('@vercel/cli-config');
    const root = process.env.TEST_CONFIG_ROOT;
    const data = cli.getDataPath();
    const relative = path.relative(root, data);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.mkdirSync(data, { recursive: true });
    assert.equal(cli.getGlobalPathConfig(), data);
    const util = require(path.join(path.dirname(require.resolve('@vercel/oidc')), 'token-util.js'));
    (async () => {
      cli.writeAuthConfig(data, { token: 'dummy-valid', expiresAt: 4102444800 });
      assert.equal(await util.getVercelToken(), 'dummy-valid');
      cli.writeAuthConfig(data, { token: 'dummy-expired', expiresAt: 1 });
      await assert.rejects(util.getVercelToken());
      assert.deepEqual(cli.readAuthConfig(data), {});
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEST_CONFIG_ROOT: dir,
      XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir, APPDATA: dir, LOCALAPPDATA: dir },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
