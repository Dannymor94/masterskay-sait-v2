import { describe, it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../../web/src/lib/markdown.ts';

/**
 * Контент-страница (T2-3): рендер из content_page. Проверяем:
 *  - renderMarkdown: markdown → html (## → <h2>, **x** → <strong>).
 *  - ContentArticle.astro: title как <h1>, hero alt, html-тело из md.
 */

const ContentArticle = fileURLToPath(
  new URL('../../web/src/components/ContentArticle.astro', import.meta.url),
);

describe('renderMarkdown', () => {
  it('преобразует ## в <h2>', () => {
    const html = renderMarkdown('## Заголовок раздела');
    expect(html).toMatch(/<h2[^>]*>Заголовок раздела<\/h2>/);
  });

  it('преобразует **жирный** в <strong>', () => {
    const html = renderMarkdown('Текст **важный** тут');
    expect(html).toMatch(/<strong>важный<\/strong>/);
  });

  it('пустой/нулевой ввод → пустая строка', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });
});

describe('ContentArticle.astro', () => {
  it('рендерит title как <h1> и html-тело из markdown', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ContentArticle);
    const out = await container.renderToString(Component, {
      props: {
        title: 'Чайная',
        bodyHtml: renderMarkdown('## Что это за место\n\nДерево и **тишина**.'),
        heroImage: '/img/placeholders/detail-tea.jpg',
      },
    });
    expect(out).toMatch(/<h1[^>]*>Чайная<\/h1>/);
    expect(out).toMatch(/<h2[^>]*>Что это за место<\/h2>/);
    expect(out).toMatch(/<strong>тишина<\/strong>/);
  });

  it('hero-картинка имеет alt (a11y)', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ContentArticle);
    const out = await container.renderToString(Component, {
      props: {
        title: 'Йога-туры',
        bodyHtml: '<p>Текст</p>',
        heroImage: '/img/placeholders/detail-wood.jpg',
      },
    });
    const img = out.match(/<img\b[^>]*>/i);
    expect(img, 'hero img должен присутствовать').not.toBeNull();
    expect(img![0]).toMatch(/\balt="[^"]*"/i);
  });

  it('без hero — рендерится без <img>', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ContentArticle);
    const out = await container.renderToString(Component, {
      props: { title: 'Без картинки', bodyHtml: '<p>Текст</p>', heroImage: null },
    });
    expect(out).toMatch(/<h1[^>]*>Без картинки<\/h1>/);
    expect(out).not.toMatch(/<img\b/i);
  });
});
