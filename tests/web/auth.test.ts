import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Авторизация админки (одна роль). Механизм агента, секрет — человека.
 *  - верный пароль проходит, неверный — нет (scrypt);
 *  - сессионная cookie подписана и проверяется; подделка/просрочка отвергаются;
 *  - без env (хэш/секрет) → isAuthConfigured()=false (gate отдаст 503, не 500).
 * RED→GREEN: до реализации auth.ts падают.
 */

const ENV_KEYS = ['ADMIN_USER', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'];
let saved: Record<string, string | undefined>;

async function fresh() {
  vi.resetModules();
  return import('../../web/src/server/auth.ts');
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('пароль (scrypt)', () => {
  it('hashPassword → verifyPassword: верный проходит, неверный нет', async () => {
    const auth = await fresh();
    const hash = auth.hashPassword('s3cret-pass');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(auth.verifyPassword('s3cret-pass', hash)).toBe(true);
    expect(auth.verifyPassword('wrong', hash)).toBe(false);
  });

  it('checkCredentials против env (user+hash+secret)', async () => {
    let auth = await fresh();
    const hash = auth.hashPassword('pw');
    process.env.ADMIN_USER = 'anton';
    process.env.ADMIN_PASSWORD_HASH = hash;
    process.env.SESSION_SECRET = 'long-random-secret';
    auth = await fresh();

    expect(auth.checkCredentials('anton', 'pw')).toBe(true);
    expect(auth.checkCredentials('anton', 'nope')).toBe(false);
    expect(auth.checkCredentials('someone', 'pw')).toBe(false);
  });
});

describe('сессионная cookie (подпись)', () => {
  it('issueSession → verifySession: валидная проходит, подделка/чужой секрет — нет', async () => {
    process.env.SESSION_SECRET = 'secret-A';
    let auth = await fresh();
    const cookie = auth.issueSession('anton');
    expect(verifyRoundtrip(auth, cookie)).toBe('anton');

    // подделка подписи
    expect(auth.verifySession(cookie.slice(0, -2) + 'xx')).toBeNull();

    // другой секрет → не проходит
    process.env.SESSION_SECRET = 'secret-B';
    auth = await fresh();
    expect(auth.verifySession(cookie)).toBeNull();
  });

  function verifyRoundtrip(auth: any, cookie: string): string | null {
    const r = auth.verifySession(cookie);
    return r ? r.u : null;
  }
});

describe('lead status (админка)', () => {
  it('валидный статус обновляется, невалидный — отвергается', async () => {
    // отдельная временная БД для лидов
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'mst-leadstatus-'));
    process.env.DATABASE_URL = `file:${join(dir, 't.db')}`;
    vi.resetModules();
    const leads = await import('../../web/src/server/leads.ts');
    const key = randomUUID();
    leads.insertArendaLead({
      idempotency_key: key, name: 'A', contact: 'c', activity: 'Массаж',
      format: 'onetime', consent: 'yes',
    } as any);

    expect(leads.updateLeadStatus(key, 'in_progress')).toBe(true);
    expect(leads.getLead(key)!.status).toBe('in_progress');
    expect(leads.updateLeadStatus(key, 'bogus')).toBe(false);
    expect(leads.getLead(key)!.status).toBe('in_progress');

    delete process.env.DATABASE_URL;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('без env — gate не падает', () => {
  it('isAuthConfigured()=false когда нет хэша/секрета', async () => {
    const auth = await fresh();
    expect(auth.isAuthConfigured()).toBe(false);
    // checkCredentials безопасно false без конфигурации
    expect(auth.checkCredentials('admin', 'whatever')).toBe(false);
  });

  it('isAuthConfigured()=true когда есть и хэш, и секрет', async () => {
    let auth = await fresh();
    process.env.ADMIN_PASSWORD_HASH = auth.hashPassword('pw');
    process.env.SESSION_SECRET = 'sek';
    auth = await fresh();
    expect(auth.isAuthConfigured()).toBe(true);
  });
});
