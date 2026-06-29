// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// M1: подключаем SSR. output 'hybrid' = по умолчанию статика (быстро, дёшево),
// серверный рендер — только там, где нужен (форма /arenda генерит idempotency_key
// при рендере; эндпоинт /api/leads/arenda принимает POST). Такие страницы/эндпоинты
// помечаются `export const prerender = false`. Контентные страницы остаются статикой.
export default defineConfig({
  site: 'https://yoga-rostov-mst.ru',
  output: 'hybrid',
  adapter: node({ mode: 'standalone' }),
  build: {
    // встраивать мелкий CSS критичен для веса страницы (qa-gate)
    inlineStylesheets: 'auto',
  },
  // Оптимизация изображений Astro (встроенный sharp-сервис).
});
