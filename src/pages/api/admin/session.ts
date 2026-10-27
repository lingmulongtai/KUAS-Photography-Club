import type { APIRoute } from 'astro';
import { canPublish, isConfigured, isDemo, json, missingSettings, signedIn } from '../../../lib/admin/auth.ts';

export const prerender = false;

/** Whether the visitor is signed in, and whether publishing is switched on. */
export const GET: APIRoute = ({ cookies }) => json({ signedIn: signedIn(cookies), configured: isConfigured(), demo: isDemo(), canPublish: canPublish(), missing: missingSettings() });
