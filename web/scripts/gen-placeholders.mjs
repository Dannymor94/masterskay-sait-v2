// Генератор плейсхолдер-изображений (M0, пока нет реальных фото — блокер O4).
// Тёплая палитра из tokens (дерево/крем/песок/оранжевый), ПРАВИЛЬНОЕ кадрирование
// по imagery-правилам (дневной/тёплый свет, дерево). Это ЯВНО плейсхолдеры:
// помечены подписью, чтобы их нельзя было спутать с реальной съёмкой.
// Запуск: node scripts/gen-placeholders.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const OUT = fileURLToPath(new URL('../public/img/placeholders/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// тёплые тона из бренд-бука (interior + wood)
const PAL = {
  cream: '#F9F6F0',
  paper: '#F2ECE0',
  sand: '#D6C5A9',
  wood: '#8B5A2B',
  woodDark: '#5C3E20',
  woodDarkest: '#2A1B10',
  orange: '#E67E22',
  ink: '#3E2A1A',
};

function svg({ w, h, c1, c2, label, sub }) {
  // мягкий диагональный градиент + «оконный свет» + деревянные горизонтали +
  // силуэт раскидистого дерева (намёк на знак), без кислотных цветов и пересвета.
  const planks = Array.from({ length: 7 }, (_, i) => {
    const y = (h / 7) * i;
    return `<rect x="0" y="${y}" width="${w}" height="${h / 7}" fill="${PAL.wood}" opacity="${0.04 + (i % 2) * 0.05}"/>`;
  }).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="light" cx="0.72" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${planks}
  <rect width="${w}" height="${h}" fill="url(#light)"/>
  <g transform="translate(${w * 0.16},${h * 0.5})" opacity="0.22" fill="${PAL.woodDarkest}">
    <rect x="-6" y="-10" width="12" height="${h * 0.34}" rx="5"/>
    <circle cx="0" cy="-30" r="${h * 0.16}"/>
  </g>
  <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="Georgia, serif"
        font-size="${Math.round(w * 0.035)}" fill="${PAL.ink}" opacity="0.8"
        font-weight="600">${label}</text>
  <text x="${w / 2}" y="${h / 2 + Math.round(w * 0.04)}" text-anchor="middle"
        font-family="Arial, sans-serif" font-size="${Math.round(w * 0.018)}"
        fill="${PAL.woodDark}" opacity="0.7" letter-spacing="2">${sub}</text>
</svg>`);
}

const items = [
  { name: 'hero', w: 1600, h: 1000, c1: PAL.paper, c2: PAL.sand, label: 'Большой зал · 70 м²', sub: 'ПЛЕЙСХОЛДЕР — ждём съёмку (O4)' },
  { name: 'hall-big', w: 1200, h: 900, c1: PAL.cream, c2: PAL.sand, label: 'Большой зал · 70 м²', sub: 'ПЛЕЙСХОЛДЕР' },
  { name: 'hall-small', w: 1200, h: 900, c1: PAL.paper, c2: PAL.wood, label: 'Малый зал · 30 м²', sub: 'ПЛЕЙСХОЛДЕР' },
  { name: 'hall-tea', w: 1200, h: 900, c1: PAL.sand, c2: PAL.woodDark, label: 'Чайный зал · 45 м²', sub: 'ПЛЕЙСХОЛДЕР' },
  { name: 'detail-tea', w: 900, h: 900, c1: PAL.cream, c2: PAL.sand, label: 'Чай · пар над чашкой', sub: 'ПЛЕЙСХОЛДЕР' },
  { name: 'detail-wood', w: 900, h: 900, c1: PAL.paper, c2: PAL.wood, label: 'Дерево · тёплый свет', sub: 'ПЛЕЙСХОЛДЕР' },
];

for (const it of items) {
  const buf = svg(it);
  // JPG (тёплый, под фотоконтент) + лёгкий blur, чтобы читалось как «фото-место»
  await sharp(buf)
    .blur(0.6)
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(`${OUT}${it.name}.jpg`);
  console.log(`placeholder: ${it.name}.jpg (${it.w}×${it.h})`);
}
console.log('Готово. Это ВРЕМЕННЫЕ плейсхолдеры (O4): заменяются реальной съёмкой на M3.');
