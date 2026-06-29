/**
 * hover-focus.test.ts — RED→GREEN: hover/focus/active states (task 1.4).
 * Проверяем наличие нужных CSS-правил в статичных файлах.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const WEB = resolve(__dirname, '../../web/src');

function css(file: string) {
  return readFileSync(resolve(WEB, 'styles', file), 'utf-8');
}
function component(file: string) {
  return readFileSync(resolve(WEB, 'components', file), 'utf-8');
}

describe('Task 1.4 — hover / focus / active states', () => {
  test('global.css contains :focus-visible rule', () => {
    expect(css('global.css')).toContain(':focus-visible');
  });

  test('global.css suppresses outline on mouse click (:focus:not(:focus-visible))', () => {
    expect(css('global.css')).toContain(':focus:not(:focus-visible)');
  });

  test('global.css has text-decoration-color for links', () => {
    expect(css('global.css')).toContain('text-decoration-color');
  });

  test('global.css has transition on form inputs', () => {
    const content = css('global.css');
    expect(content).toContain('input');
    expect(content).toContain('transition');
  });

  test('global.css has focus box-shadow for form fields', () => {
    expect(css('global.css')).toContain('box-shadow');
  });

  test('Button.astro has transition including transform', () => {
    const content = component('Button.astro');
    expect(content).toContain('transition');
    expect(content).toContain('transform');
  });

  test('Button.astro has active state with translateY(0)', () => {
    expect(component('Button.astro')).toContain('translateY(0)');
  });

  test('Button.astro primary hover uses --btn-bg-hover', () => {
    expect(component('Button.astro')).toContain('--btn-bg-hover');
  });

  test('CookieBanner.astro has hover on both buttons', () => {
    const content = component('CookieBanner.astro');
    expect(content).toContain('btn--primary:hover');
    expect(content).toContain('btn--ghost:hover');
  });
});
