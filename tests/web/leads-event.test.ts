import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Эндпоинт POST /api/leads/event — регистрация на событие. Паттерн M1 +
 * атомарный учёт мест (m2-contract.md «Формы визита и события», registerSeats):
 *  (a) валидная регистрация → 303 /sobytiya/<slug>/spasibo, лид type='event',
 *      registered_count наращён на count;
 *  (b) повтор того же idempotency_key → 303, второго лида НЕТ и registered_count
 *      НЕ наращён повторно (инкремент привязан к успешной вставке лида);
 *  (c) honeypot → тихий успех, лид не создан, count не тронут;
 *  (d) переполнение capacity → flash-ошибка «мест не осталось», лид не создан,
 *      count не изменён;
 *  (e) невалид (нет name / count<1) → flash, лид не создан;
 *  (f) несуществующее событие → flash, лид не создан.
 *
 * RED→GREEN: до реализации эндпоинта/insertEventLead импорт и вызовы падают.
 */

let tmpDir: string;

function makeContext(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  const request = new Request('http://localhost/api/leads/event', {
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

async function freshEnv() {
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  const mod = await import('../../web/src/pages/api/leads/event.ts');
  const leads = await import('../../web/src/server/leads.ts');
  const events = await import('../../web/src/server/events.ts');
  return { POST: mod.POST, ...leads, ...events };
}

const EVENT_ID = 'ev-1';
const EVENT_SLUG = 'osennij-retrit';

function seedEvent(createEvent: any, capacity: number | null) {
  createEvent({
    id: EVENT_ID,
    slug: EVENT_SLUG,
    title: 'Осенний ретрит',
    datetime: '2026-10-10T10:00:00.000Z',
    capacity,
    is_published: 1,
  });
}

const validForm = (key: string, count = '1') => ({
  idempotency_key: key,
  form_rendered_at: new Date(Date.now() - 10_000).toISOString(),
  source_page: `/sobytiya/${EVENT_SLUG}`,
  company: '',
  name: 'Игорь',
  contact: '+79990001122',
  event_id: EVENT_ID,
  count,
  consent: 'yes',
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-event-'));
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/leads/event', () => {
  it('(a) валидная регистрация → 303 spasibo, лид создан, registered_count наращён', async () => {
    const env = await freshEnv();
    seedEvent(env.createEvent, 10);
    const key = randomUUID();
    const res = await env.POST(makeContext(validForm(key, '2')) as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/sobytiya/${EVENT_SLUG}/spasibo`);
    expect(env.listLeads('event')).toHaveLength(1);
    expect(env.getEvent(EVENT_ID)!.registered_count).toBe(2);
    const payload = JSON.parse(env.getLead(key)!.payload);
    expect(payload.event_id).toBe(EVENT_ID);
    expect(payload.count).toBe(2);
  });

  it('(b) повтор того же ключа → 303, второго лида нет, count НЕ наращён повторно', async () => {
    const env = await freshEnv();
    seedEvent(env.createEvent, 10);
    const key = randomUUID();
    await env.POST(makeContext(validForm(key, '2')) as any);
    const r2 = await env.POST(makeContext(validForm(key, '2')) as any);

    expect(r2.status).toBe(303);
    expect(r2.headers.get('Location')).toBe(`/sobytiya/${EVENT_SLUG}/spasibo`);
    expect(env.listLeads('event')).toHaveLength(1);
    expect(env.getEvent(EVENT_ID)!.registered_count).toBe(2); // не 4
  });

  it('(c) honeypot → тихий успех, лид не создан, count не тронут', async () => {
    const env = await freshEnv();
    seedEvent(env.createEvent, 10);
    const form = { ...validForm(randomUUID(), '2'), company: 'bot' };
    const res = await env.POST(makeContext(form) as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/sobytiya/${EVENT_SLUG}/spasibo`);
    expect(env.listLeads('event')).toHaveLength(0);
    expect(env.getEvent(EVENT_ID)!.registered_count).toBe(0);
  });

  it('(d) переполнение capacity → flash «мест не осталось», лид не создан, count неизменен', async () => {
    const env = await freshEnv();
    seedEvent(env.createEvent, 3);
    // первая регистрация на 2 места проходит
    await env.POST(makeContext(validForm(randomUUID(), '2')) as any);
    expect(env.getEvent(EVENT_ID)!.registered_count).toBe(2);

    // вторая на 2 места — превышает capacity (2+2>3) → отказ
    const ctx = makeContext(validForm(randomUUID(), '2'));
    const res = await env.POST(ctx as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/sobytiya/${EVENT_SLUG}#zayavka`);
    expect(env.listLeads('event')).toHaveLength(1); // только первая
    expect(env.getEvent(EVENT_ID)!.registered_count).toBe(2); // не 4
    const flash = ctx._cookieStore['mst_flash'];
    expect(flash).toBeTruthy();
    expect(JSON.parse(flash.value).errors.count).toBeTruthy();
  });

  it('(e) невалид (нет name) → flash, лид не создан, count неизменен', async () => {
    const env = await freshEnv();
    seedEvent(env.createEvent, 10);
    const form = { ...validForm(randomUUID(), '1'), name: '' };
    const ctx = makeContext(form);
    const res = await env.POST(ctx as any);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/sobytiya/${EVENT_SLUG}#zayavka`);
    expect(env.listLeads('event')).toHaveLength(0);
    expect(env.getEvent(EVENT_ID)!.registered_count).toBe(0);
    expect(ctx._cookieStore['mst_flash']).toBeTruthy();
  });

  it('(e2) count < 1 → flash count, лид не создан', async () => {
    const env = await freshEnv();
    seedEvent(env.createEvent, 10);
    const ctx = makeContext(validForm(randomUUID(), '0'));
    const res = await env.POST(ctx as any);
    expect(res.headers.get('Location')).toBe(`/sobytiya/${EVENT_SLUG}#zayavka`);
    expect(env.listLeads('event')).toHaveLength(0);
    expect(JSON.parse(ctx._cookieStore['mst_flash'].value).errors.count).toBeTruthy();
  });

  it('(f) несуществующее событие → flash, лид не создан', async () => {
    const env = await freshEnv();
    // событие не сидим
    const form = { ...validForm(randomUUID(), '1') };
    const ctx = makeContext(form);
    const res = await env.POST(ctx as any);

    expect(res.status).toBe(303);
    expect(env.listLeads('event')).toHaveLength(0);
    expect(ctx._cookieStore['mst_flash']).toBeTruthy();
    expect(JSON.parse(ctx._cookieStore['mst_flash'].value).errors.event_id).toBeTruthy();
  });

  it('(g) capacity=null (без лимита) → регистрация всегда проходит', async () => {
    const env = await freshEnv();
    seedEvent(env.createEvent, null);
    await env.POST(makeContext(validForm(randomUUID(), '50')) as any);
    expect(env.getEvent(EVENT_ID)!.registered_count).toBe(50);
  });
});
