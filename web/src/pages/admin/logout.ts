/**
 * POST /admin/logout — выход: удаляет сессионную cookie и редиректит на логин.
 * GET — тоже разлогинивает (на случай прямой ссылки), но форма использует POST.
 */
import type { APIContext } from 'astro';
import { SESSION_COOKIE } from '../../server/auth.ts';

export const prerender = false;

function clear(ctx: APIContext): Response {
  ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
  return ctx.redirect('/admin/login', 303);
}

export const POST = clear;
export const GET = clear;
