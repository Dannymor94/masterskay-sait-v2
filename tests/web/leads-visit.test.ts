import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Эндпоинт POST /api/leads/visit — заявка на визит (запись). Паттерн M1
 * (docs/m1-leads-contract.md §4, m2-contract.md «Формы визита и события»):
 *  (a) валидная заявка → 303 /zapis/spasibo, лид type='visit' создан;
 *  (b) повтор того же idempotency_key → 303, второго лида НЕТ (дедуп);
 *  (c) honeypot company → 303 /zapis/spasibo, лид НЕ создан (тихий успех);
 *  (c2) form_rendered_at < 2с → тихий дроп, лид не создан;
 *  (d) невалид (нет name) → 303 на источник с #zayavka, cookie mst_flash, лид не создан;
 *  (e) кривой idempotency_key → ошибка (flash), лид не создан.
 *
 * Мокаем APIContext: Request с form-data + redirect/cookies.
 * RED→GREEN: до реализации эндпоинта/модулей импорт и вызовы падают.
 */

let tmpDir: string;

function makeContext(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  const request = new Request('http://localhost/api/leads/visit', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const cookieStore: Record<string, { value: string; opts: any }> = {};
  const cookies = {
    set(name: string, value: string, opts: any) {
      cookieStore[name] = { value, opts };
    },
    get(name: string) {
      const c = cookieStore[name];
      return c ? { value: c.value } : undefined;
    },
    delete() {},
  };

  const redirect = (location: string, status = 302) =>
    new Response(null, { status, headers: { Location: location } });

  return { request, redirect, cookies, _cookieStore: cookieStore };
}

async function freshEndpoint() {
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  const mod = await import('../../web/src/pages/api/leads/visit.ts');
  const leads = await import('../../web/src/server/leads.ts');
  return { POST: mod.POST, ...leads };
}

const validForm = (key: string) => ({
  idempotency_key: key,
  form_rendered_at: new Date(Date.now() - 10_000).toISOString(),
  source_page: '/zapis',
  company: '', // honeypot пуст
  name: 'Мария',
  contact: '@maria',
  direction: 'Хатха-йога',
  consent: 'yes',
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-visit-'));
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/leads/visit', () => {
  it('(a) валидная заявка → 303 /zapis/spasibo и лид visit создан', async () => {
    const { POST, listLeads, getLead } = await freshEndpoint();
    const key = randomUUID();
    const res = await POST(makeContext(validForm(key)) as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/zapis/spasibo');

    const leads = listLeads('visit');
    expect(leads).toHaveLength(1);
    expect(leads[0].id).toBe(key);
    const payload = JSON.parse(getLead(key)!.payload);
    expect(payload.direction).toBe('Хатха-йога');
  });

  it('(b) повтор того же idempotency_key → 303, второго лида нет', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const key = randomUUID();
    const r1 = await POST(makeContext(validForm(key)) as any);
    const r2 = await POST(makeContext(validForm(key)) as any);

    expect(r1.status).toBe(303);
    expect(r2.status).toBe(303);
    expect(r2.headers.get('Location')).toBe('/zapis/spasibo');
    expect(listLeads('visit')).toHaveLength(1);
  });

  it('(c) honeypot company заполнен → 303 /zapis/spasibo и лид НЕ создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = { ...validForm(randomUUID()), company: 'Acme Bot' };
    const res = await POST(makeContext(form) as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/zapis/spasibo');
    expect(listLeads('visit')).toHaveLength(0);
  });

  it('(c2) слишком быстрая отправка (<2с) → тихий дроп, лид не создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = { ...validForm(randomUUID()), form_rendered_at: new Date().toISOString() };
    const res = await POST(makeContext(form) as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/zapis/spasibo');
    expect(listLeads('visit')).toHaveLength(0);
  });

  it('(d) невалид (нет name) → 303 на источник #zayavka, cookie mst_flash, лид не создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = { ...validForm(randomUUID()), name: '' };
    const ctx = makeContext(form);
    const res = await POST(ctx as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/zapis#zayavka');
    expect(listLeads('visit')).toHaveLength(0);

    const flash = ctx._cookieStore['mst_flash'];
    expect(flash).toBeTruthy();
    expect(flash.opts.httpOnly).toBe(true);
    expect(flash.opts.maxAge).toBe(300);
    const parsed = JSON.parse(flash.value);
    expect(parsed.errors.name).toBeTruthy();
    expect(parsed.values.contact).toBe('@maria');
  });

  it('(d2) ошибка возвращает на source_page из формы (#zayavka)', async () => {
    const { POST } = await freshEndpoint();
    const form = { ...validForm(randomUUID()), name: '', source_page: '/raspisanie' };
    const res = await POST(makeContext(form) as any);
    expect(res.headers.get('Location')).toBe('/raspisanie#zayavka');
  });

  it('(e) кривой idempotency_key → ошибка (flash), лид не создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = { ...validForm('not-a-uuid') };
    const ctx = makeContext(form);
    const res = await POST(ctx as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/zapis#zayavka');
    expect(listLeads('visit')).toHaveLength(0);
    const flash = ctx._cookieStore['mst_flash'];
    expect(JSON.parse(flash.value).errors.idempotency_key).toBeTruthy();
  });

  it('(f) нет consent → ошибка, лид не создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = { ...validForm(randomUUID()), consent: '' };
    const res = await POST(makeContext(form) as any);
    expect(res.headers.get('Location')).toBe('/zapis#zayavka');
    expect(listLeads('visit')).toHaveLength(0);
  });
});
