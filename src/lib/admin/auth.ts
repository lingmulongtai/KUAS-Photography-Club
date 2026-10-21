import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

/*
 * Admin sign-in. Configure on Vercel (Project → Settings → Environment Variables):
 *   ADMIN_USERNAME   shared sign-in ID (defaults to "admin").
 *   ADMIN_PASSWORD   the password for /admin/. Without it the panel runs in demo mode
 *                    (ID "admin", password "demo") and nothing is published.
 *   GITHUB_TOKEN     a fine-grained token with Contents: read and write on this repository,
 *                    so publishing can commit photos and Markdown (Vercel then redeploys).
 *   SESSION_SECRET   optional; adds a secret to the credential-bound cookie signature.
 */

const COOKIE = 'kuas_admin';
const HOURS = 12;
export const DEFAULT_USERNAME = 'admin';
export const DEMO_PASSWORD = 'demo';

export const isDemo = () => !process.env.ADMIN_PASSWORD;
export const canPublish = () => !isDemo() && !!process.env.GITHUB_TOKEN;

const username = () => isDemo() ? DEFAULT_USERNAME : process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
const password = () => process.env.ADMIN_PASSWORD || DEMO_PASSWORD;

const secret = () =>
  createHash('sha256')
    .update(JSON.stringify(['kuas-admin:v2', username(), password(), process.env.GITHUB_TOKEN || '', process.env.SESSION_SECRET || '']))
    .digest('hex');

const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

const digest = (s: string) => createHash('sha256').update(s).digest();

export function checkCredentials(id: unknown, inputPassword: unknown) {
  if (typeof id !== 'string' || typeof inputPassword !== 'string') return false;
  const validId = timingSafeEqual(digest(id), digest(username()));
  const validPassword = timingSafeEqual(digest(inputPassword), digest(password()));
  return validId && validPassword;
}

export function signIn(cookies: AstroCookies) {
  const body = String(Date.now() + HOURS * 3600_000);
  cookies.set(COOKIE, `${body}.${sign(body)}`, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: HOURS * 3600 });
}

export function signOut(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/' });
}

export function signedIn(cookies: AstroCookies) {
  const v = cookies.get(COOKIE)?.value;
  if (!v) return false;
  const [body, mac] = v.split('.');
  if (!body || !mac) return false;
  const expected = sign(body);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  return Number(body) > Date.now();
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Reject anything that is not a same-site JSON call from a signed-in admin. */
export function guard(request: Request, cookies: AstroCookies) {
  if (!signedIn(cookies)) return json({ error: 'ログインしてください' }, 401);
  if (request.method !== 'GET' && !request.headers.get('content-type')?.includes('application/json')) return json({ error: 'bad request' }, 400);
  return null;
}
