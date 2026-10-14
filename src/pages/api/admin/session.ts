import type { APIRoute } from 'astro';
import { canPublish, isDemo, json, signedIn } from '../../../lib/admin/auth';

export const prerender = false;

/** Whether the visitor is signed in, and whether publishing is switched on. */
export const GET: APIRoute = ({ cookies }) => json({ signedIn: signedIn(cookies), demo: isDemo(), canPublish: canPublish() });
