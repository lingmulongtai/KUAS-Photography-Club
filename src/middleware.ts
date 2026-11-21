import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const path = context.url.pathname;
  if (!response.ok || (path !== '/' && path !== '/en/' && path !== '/en')) return response;
  // Astro has emitted the real page with its styles and module scripts before we annotate its text.
  const { bilingualHome } = await import('./lib/home-copy');
  const page = await response.text();
  const html = bilingualHome(page, context.locals.alternateHome!, path === '/' ? 'ja' : 'en');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
});
