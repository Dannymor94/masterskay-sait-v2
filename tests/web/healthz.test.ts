import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * GET /api/healthz — health check endpoint.
 * Verifies: 200 status, body contains status:'ok', version, and db:'ok'.
 */

let tmpDir: string;

async function freshEndpoint() {
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  const mod = await import('../../web/src/pages/api/healthz.ts');
  return { GET: mod.GET };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-healthz-'));
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/healthz', () => {
  it('returns 200 with status: ok', async () => {
    const { GET } = await freshEndpoint();
    const res = await GET({} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('body contains version field', async () => {
    const { GET } = await freshEndpoint();
    const res = await GET({} as any);
    const body = await res.json();
    expect(body.version).toBeTruthy();
  });

  it('body contains db: ok', async () => {
    const { GET } = await freshEndpoint();
    const res = await GET({} as any);
    const body = await res.json();
    expect(body.db).toBe('ok');
  });
});
