// Детерминированный расчёт контраста по WCAG 2.x.
// Единый источник истины для генератора токенов и контраст-тестов (T0-1).
// Никакого runtime-LLM — чистая арифметика (инвариант «определённость прежде магии»).

/** @param {string} hex - '#RRGGBB' */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Некорректный hex-цвет: ${hex}`);
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Относительная яркость канала (WCAG). */
function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Относительная яркость цвета (WCAG). */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Коэффициент контраста между двумя цветами (1..21). */
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// Пороги WCAG.
export const WCAG = {
  AA_NORMAL: 4.5, // обычный текст
  AA_LARGE: 3.0, // крупный (≥18px, либо ≥14px bold)
  AAA_NORMAL: 7.0, // обычный текст AAA
};
