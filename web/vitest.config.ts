/// <reference types="vitest" />
import { getViteConfig } from 'astro/config';

// Тесты живут в tests/web (зеркалят web/, см. PROJECT_STRUCTURE).
// getViteConfig подключает astro-плагин Vite → тесты могут рендерить .astro
// компоненты через Astro Container API (tests/web/arenda.test.ts).
export default getViteConfig({
  test: {
    globals: true,
    include: ['../tests/web/**/*.{test,spec}.{js,ts,mjs}'],
    environment: 'node',
  },
});
