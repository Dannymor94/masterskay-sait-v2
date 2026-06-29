export const prerender = false;
import type { APIRoute } from 'astro';
import { getDb } from '../../server/db';
import { logInfo } from '../../server/logger';

export const GET: APIRoute = () => {
  try {
    // Verify DB is accessible
    const db = getDb();
    db.prepare('SELECT 1').get();
    const body = JSON.stringify({ status: 'ok', version: '1.0.0', db: 'ok' });
    logInfo('healthz', 'health check ok');
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const body = JSON.stringify({ status: 'error', db: 'unavailable' });
    return new Response(body, {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
