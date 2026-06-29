import { describe, it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';

/**
 * ArendaModal — CSS :target модалка (без JS). Инвариант:
 *  - id="zayavka" на корневом элементе (CSS :target срабатывает по якорю #zayavka);
 *  - кнопка закрытия href="#" (убирает :target без JS);
 *  - внутри — рабочая форма с action=/api/leads/arenda.
 */

const ArendaModal = fileURLToPath(
  new URL('../../web/src/components/ArendaModal.astro', import.meta.url),
);

const UUID = '11111111-2222-4333-8444-555555555555';
const RENDERED_AT = '2026-06-29T10:00:00.000Z';

describe('ArendaModal — :target модалка без JS', () => {
  it('id="zayavka" на корневом элементе', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaModal);
    const html = await container.renderToString(Component, {
      props: { idempotencyKey: UUID, formRenderedAt: RENDERED_AT },
    });
    expect(html).toMatch(/\bid="zayavka"/i);
  });

  it('кнопка закрытия href="#" без JS', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaModal);
    const html = await container.renderToString(Component, {
      props: { idempotencyKey: UUID, formRenderedAt: RENDERED_AT },
    });
    expect(html).toMatch(/href="#"/i);
  });

  it('содержит форму action=/api/leads/arenda', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaModal);
    const html = await container.renderToString(Component, {
      props: { idempotencyKey: UUID, formRenderedAt: RENDERED_AT },
    });
    expect(html).toMatch(/action="\/api\/leads\/arenda"/i);
  });

  it('idempotency_key передаётся в форму', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaModal);
    const html = await container.renderToString(Component, {
      props: { idempotencyKey: UUID, formRenderedAt: RENDERED_AT },
    });
    expect(html).toMatch(new RegExp(`value="${UUID}"`));
  });

  it('нет инлайн on*-обработчиков в разметке', async () => {
    const container = await AstroContainer.create();
    const { default: Component } = await import(ArendaModal);
    const html = await container.renderToString(Component, {
      props: { idempotencyKey: UUID, formRenderedAt: RENDERED_AT },
    });
    // strip <script> blocks before checking
    const noScript = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const onAttrs = noScript.match(/\son[a-z]+\s*=/gi) ?? [];
    expect(onAttrs).toEqual([]);
  });
});
