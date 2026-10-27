import type { APIRoute } from 'astro';

// Generated with the static pages, so this reports the deployed build rather than
// a newer GitHub commit that may still be building (or may have failed to build).
export const prerender = true;
export const GET: APIRoute = () => new Response(JSON.stringify({
  commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
}), { headers: { 'content-type': 'application/json; charset=utf-8' } });
