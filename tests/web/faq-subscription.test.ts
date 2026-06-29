import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';

/**
 * T-master-6: вопрос про абонементы в Faq.astro.
 *
 * Проверяем, что компонент FAQ содержит вопрос про абонементы и тёплый ответ
 * про индивидуальный формат для постоянных резидентов.
 */

const FaqComponent = fileURLToPath(
  new URL('../../web/src/components/Faq.astro', import.meta.url),
);

let html = '';

beforeAll(async () => {
  const container = await AstroContainer.create();
  const { default: Component } = await import(FaqComponent);
  html = await container.renderToString(Component, { props: {} });
}, 30_000);

describe('Faq.astro — вопрос про абонементы (T-master-6)', () => {
  it('содержит вопрос про абонементы', () => {
    expect(html).toMatch(/абонемент/i);
  });

  it('содержит ответ про постоянных резидентов', () => {
    expect(html).toMatch(/резидент/i);
  });

  it('ответ упоминает, что обсуждается индивидуально', () => {
    expect(html).toMatch(/индивидуально/i);
  });
});
