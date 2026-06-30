/**
 * gen-og.mjs
 * Converts web/public/og-default.svg to web/public/og-default.png (1200x630).
 * Run: node scripts/gen-og.mjs (from web/ directory)
 * Hooked as "prebuild" so the PNG is always fresh before astro build.
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const svgPath = join(publicDir, 'og-default.svg');
const pngPath = join(publicDir, 'og-default.png');

const svgBuffer = readFileSync(svgPath);

const pngBuffer = await sharp(svgBuffer, { density: 150 })
  .resize(1200, 630, { fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(pngPath, pngBuffer);

const kb = (pngBuffer.length / 1024).toFixed(1);
console.log(`[gen-og] og-default.png written — ${kb} KB`);
