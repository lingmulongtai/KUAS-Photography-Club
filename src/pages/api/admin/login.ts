import type { APIRoute } from 'astro';
import { checkPassword, json, signIn, signOut } from '../../../lib/admin/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!checkPassword(password)) {
    // slow down guessing
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: 'パスワードが違います' }, 401);
  }
  signIn(cookies);
  return json({ ok: true });
};

export const DELETE: APIRoute = ({ cookies }) => {
  signOut(cookies);
  return json({ ok: true });
};
