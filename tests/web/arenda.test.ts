import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';

/**
 * Контракт формы заявки /arenda — проверка РАЗМЕТКИ компонента (T1-2…T1-5).
 *
 * SSR + node-адаптер ⇒ статического dist/arenda/index.html больше нет. Рендерим
 * компонент ArendaForm.astro в строку через Astro Container API с теми же
 * пропсами, что проставляет /arenda.astro (idempotency_key, form_rendered_at),
 * и проверяем инварианты «формы без JS»: нативный POST, служебные поля (включая
 * непустой UUID idempotency_key), honeypot вне табордера/aria-hidden, согласие +
 * ссылка /privacy, label[for] у видимых полей, отсутствие инлайн on*-обработчиков.
 *
 * h1 (ровно один на странице) проверяется на уровне всей страницы — это зона qa
 * (поднять сервер и fetch /arenda); здесь мы валидируем сам блок формы.
 */

const ArendaForm = fileURLToPath(
  new URL('../../web/src/components/ArendaForm.astro', import.meta.url),
);

const UUID = '11111111-2222-4333-8444-555555555555';
const RENDERED_AT = '2026-06-29T10:00:00.000Z';

let html = '';

beforeAll(async () => {
  const container = await AstroContainer.create();
  const { default: Component } = await import(ArendaForm);
  html = await container.renderToString(Component, {
    props: {
      idempotencyKey: UUID,
      formRenderedAt: RENDERED_AT,
      ctaOrigin: '',
      preselectHall: '',
      values: {},
      errors: {},
    },
  });
}, 30_000);

describe('Контракт формы заявки /arenda — без JS', () => {
  it('есть <form> с method=post и action=/api/leads/arenda', () => {
    const form = html.match(/<form\b[^>]*>/i);
    expect(form, 'на странице должна быть форма').not.toBeNull();
    const tag = form![0];
    expect(tag).toMatch(/\bmethod\s*=\s*"post"/i);
    expect(tag).toMatch(/\baction\s*=\s*"\/api\/leads\/arenda"/i);
  });

  it('форма шлёт x-www-form-urlencoded (без enctype-сюрпризов вроде multipart)', () => {
    const form = html.match(/<form\b[^>]*>/i)!;
    // либо enctype отсутствует (дефолт = urlencoded), либо явно urlencoded
    if (/\benctype\s*=/.test(form[0])) {
      expect(form[0]).toMatch(/enctype\s*=\s*"application\/x-www-form-urlencoded"/i);
    } else {
      expect(form[0]).not.toMatch(/multipart\/form-data/i);
    }
  });

  it('idempotency_key — скрытое поле с НЕПУСТЫМ UUID (генерится при рендере)', () => {
    const field = html.match(/<input\b[^>]*\bname="idempotency_key"[^>]*>/i);
    expect(field, 'нужно скрытое поле idempotency_key').not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    const value = field![0].match(/\bvalue="([^"]*)"/i)?.[1] ?? '';
    expect(value).not.toBe('');
    expect(value).toBe(UUID);
    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('form_rendered_at — скрытое поле с непустым значением, отдельное от ключа', () => {
    const field = html.match(/<input\b[^>]*\bname="form_rendered_at"[^>]*>/i);
    expect(field, 'нужно скрытое поле form_rendered_at (антиспам)').not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    expect(field![0]).not.toMatch(/\bname="idempotency_key"/i);
    const value = field![0].match(/\bvalue="([^"]*)"/i)?.[1] ?? '';
    expect(value).toBe(RENDERED_AT);
  });

  it('source_page=/arenda (hidden)', () => {
    const field = html.match(/<input\b[^>]*\bname="source_page"[^>]*>/i);
    expect(field, 'нужно скрытое поле source_page').not.toBeNull();
    expect(field![0]).toMatch(/\btype="hidden"/i);
    expect(field![0]).toMatch(/\bvalue="\/arenda"/i);
  });

  it('honeypot — отдельное поле в aria-hidden-обёртке, вне табордера, не служебное', () => {
    const hpWrap = html.match(/<div\b[^>]*class="apply__hp"[^>]*>/i);
    expect(hpWrap, 'honeypot-обёртка должна существовать').not.toBeNull();
    expect(hpWrap![0]).toMatch(/\baria-hidden="true"/i);
    const hp = html.match(/<input\b[^>]*\bid="company"[^>]*>/i);
    expect(hp, 'honeypot-поле (ловушка) должно существовать').not.toBeNull();
    expect(hp![0]).toMatch(/\btabindex="-1"/i);
    expect(hp![0]).not.toMatch(/\bname="idempotency_key"/i);
    expect(hp![0]).not.toMatch(/\bname="form_rendered_at"/i);
  });

  it('чекбокс согласия (type=checkbox, required) и ссылка на /privacy', () => {
    const consent = html.match(/<input\b[^>]*\bname="consent"[^>]*>/i);
    expect(consent, 'нужен чекбокс согласия').not.toBeNull();
    expect(consent![0]).toMatch(/\btype="checkbox"/i);
    expect(consent![0]).toMatch(/\brequired\b/i);
    expect(html).toMatch(/href="\/privacy"/i);
  });

  it('у ключевых видимых полей есть <label for>; label ≥ числа обязательных полей', () => {
    for (const id of ['name', 'contact', 'activity']) {
      const re = new RegExp(`<label\\b[^>]*\\bfor="${id}"`, 'i');
      expect(re.test(html), `нет <label for="${id}">`).toBe(true);
    }
    const labelFor = html.match(/<label\b[^>]*\bfor="[^"]+"/gi) || [];
    const requiredInputs =
      html.match(/<(input|select|textarea)\b[^>]*\brequired\b[^>]*>/gi) || [];
    expect(requiredInputs.length).toBeGreaterThan(0);
    expect(labelFor.length).toBeGreaterThanOrEqual(requiredInputs.length);
  });

  it('нет инлайн-обработчиков (on*) в разметке формы — не зависит от JS', () => {
    const onAttrs = html.match(/\son[a-z]+\s*=/gi) || [];
    expect(onAttrs).toEqual([]);
  });
});

