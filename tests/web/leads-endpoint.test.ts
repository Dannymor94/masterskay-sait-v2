import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Эндпоинт POST /api/leads/arenda — поведение строго по контракту (docs/m1-leads-contract.md §4):
 *  (a) валидная заявка → 303 /arenda/spasibo, лид создан;
 *  (b) повтор того же idempotency_key → снова 303, второго лида НЕТ;
 *  (c) honeypot company заполнен → 303 /arenda/spasibo, лид НЕ создан (тихий успех);
 *  (d) невалидная (нет name) → 303 /arenda#zayavka, выставлен cookie mst_flash, лид не создан.
 *
 * Мокаем APIContext: Request с form-data + объекты redirect/cookies.
 * RED→GREEN: до реализации эндпоинта/модулей импорт и вызовы падают.
 */

let tmpDir: string;

function makeContext(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  const request = new Request('http://localhost/api/leads/arenda', {
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

  // redirect как у Astro: возвращает Response с 303 + Location.
  const redirect = (location: string, status = 302) =>
    new Response(null, { status, headers: { Location: location } });

  return { request, redirect, cookies, _cookieStore: cookieStore };
}

async function freshEndpoint() {
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  const mod = await import('../../web/src/pages/api/leads/arenda.ts');
  const leads = await import('../../web/src/server/leads.ts');
  return { POST: mod.POST, ...leads };
}

const validForm = (key: string) => ({
  idempotency_key: key,
  // form_rendered_at достаточно давно, чтобы пройти антиспам (>2с назад):
  form_rendered_at: new Date(Date.now() - 10_000).toISOString(),
  source_page: '/arenda',
  cta_origin: 'hall-big',
  company: '', // honeypot пуст
  name: 'Анна',
  contact: '@anna',
  activity: 'Массаж',
  activity_other: '',
  hall: 'big-70',
  format: 'onetime',
  schedule: '',
  start: '',
  comment: 'привет',
  consent: 'yes',
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-ep-'));
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/leads/arenda', () => {
  it('(a) валидная заявка → 303 /arenda/spasibo и лид создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const key = randomUUID();
    const ctx = makeContext(validForm(key));

    const res = await POST(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/arenda/spasibo');
    expect(listLeads('arenda')).toHaveLength(1);
  });

  it('(b) повтор того же idempotency_key → 303, второго лида нет', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const key = randomUUID();

    const r1 = await POST(makeContext(validForm(key)) as any);
    const r2 = await POST(makeContext(validForm(key)) as any);

    expect(r1.status).toBe(303);
    expect(r2.status).toBe(303);
    expect(r2.headers.get('Location')).toBe('/arenda/spasibo');
    expect(listLeads('arenda')).toHaveLength(1);
  });

  it('(c) honeypot company заполнен → 303 /arenda/spasibo и лид НЕ создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = { ...validForm(randomUUID()), company: 'Acme Bot LLC' };
    const ctx = makeContext(form);

    const res = await POST(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/arenda/spasibo');
    expect(listLeads('arenda')).toHaveLength(0);
  });

  it('(c2) слишком быстрая отправка (form_rendered_at < 2с) → тихий дроп, лид не создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = {
      ...validForm(randomUUID()),
      form_rendered_at: new Date().toISOString(),
    };
    const res = await POST(makeContext(form) as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/arenda/spasibo');
    expect(listLeads('arenda')).toHaveLength(0);
  });

  it('(d) невалидная (нет name) → 303 /arenda#zayavka, cookie mst_flash, лид не создан', async () => {
    const { POST, listLeads } = await freshEndpoint();
    const form = { ...validForm(randomUUID()), name: '' };
    const ctx = makeContext(form);

    const res = await POST(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/arenda#zayavka');
    expect(listLeads('arenda')).toHaveLength(0);

    const flash = ctx._cookieStore['mst_flash'];
    expect(flash).toBeTruthy();
    expect(flash.opts.httpOnly).toBe(true);
    expect(flash.opts.sameSite).toBe('lax');
    expect(flash.opts.path).toBe('/');
    expect(flash.opts.maxAge).toBe(300);

    const parsed = JSON.parse(flash.value);
    expect(parsed.errors.name).toBeTruthy();
    // values репопулируются (кроме чувствительных служебных), name пуст, contact сохранён
    expect(parsed.values.contact).toBe('@anna');
  });
});
