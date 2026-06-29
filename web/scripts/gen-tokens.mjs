// Генератор CSS-переменных из design/tokens.json (T0-1).
// design/tokens.json — ЕДИНСТВЕННЫЙ источник истины по цвету/типографике.
// web/src/styles/tokens.css генерится отсюда и НЕ правится вручную (PROJECT_STRUCTURE,
// WORKFLOW §3). Детерминированно, без runtime-LLM.
//
// Запуск:  node scripts/gen-tokens.mjs   (пишет web/src/styles/tokens.css)
// Тест импортирует generateTokensCss() напрямую (чистая функция).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** kebab имя переменной из ключа палитры: base.orange-deep → --color-orange-deep */
function colorVar(key) {
  return `--color-${key}`;
}

/** Собирает плоский список [имяПеременной, hex] из цветовой палитры токенов. */
function collectColorVars(color) {
  const out = [];
  for (const [groupName, group] of Object.entries(color)) {
    if (groupName === 'orange-ramp') {
      for (const [k, v] of Object.entries(group)) {
        if (k.startsWith('_')) continue;
        out.push([`--color-orange-${k}`, v]);
      }
      continue;
    }
    for (const [k, v] of Object.entries(group)) {
      if (k.startsWith('_')) continue;
      const hex = typeof v === 'string' ? v : v.hex;
      if (!hex) continue;
      out.push([colorVar(k), hex]);
    }
  }
  return out;
}

/** Чистая функция: tokens → строка CSS. Тестируется напрямую. */
export function generateTokensCss(tokens) {
  const colorVars = collectColorVars(tokens.color);
  const t = tokens.typography;
  const f = t.fonts;
  const fallback = f.fallback;

  const stack = (primary) => `'${primary}', ${fallback}`;

  const lines = [];
  lines.push('/* СГЕНЕРИРОВАНО из design/tokens.json — НЕ РЕДАКТИРОВАТЬ ВРУЧНУЮ. */');
  lines.push('/* Источник истины: design/tokens.json. Регенерация: npm run gen:tokens. */');
  lines.push('');
  lines.push(':root {');

  lines.push('  /* --- Палитра (из бренд-бука) --- */');
  for (const [name, hex] of colorVars) {
    lines.push(`  ${name}: ${hex};`);
  }

  lines.push('');
  lines.push('  /* --- Семантика: текст из венге-палитры, фон белый, акцент-кнопка --- */');
  lines.push('  --bg: var(--color-white);');
  lines.push('  --surface: var(--color-cream);');
  lines.push('  --text: var(--color-ink);'); // #3E2A1A — AAA на белом
  lines.push('  --text-muted: var(--color-ink-soft);'); // #5C4033 — AAA
  lines.push('  --heading: var(--color-ink-soft);');
  lines.push('  --heading-accent: var(--color-orange-deep);'); // крупные заголовки/цифры
  lines.push('  --link: var(--color-orange-deep);'); // 4.17:1 — допустимо крупно/жирно
  lines.push('  --border: var(--color-wood);');
  lines.push('  --accent-fill: var(--color-orange);'); // ТОЛЬКО заливки/плашки, не текст
  lines.push('  --btn-bg: var(--color-orange-deep);');
  lines.push('  --btn-text: var(--color-white);');
  lines.push('  --btn-bg-hover: var(--color-orange-700);');
  lines.push('  --focus-ring: var(--color-orange-deep);');

  lines.push('');
  lines.push('  /* --- Состояния (только интерфейс) --- */');
  lines.push('  --state-success: var(--color-success);');
  lines.push('  --state-warning: var(--color-warning);');
  lines.push('  --state-error: var(--color-error);');
  lines.push('  --state-info: var(--color-info);');

  lines.push('');
  lines.push('  /* --- Типографика (семейства, self-hosted, без Google CDN) --- */');
  lines.push(`  --font-headings: ${stack(f.headings)};`);
  lines.push(`  --font-overline: ${stack(f.overline_accent)};`);
  lines.push(`  --font-body: ${stack(f.body)};`);
  lines.push(`  --font-fallback: ${fallback};`);

  lines.push('');
  lines.push('  /* --- Типошкала (из tokens.typography.scale) --- */');
  lines.push('  --text-base: 1rem;'); // 1rem = 16px база (≥16px требование)
  const scale = t.scale;
  const sizeFor = (key) => {
    const raw = scale[key].size;
    if (raw.includes('-')) {
      // диапазон вида "0.72-0.85rem" → плавный clamp
      const [min, max] = raw.replace('rem', '').split('-');
      return `clamp(${min}rem, 0.4vw + 0.6rem, ${max}rem)`;
    }
    return raw;
  };
  for (const key of Object.keys(scale)) {
    lines.push(`  --text-${key}: ${sizeFor(key)};`);
    lines.push(`  --leading-${key}: ${scale[key].line};`);
    if (scale[key].weight != null) lines.push(`  --weight-${key}: ${scale[key].weight};`);
    if (scale[key].letter_spacing) lines.push(`  --tracking-${key}: ${scale[key].letter_spacing};`);
  }

  lines.push('');
  lines.push('  /* --- Ритм/радиусы (производные, нейтральные) --- */');
  lines.push('  --space-1: 0.5rem;');
  lines.push('  --space-2: 1rem;');
  lines.push('  --space-3: 1.5rem;');
  lines.push('  --space-4: 2.5rem;');
  lines.push('  --space-5: 4rem;');
  lines.push('  --space-6: 6rem;');
  lines.push('  --radius-sm: 4px;');
  lines.push('  --radius-md: 8px;');
  lines.push('  --radius-lg: 16px;');
  lines.push('  --maxw: 72rem;');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// CLI: читает токены, пишет web/src/styles/tokens.css.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const tokensPath = fileURLToPath(new URL('../../design/tokens.json', import.meta.url));
  const outPath = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url));
  const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
  const css = generateTokensCss(tokens);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, css, 'utf8');
  console.log(`tokens.css сгенерирован: ${outPath} (${css.length} байт)`);
}
