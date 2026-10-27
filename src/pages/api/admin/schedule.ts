import type { APIRoute } from 'astro';
import { canPublish, guard, json, publishingGuard } from '../../../lib/admin/auth.ts';
import { commit } from '../../../lib/admin/github.ts';
import { scheduleMarkdown, schedulePath, type ScheduleIn } from '../../../lib/admin/content.ts';

export const prerender = false;

/** Publish (or replace) one month's schedule; an explicitly enabled local demo returns a preview. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = guard(request, cookies);
  if (denied) return denied;
  const unavailable = publishingGuard();
  if (unavailable) return unavailable;
  try {
    const input = (await request.json()) as ScheduleIn;
    const md = scheduleMarkdown(input);
    if (!canPublish()) return json({ demo: true, path: schedulePath(input.month), markdown: md });
    const c = await commit(`content(schedule): update ${input.month}\n\nPublished from the site's admin panel.`, [{ path: schedulePath(input.month), content: md }]);
    return json({ ok: true, commit: c.url, sha: c.sha, page: '/schedule/' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
};
