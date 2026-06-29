import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrastRatio, WCAG } from '../../web/scripts/contrast.mjs';
import { generateTokensCss } from '../../web/scripts/gen-tokens.mjs';

const tokens = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../design/tokens.json', import.meta.url)), 'utf8'),
);

const WHITE = '#FFFFFF';
const ORANGE = '#E67E22'; // base accent — НЕ текст
const ORANGE_DEEP = '#D35400'; // кнопки/заголовки крупно
const BODY_TEXT = ['#3E2A1A', '#5C4033', '#8B5A2B'];

describe('Контраст-гейты (T0-1) — нарушение = баг (brand-guardian обязан ловить)', () => {
  it('оранжевый #E67E22 НЕ проходит как обычный текст на белом (только заливки)', () => {
    expect(contrastRatio(ORANGE, WHITE)).toBeLessThan(WCAG.AA_NORMAL);
  });

  it('оранжевый #E67E22 не объявлен цветом текста в токенах', () => {
    const bodyColors: string[] = tokens.contrast_rules.body_text_colors;
    expect(bodyColors.map((c) => c.toUpperCase())).not.toContain(ORANGE);
    // и роль в палитре явно помечена «НЕ ТЕКСТ»
    expect(tokens.color.base.orange.use.toUpperCase()).toContain('НЕ ТЕКСТ');
  });

  it('кнопка #D35400 + белый текст ≥16px полужирный проходит AA для крупного', () => {
    const ratio = contrastRatio(ORANGE_DEEP, WHITE);
    expect(ratio).toBeGreaterThanOrEqual(WCAG.AA_LARGE);
    // но НЕ дотягивает до обычного AA → нельзя как мелкий текст
    expect(ratio).toBeLessThan(WCAG.AA_NORMAL);
    // правило кнопки в токенах: заливка #D35400 + белый, от 16px, полужирный
    const rule = tokens.contrast_rules.button.toLowerCase();
    expect(rule).toContain('#d35400');
    expect(rule).toContain('белый');
    expect(rule).toContain('16px');
    expect(rule).toContain('полужирный');
  });

  it('каждый body-текст {#3E2A1A,#5C4033,#8B5A2B} проходит минимум AA на белом', () => {
    for (const c of BODY_TEXT) {
      expect(contrastRatio(c, WHITE)).toBeGreaterThanOrEqual(WCAG.AA_NORMAL);
    }
  });

  it('основные тёмные тексты (венге #3E2A1A, #5C4033) дают AAA на белом', () => {
    expect(contrastRatio('#3E2A1A', WHITE)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
    expect(contrastRatio('#5C4033', WHITE)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
  });

  it('токены объявляют ровно эти три цвета текста', () => {
    expect(tokens.contrast_rules.body_text_colors.map((c: string) => c.toUpperCase()).sort()).toEqual(
      BODY_TEXT.map((c) => c.toUpperCase()).sort(),
    );
  });
});

describe('Генерация CSS-переменных из tokens.json (T0-1)', () => {
  const css = generateTokensCss(tokens);

  it('эмитит :root с переменными цвета из палитры', () => {
    expect(css).toContain(':root');
    expect(css).toContain('--color-white: #FFFFFF');
    expect(css).toContain('--color-orange: #E67E22');
    expect(css).toContain('--color-orange-deep: #D35400');
    expect(css).toContain('--color-ink: #3E2A1A');
    expect(css).toContain('--color-ink-soft: #5C4033');
    expect(css).toContain('--color-wood: #8B5A2B');
  });

  it('эмитит семантические переменные: текст из body-палитры, фон белый', () => {
    expect(css).toContain('--text: var(--color-ink)');
    expect(css).toContain('--bg: var(--color-white)');
    // акцент-кнопка: фон orange-deep, текст белый
    expect(css).toContain('--btn-bg: var(--color-orange-deep)');
    expect(css).toContain('--btn-text: var(--color-white)');
  });

  it('эмитит типографику: семейства и базовый размер ≥16px', () => {
    expect(css).toContain('--font-headings:');
    expect(css).toContain('Raleway');
    expect(css).toContain('--font-overline:');
    expect(css).toContain('Montserrat');
    expect(css).toContain('--font-body:');
    expect(css).toContain('Open Sans');
    expect(css).toContain('--text-base: 1rem'); // 1rem = 16px база
  });

  it('НЕ присваивает оранжевый ни одной текстовой/фоновой семантике', () => {
    // никакая семантика текста не указывает прямо на orange base
    expect(css).not.toMatch(/--text[\w-]*:\s*var\(--color-orange\)\s*;/);
  });
});
