import type { APIRoute } from 'astro';
import { canPublish, guard, json } from '../../../lib/admin/auth';
import { commit, readText, type CommitFile } from '../../../lib/admin/github';
import { appendPhotos, checkSlug, cleanSpot, photoEntries, photoPath, tripMarkdown, tripPath, type PhotoIn, type TripIn } from '../../../lib/admin/content';

export const prerender = false;

type Body =
  | { mode: 'new'; trip: TripIn; blobs: Record<string, string> }
  | { mode: 'append'; slug: string; spot?: string | null; photos: PhotoIn[]; blobs: Record<string, string> };

/**
 * Publish a new trip, or add photos to an existing one, as a single commit:
 * the photos under public/photos/<slug>/ and the Markdown in src/content/trips/.
 * In demo mode it returns the Markdown it would have written.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = guard(request, cookies);
  if (denied) return denied;
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  try {
    const slug = checkSlug(body.mode === 'new' ? body.trip?.slug : body.slug);
    const photos = body.mode === 'new' ? body.trip.photos : body.photos;
    let md: string;
    let message: string;
    if (body.mode === 'new') {
      md = tripMarkdown(body.trip);
      message = `content(trips): add ${body.trip.title}`;
      if (canPublish() && (await readText(tripPath(slug))) !== null) throw new Error('その URL 用の名前の撮影会はもうあります');
    } else {
      if (!canPublish()) {
        const spot = cleanSpot(body.spot);
        const preview = `# 今ある写真は保持され、次の写真が追加されます\n${photoEntries(slug, photos)}\n# 場所ピン: ${body.spot === undefined ? '変更しません' : spot ?? '関連づけない'}`;
        return json({ demo: true, path: tripPath(slug), markdown: preview });
      }
      const current = await readText(tripPath(slug));
      if (current === null) throw new Error('撮影会が見つかりません');
      md = appendPhotos(current, slug, photos, body.spot);
      message = photos.length ? `content(trips): add ${photos.length} photos to ${slug}` : `content(trips): set place pin for ${slug}`;
    }
    if (!canPublish()) return json({ demo: true, path: tripPath(slug), markdown: md });

    const files: CommitFile[] = photos.map((p) => {
      const sha = body.blobs?.[p.name];
      if (!sha || sha.startsWith('demo-')) throw new Error(`写真 ${p.name} がアップロードされていません`);
      return { path: photoPath(slug, p.name), sha };
    });
    files.push({ path: tripPath(slug), content: md });
    const c = await commit(`${message}\n\nPublished from the site's admin panel.`, files);
    return json({ ok: true, commit: c.url, page: `/trips/${slug}/` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
};
