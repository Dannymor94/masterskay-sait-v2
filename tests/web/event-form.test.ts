import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';

/**
 * Контракт формы регистрации на событие (T2-4) — разметка EventForm.astro «без JS».
 *
 * Нативный POST /api/leads/event; hidden event_id; count (number ≥1); служебные поля
 * (непустой UUID), honeypot, consent + /privacy, label[for], нет инлайн on*.
 */

const EventForm = fileURLToPath(
  new URL('../../web/src/components/EventForm.astro', import.meta.url),
);

const UUID = '11111111-2222-4333-8444-555555555555';
const RENDERED_AT = '2026-06-29T10:00:00.000Z';

let html = '';

beforeAll(async () => {
  const container = await AstroContainer.create();
  const { default: Component } = await import(EventForm);
  html = await container.renderToString(Component, {
    props: {
      idempotencyKey: UUID,
      formRenderedAt: RENDERED_AT,
      eventId: 'evt-123',
      eventSlug: 'demo',
      seatsLeft: 5,
      values: {},
      errors: {},
    },
  });
}, 30_000);

describe('Контракт формы события — без JS', () => {
  it('есть <form> с method=post и action=/api/leads/event', () => {
    const form = html.match(/<form\b[^>]*>/i);
    expect(form).not.toBeNull();
    const tag = form![0];
    expect(tag).toMatch(/\bmethod\s*=\s*"post"/i);
    expect(tag).toMatch(/\baction\s*=\s*"\/api\/leads\/event"/i);
  });

  it('event_id — скрытое поле с непустым значением', () => {
    const field = html.match(/<input\b[^>]*\bname="event_id"[^>]*>/i);
    expect(field, 'нужно скрытое поле event_id').not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    expect(field![0].match(/\bvalue="([^"]*)"/i)?.[1]).toBe('evt-123');
  });

  it('idempotency_key — скрытое поле с НЕПУСТЫМ UUID', () => {
    const field = html.match(/<input\b[^>]*\bname="idempotency_key"[^>]*>/i);
    expect(field).not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    const value = field![0].match(/\bvalue="([^"]*)"/i)?.[1] ?? '';
    expect(value).toBe(UUID);
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('form_rendered_at — скрытое поле', () => {
    const field = html.match(/<input\b[^>]*\bname="form_rendered_at"[^>]*>/i);
    expect(field).not.toBeNull();
    expect(field![0].match(/\bvalue="([^"]*)"/i)?.[1]).toBe(RENDERED_AT);
  });

  it('count — number ≥1, с max = оставшиеся места', () => {
    const field = html.match(/<input\b[^>]*\bname="count"[^>]*>/i);
    expect(field, 'нужно поле count').not.toBeNull();
    expect(field![0]).toMatch(/\btype="number"/i);
    expect(field![0]).toMatch(/\bmin="1"/i);
    expect(field![0]).toMatch(/\bmax="5"/i);
  });

  it('honeypot company — aria-hidden, вне табордера', () => {
    const hpWrap = html.match(/<div\b[^>]*class="[^"]*apply__hp[^"]*"[^>]*>/i);
    expect(hpWrap).not.toBeNull();
    expect(hpWrap![0]).toMatch(/\baria-hidden="true"/i);
    const hp = html.match(/<input\b[^>]*\bid="company"[^>]*>/i);
    expect(hp).not.toBeNull();
    expect(hp![0]).toMatch(/\btabindex="-1"/i);
  });

  it('чекбокс согласия (required) и ссылка /privacy', () => {
    const consent = html.match(/<input\b[^>]*\bname="consent"[^>]*>/i);
    expect(consent).not.toBeNull();
    expect(consent![0]).toMatch(/\btype="checkbox"/i);
    expect(consent![0]).toMatch(/\brequired\b/i);
    expect(html).toMatch(/href="\/privacy"/i);
  });

  it('у ключевых видимых полей есть <label for>', () => {
    for (const id of ['name', 'contact', 'count']) {
      const re = new RegExp(`<label\\b[^>]*\\bfor="${id}"`, 'i');
      expect(re.test(html), `нет <label for="${id}">`).toBe(true);
    }
  });

  it('нет инлайн-обработчиков (on*)', () => {
    const onAttrs = html.match(/\son[a-z]+\s*=/gi) || [];
    expect(onAttrs).toEqual([]);
  });
});

describe('EventForm — нет свободных мест', () => {
  it('при seatsLeft=0 форма скрыта/задизейблена с честным текстом', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(EventForm);
    const out = await container.renderToString(Component, {
      props: {
        idempotencyKey: UUID,
        formRenderedAt: RENDERED_AT,
        eventId: 'evt-123',
        eventSlug: 'demo',
        seatsLeft: 0,
      },
    });
    // Нет кнопки отправки заявки / нет активной формы регистрации.
    expect(out).not.toMatch(/<button\b[^>]*type="submit"/i);
    expect(out).toMatch(/мест/i);
  });
});
