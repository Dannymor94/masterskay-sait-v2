# web/ — фронтенд «Мастерская» (Astro + TypeScript)

Стек зафиксирован (R1): **Astro + SQLite**, SSR-эндпоинты — в `web/src/pages/api/**`
(домены `leads/schedule/events/content/admin` заведены с первого коммита).
В M0 лендинг `/arenda` статичен (`output: 'static'`); адаптер/SSR подключаются с M1.

## Команды

```bash
npm install            # установка (esbuild/sharp — install-скрипты одобрены в package.json)
npm run gen:tokens     # design/tokens.json → src/styles/tokens.css (НЕ править css вручную)
npm run dev            # дев-сервер
npm test               # Vitest (tests/web/**), RED→GREEN
npm run build          # gen:tokens + astro check + astro build
```

## Источники истины и границы

- **Цвет/типографика** — только `design/tokens.json`. `src/styles/tokens.css`
  генерируется из него (`scripts/gen-tokens.mjs`), вручную не редактируется.
- **Контраст-гейты** — `tests/web/tokens.test.ts` (оранжевый не как текст; кнопка
  `#D35400`+белый ≥16px; body-текст из {#3E2A1A,#5C4033,#8B5A2B}).
- **Шрифты** — self-hosted статичные TTF (кириллица) в `public/fonts/`, без Google CDN.
  Инстансы из вариативных OFL-исходников (`scripts/` не коммитит исходники).
- **Изображения** — `public/img/placeholders/*` ВРЕМЕННЫЕ (блокер O4), генерятся
  `scripts/gen-placeholders.mjs`; заменяются реальной съёмкой на M3.

## Структура

```
src/
  layouts/      BaseLayout.astro (общий каркас, preload шрифтов, skip-link)
  pages/        маршруты; pages/api/** — SSR-эндпоинты по доменам (M1+)
  components/    кнопка/карточка зала/форма/слот (ui-designer → frontend-engineer)
  styles/       tokens.css (генерится) + fonts.css + global.css
  content/       md-контент страниц (M2)
scripts/        gen-tokens.mjs, gen-placeholders.mjs, contrast.mjs
db/             SQLite (schema.sql + migrations — M1/M2)
```