describe('Репопуляция и ошибки из flash-cookie', () => {
  it('восстанавливает значения и показывает ошибки у полей + сводку', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaForm);
    const out = await container.renderToString(Component, {
      props: {
        idempotencyKey: UUID,
        formRenderedAt: RENDERED_AT,
        values: { name: 'Анна', contact: '', activity: 'Другое' },
        errors: {
          contact: 'Укажите телефон или мессенджер для связи.',
          activity_other: 'Коротко напишите, чем вы занимаетесь.',
        },
      },
    });
    // значение name восстановлено
    const nameField = out.match(/<input\b[^>]*\bname="name"[^>]*>/i)![0];
    expect(nameField).toMatch(/\bvalue="Анна"/);
    // ошибка contact показана и связана через aria-describedby
    expect(out).toMatch(/Укажите телефон или мессенджер для связи\./);
    const contactField = out.match(/<input\b[^>]*\bname="contact"[^>]*>/i)![0];
    expect(contactField).toMatch(/aria-describedby="[^"]*err-contact[^"]*"/i);
    expect(contactField).toMatch(/aria-invalid="true"/i);
    // сводка ошибок вверху со ссылкой-якорем на поле
    expect(out).toMatch(/role="alert"/i);
    expect(out).toMatch(/href="#contact"/i);
  });

  it('предвыбор зала из preselectHall (серверно, без JS)', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaForm);
    const out = await container.renderToString(Component, {
      props: {
        idempotencyKey: UUID,
        formRenderedAt: RENDERED_AT,
        preselectHall: 'big-70',
      },
    });
    const bigRadio = out.match(/<input\b[^>]*\bvalue="big-70"[^>]*>/i)![0];
    expect(bigRadio).toMatch(/\bchecked\b/i);
  });
});
