import type { APIRoute } from 'astro';
import { canPublish, guard, json } from '../../../lib/admin/auth';
import { commit } from '../../../lib/admin/github';
import { scheduleMarkdown, schedulePath, type ScheduleIn } from '../../../lib/admin/content';

export const prerender = false;

/** Publish (or replace) one month's schedule. In demo mode it returns the Markdown instead. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = guard(request, cookies);
  if (denied) return denied;
  try {
    const input = (await request.json()) as ScheduleIn;
    const md = scheduleMarkdown(input);
    if (!canPublish()) return json({ demo: true, path: schedulePath(input.month), markdown: md });
    const c = await commit(`content(schedule): update ${input.month}\n\nPublished from the site's admin panel.`, [{ path: schedulePath(input.month), content: md }]);
    return json({ ok: true, commit: c.url, page: '/schedule/' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
};
