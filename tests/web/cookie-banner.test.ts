import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';

/**
 * CookieBanner.astro — проверка разметки компонента согласия на куки (T3-3).
 *
 * Баннер скрыт по умолчанию (display:none в CSS), показывается только через JS.
 * Без JS остаётся скрытым — правильное поведение по 152-ФЗ.
 */

const CookieBannerPath = fileURLToPath(
  new URL('../../web/src/components/CookieBanner.astro', import.meta.url),
);

let html = '';

beforeAll(async () => {
  const container = await AstroContainer.create();
  const { default: Component } = await import(CookieBannerPath);
  html = await container.renderToString(Component, { props: {} });
});

describe('CookieBanner', () => {
  it('рендерится без ошибок', () => {
    expect(html).toBeTruthy();
  });

  it('содержит aria-label="Согласие на куки"', () => {
    expect(html).toContain('aria-label="Согласие на куки"');
  });

  it('содержит ссылку /privacy', () => {
    expect(html).toContain('href="/privacy"');
  });

  it('содержит кнопку «Принять»', () => {
    expect(html).toContain('Принять');
  });

  it('содержит кнопку «Без аналитики»', () => {
    expect(html).toContain('Без аналитики');
  });

  it('содержит role="region"', () => {
    expect(html).toContain('role="region"');
  });

  it('содержит aria-live="polite"', () => {
    expect(html).toContain('aria-live="polite"');
  });
});
