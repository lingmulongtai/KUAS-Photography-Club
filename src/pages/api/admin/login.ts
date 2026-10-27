import type { APIRoute } from 'astro';
import { checkCredentials, configurationError, isConfigured, json, signIn, signOut } from '../../../lib/admin/auth.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isConfigured()) return json({ error: configurationError(), code: 'ADMIN_NOT_CONFIGURED' }, 503);
  let username: unknown;
  let password: unknown;
  try {
    ({ username, password } = await request.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!checkCredentials(username, password)) {
    // slow down guessing
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: 'ID またはパスワードが違います' }, 401);
  }
  signIn(cookies);
  return json({ ok: true });
};

export const DELETE: APIRoute = ({ cookies }) => {
  signOut(cookies);
  return json({ ok: true });
};
