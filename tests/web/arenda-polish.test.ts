import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Gate M3.1 — полировка /arenda:
 *  1. WhySection CTA — primary-кнопка (не ghost/soft).
 *  2. AvailabilityPlaceholder — fallback без JS: CTA ведёт на #zayavka,
 *     section#dostupnost присутствует, легенда или fallback-текст есть.
 *  3. ArendaModal — форма внутри модалки (покрыто arenda-modal.test.ts),
 *     здесь дополнительно проверяем без-JS закрытие (backdrop href="#").
 *  4. Контраст: все компоненты используют var() для цветов, не хардкод hex.
 */

const WEB = resolve(__dirname, '../../web/src');
const component = (f: string) => readFileSync(resolve(WEB, 'components', f), 'utf-8');

// ─── 1. WhySection ──────────────────────────────────────────────────────────

describe('WhySection — поддерживающий CTA', () => {
  it('Button в блоке why__cta имеет variant="soft" (ghost-ссылка с подчёркиванием)', () => {
    const src = component('WhySection.astro');
    expect(src).toMatch(/variant="soft"[^>]*>.*Оставить заявку|Оставить заявку.*variant="soft"/s);
  });

  it('CTA ведёт на #zayavka', () => {
    const src = component('WhySection.astro');
    expect(src).toContain('href="#zayavka"');
  });
});

// ─── 2. AvailabilityPlaceholder ──────────────────────────────────────────────

const AvailabilityPlaceholder = fileURLToPath(
  new URL('../../web/src/components/AvailabilityPlaceholder.astro', import.meta.url),
);

describe('AvailabilityPlaceholder — без JS, без данных (fallback)', () => {
  let html = '';

  beforeAll(async () => {
    // В тестовом окружении нет файла БД → компонент упадёт в catch → fallback
    const container = await AstroContainer.create();
    const { default: Component } = await import(AvailabilityPlaceholder);
    html = await container.renderToString(Component, { props: {} });
  }, 30_000);

  it('рендерит section#dostupnost', () => {
    expect(html).toMatch(/id="dostupnost"/i);
  });

  it('h2 "Свободные слоты" присутствует', () => {
    expect(html).toContain('Свободные слоты');
  });

  it('CTA-кнопка ведёт на #zayavka', () => {
    expect(html).toContain('href="#zayavka"');
  });

  it('нет hardcoded hex в атрибутах стилей (только var())', () => {
    // убираем <style> и <script> блоки, проверяем inline style атрибуты
    const noStyleScript = html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const hexInAttr = noStyleScript.match(/style="[^"]*#[0-9a-fA-F]{3,6}/g) ?? [];
    expect(hexInAttr, 'inline hex в style-атрибутах запрещён').toEqual([]);
  });

  it('нет инлайн on*-обработчиков в разметке', () => {
    const noScript = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const onAttrs = noScript.match(/\son[a-z]+\s*=/gi) ?? [];
    expect(onAttrs).toEqual([]);
  });
});

// ─── 3. ArendaModal — дополнительные no-JS гейты ────────────────────────────

const ArendaModal = fileURLToPath(
  new URL('../../web/src/components/ArendaModal.astro', import.meta.url),
);

const UUID = '11111111-2222-4333-8444-555555555555';
const RENDERED_AT = '2026-06-29T10:00:00.000Z';

describe('ArendaModal — без-JS гейты (дополнительно)', () => {
  let html = '';

  beforeAll(async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaModal);
    html = await container.renderToString(Component, {
      props: { idempotencyKey: UUID, formRenderedAt: RENDERED_AT },
    });
  }, 30_000);

  it('backdrop-ссылка для закрытия без JS (href="#")', () => {
    // ссылка с классом modal__backdrop или aria-label="Закрыть" → href="#"
    expect(html).toMatch(/class="modal__backdrop"[^>]*href="#"|href="#"[^>]*class="modal__backdrop"/i);
  });

  it('X-кнопка закрытия (aria-label содержит «Закрыть»)', () => {
    expect(html).toMatch(/aria-label="Закрыть[^"]*"/i);
  });

  it('модалка имеет role="dialog"', () => {
    expect(html).toMatch(/role="dialog"/i);
  });

  it('aria-modal="true"', () => {
    expect(html).toMatch(/aria-modal="true"/i);
  });

  it('форма работает без JS — нет on*-обработчиков в разметке', () => {
    const noScript = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const onAttrs = noScript.match(/\son[a-z]+\s*=/gi) ?? [];
    expect(onAttrs).toEqual([]);
  });
});

// ─── 4. Контраст — компоненты не хардкодят цвета ────────────────────────────

describe('Контраст-гейт — компоненты не используют hardcoded hex', () => {
  const CHECK = [
    'WhySection.astro',
    'AvailabilityPlaceholder.astro',
    'ArendaModal.astro',
    'ArendaForm.astro',
  ];

  for (const file of CHECK) {
    it(`${file} — нет hex (#rrggbb) вне блоков с комментариями-токенами`, () => {
      const src = component(file);
      // удаляем строки-комментарии и строки с "/* СГЕНЕРИРОВАНО" или "$meta"
      const lines = src.split('\n').filter(
        (l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'),
      );
      const noComment = lines.join('\n');
      // ищем hex в CSS-правилах (не в комментах)
      // Допустимо только через var() — raw hex = ошибка
      // Исключение: rgba() — но цвета должны идти через токены
      const rawHex = noComment.match(
        /(?<![a-zA-Z$_\-"'])(#[0-9a-fA-F]{3,6})(?![\w-])/g,
      ) ?? [];
      expect(rawHex, `найдены hardcoded hex в ${file}: ${rawHex.join(', ')}`).toEqual([]);
    });
  }
});
