import type { APIRoute } from 'astro';
import { canPublish, guard, json, publishingGuard } from '../../../lib/admin/auth.ts';
import { createBlob } from '../../../lib/admin/github.ts';

export const prerender = false;

const MAX_BYTES = 3.2 * 1024 * 1024;

/**
 * One photo (a JPEG the browser has already resized and stripped of EXIF), stored on GitHub as
 * a blob so the publish step can commit it. Only an explicitly enabled local demo skips storage.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = guard(request, cookies);
  if (denied) return denied;
  const unavailable = publishingGuard();
  if (unavailable) return unavailable;
  let data: unknown;
  try {
    ({ data } = await request.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof data !== 'string') return json({ error: '写真が空です' }, 400);
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > MAX_BYTES) return json({ error: '写真が大きすぎます' }, 413);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ error: 'JPEG ではありません' }, 415);
  if (!canPublish()) return json({ sha: `demo-${bytes.length}`, demo: true });
  try {
    return json({ sha: await createBlob(data) });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
};
