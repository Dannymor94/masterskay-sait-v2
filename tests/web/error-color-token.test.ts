import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Регресс-гард контраста (C1/M1): текст ошибок форм должен браться из error-токена
 * (var(--state-error) = #B0413A, ~5.9:1 AA), а НЕ из orange-deep
 * (var(--btn-bg)/var(--link) = #D35400, 4.17:1 — FAIL AA для мелкого текста).
 *
 * Source-level проверка: блок `.field__error { ... }` не содержит var(--btn-bg),
 * а ссылки сводки `.apply__summary-list a` используют error-токен + подчёркивание
 * (признак ошибки не только цветом). Рамку/маркер на orange не трогаем.
 */

const forms = ['VisitForm', 'EventForm', 'ArendaForm'].map((name) => ({
  name,
  src: readFileSync(
    fileURLToPath(new URL(`../../web/src/components/${name}.astro`, import.meta.url)),
    'utf-8',
  ),
}));

function block(src: string, selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = src.match(re);
  expect(m, `не найден блок ${selector}`).not.toBeNull();
  return m![1];
}

describe('Цвет текста ошибок — из --state-error, не orange-deep', () => {
  for (const { name, src } of forms) {
    it(`${name}: .field__error не использует var(--btn-bg)`, () => {
      const css = block(src, '.field__error');
      expect(css).not.toContain('var(--btn-bg)');
      expect(css).toContain('var(--state-error)');
    });

    it(`${name}: ссылки сводки ошибок — error-токен + подчёркивание`, () => {
      const css = block(src, '.apply__summary-list a');
      expect(css).not.toContain('var(--link)');
      expect(css).toContain('var(--state-error)');
      expect(css).toContain('underline');
    });
  }
});
