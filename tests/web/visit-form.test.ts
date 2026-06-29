import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';

/**
 * Контракт формы визита (T2-4) — разметка VisitForm.astro «без JS».
 *
 * Рендерим компонент через Astro Container API с теми же пропсами, что проставляет
 * /zapis.astro (idempotency_key, form_rendered_at). Проверяем инварианты форм M1:
 * нативный POST /api/leads/visit, служебные скрытые поля (непустой UUID), honeypot
 * вне табордера/aria-hidden, согласие + ссылка /privacy, label[for], нет инлайн on*.
 */

const VisitForm = fileURLToPath(
  new URL('../../web/src/components/VisitForm.astro', import.meta.url),
);

const UUID = '11111111-2222-4333-8444-555555555555';
const RENDERED_AT = '2026-06-29T10:00:00.000Z';

let html = '';

beforeAll(async () => {
  const container = await AstroContainer.create();
  const { default: Component } = await import(VisitForm);
  html = await container.renderToString(Component, {
    props: {
      idempotencyKey: UUID,
      formRenderedAt: RENDERED_AT,
      preselectDirection: '',
      values: {},
      errors: {},
    },
  });
}, 30_000);

describe('Контракт формы визита /zapis — без JS', () => {
  it('есть <form> с method=post и action=/api/leads/visit', () => {
    const form = html.match(/<form\b[^>]*>/i);
    expect(form, 'на странице должна быть форма').not.toBeNull();
    const tag = form![0];
    expect(tag).toMatch(/\bmethod\s*=\s*"post"/i);
    expect(tag).toMatch(/\baction\s*=\s*"\/api\/leads\/visit"/i);
  });

  it('форма шлёт x-www-form-urlencoded (без multipart)', () => {
    const form = html.match(/<form\b[^>]*>/i)![0];
    if (/\benctype\s*=/.test(form)) {
      expect(form).toMatch(/enctype\s*=\s*"application\/x-www-form-urlencoded"/i);
    } else {
      expect(form).not.toMatch(/multipart\/form-data/i);
    }
  });

  it('idempotency_key — скрытое поле с НЕПУСТЫМ UUID', () => {
    const field = html.match(/<input\b[^>]*\bname="idempotency_key"[^>]*>/i);
    expect(field, 'нужно скрытое поле idempotency_key').not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    const value = field![0].match(/\bvalue="([^"]*)"/i)?.[1] ?? '';
    expect(value).toBe(UUID);
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('form_rendered_at — скрытое поле, отдельное от ключа', () => {
    const field = html.match(/<input\b[^>]*\bname="form_rendered_at"[^>]*>/i);
    expect(field).not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    expect(field![0]).not.toMatch(/\bname="idempotency_key"/i);
    expect(field![0].match(/\bvalue="([^"]*)"/i)?.[1]).toBe(RENDERED_AT);
  });

  it('source_page=/zapis (hidden)', () => {
    const field = html.match(/<input\b[^>]*\bname="source_page"[^>]*>/i);
    expect(field).not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    expect(field![0]).toMatch(/\bvalue="\/zapis"/i);
  });

  it('honeypot company — aria-hidden-обёртка, вне табордера, не служебное', () => {
    const hpWrap = html.match(/<div\b[^>]*class="[^"]*apply__hp[^"]*"[^>]*>/i);
    expect(hpWrap, 'honeypot-обёртка должна существовать').not.toBeNull();
    expect(hpWrap![0]).toMatch(/\baria-hidden="true"/i);
    const hp = html.match(/<input\b[^>]*\bid="company"[^>]*>/i);
    expect(hp, 'honeypot-поле должно существовать').not.toBeNull();
    expect(hp![0]).toMatch(/\btabindex="-1"/i);
    expect(hp![0]).toMatch(/\bname="company"/i);
  });

  it('поле direction присутствует', () => {
    const field = html.match(/\bname="direction"/i);
    expect(field, 'нужно поле направления').not.toBeNull();
  });

  it('чекбокс согласия (type=checkbox, required) и ссылка на /privacy', () => {
    const consent = html.match(/<input\b[^>]*\bname="consent"[^>]*>/i);
    expect(consent).not.toBeNull();
    expect(consent![0]).toMatch(/\btype="checkbox"/i);
    expect(consent![0]).toMatch(/\brequired\b/i);
    expect(html).toMatch(/href="\/privacy"/i);
  });

  it('у ключевых видимых полей есть <label for>', () => {
    for (const id of ['name', 'contact']) {
      const re = new RegExp(`<label\\b[^>]*\\bfor="${id}"`, 'i');
      expect(re.test(html), `нет <label for="${id}">`).toBe(true);
    }
  });

  it('нет инлайн-обработчиков (on*) в разметке', () => {
    const onAttrs = html.match(/\son[a-z]+\s*=/gi) || [];
    expect(onAttrs).toEqual([]);
  });
});

describe('VisitForm — репопуляция и предзаполнение', () => {
  it('восстанавливает значения и показывает ошибки + сводку', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(VisitForm);
    const out = await container.renderToString(Component, {
      props: {
        idempotencyKey: UUID,
        formRenderedAt: RENDERED_AT,
        values: { name: 'Анна', contact: '' },
        errors: { contact: 'Укажите телефон или мессенджер для связи.' },
      },
    });
    const nameField = out.match(/<input\b[^>]*\bname="name"[^>]*>/i)![0];
    expect(nameField).toMatch(/\bvalue="Анна"/);
    expect(out).toMatch(/Укажите телефон или мессенджер для связи\./);
    const contactField = out.match(/<input\b[^>]*\bname="contact"[^>]*>/i)![0];
    expect(contactField).toMatch(/aria-invalid="true"/i);
    expect(out).toMatch(/role="alert"/i);
  });

  it('предзаполняет направление из preselectDirection', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(VisitForm);
    const out = await container.renderToString(Component, {
      props: {
        idempotencyKey: UUID,
        formRenderedAt: RENDERED_AT,
        preselectDirection: 'Хатха-йога',
      },
    });
    expect(out).toMatch(/Хатха-йога/);
  });
});

// T-master-5: чекбокс «Интересует абонемент»
describe('VisitForm — чекбокс subscription_interest (T-master-5)', () => {
  it('чекбокс name="subscription_interest" value="yes" присутствует в форме', () => {
    const field = html.match(/<input\b[^>]*\bname="subscription_interest"[^>]*>/i);
    expect(field, 'чекбокс subscription_interest должен быть в форме').not.toBeNull();
    expect(field![0]).toMatch(/\btype="checkbox"/i);
    expect(field![0]).toMatch(/\bvalue="yes"/i);
  });

  it('чекбокс subscription_interest НЕ является обязательным', () => {
    const field = html.match(/<input\b[^>]*\bname="subscription_interest"[^>]*>/i);
    expect(field).not.toBeNull();
    expect(field![0]).not.toMatch(/\brequired\b/i);
  });

  it('чекбокс subscription_interest имеет видимую метку с текстом про абонемент', () => {
    expect(html).toMatch(/абонемент/i);
  });
});
