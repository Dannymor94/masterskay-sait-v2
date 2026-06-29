# PROJECT_STRUCTURE — Раскладка репозитория

> Физические границы = логические (инвариант проекта). Раскладка под стек по
> умолчанию (Astro + SQLite). При смене стека — обновить этот файл первым.

```
masterskaya-site/
├── PROJECT_GUIDE.md          # каноничное описание (главный документ)
├── SPEC.md                   # функциональная спецификация V1
├── PLAN.md                   # стадии TDD, гейты
├── PROJECT_STRUCTURE.md      # этот файл
├── CLAUDE.md                 # инварианты + orchestration (правила вызова агентов)
├── README.md                 # как запустить, навигация по докам
│
├── design/
│   ├── tokens.json           # дизайн-токены (экспорт из бренд-бука) — ИСТОЧНИК ИСТИНЫ
│   └── voice.md              # голос бренда (экспорт из бренд-бука) для копирайта
│
├── .claude/
│   └── agents/               # AI-«сотрудники» (субагенты). Правила вызова — в CLAUDE.md
│       ├── ux-architect.md
│       ├── ui-designer.md
│       ├── brand-guardian.md
│       ├── frontend-engineer.md
│       ├── backend-engineer.md
│       ├── copywriter.md
│       ├── qa-engineer.md
│       └── seo-specialist.md   # отложен (V2): description помечен «do NOT use in V1»
│
├── prompts/                  # runtime-LLM промпты. В V1 ПУСТО (детерминизм-first,
│   └── .gitkeep              # сайт не содержит runtime-LLM). Зарезервировано под будущее.
│
├── web/                      # фронтенд (Astro + TS) — граница «представление»
│   ├── src/
│   │   ├── pages/            # маршруты из SPEC §1 (/, /arenda, /raspisanie, …)
│   │   ├── components/       # кнопка, карточка зала, форма, слот расписания
│   │   ├── layouts/
│   │   ├── styles/           # генерится из design/tokens.json — НЕ править вручную
│   │   └── content/          # md-контент страниц (если коллекции Astro)
│   ├── public/fonts/         # self-hosted TTF (Raleway/Montserrat/Open Sans)
│   └── public/img/           # фото (плейсхолдеры → реальные от фотографа)
│
├── api/                      # backend — граница «данные/логика»
│   ├── src/
│   │   ├── leads/            # приём заявок: идемпотентность, валидация
│   │   ├── schedule/         # слоты, два CTA, флаг конфликта
│   │   ├── events/           # события + регистрация
│   │   ├── content/          # CRUD контент-страниц
│   │   └── admin/            # одна роль, CRUD (без мультиарендных ролей)
│   └── db/
│       ├── schema.sql        # SQLite, Postgres-ready
│       └── migrations/
│
└── tests/                    # TDD: RED раньше кода. Зеркалит web/ и api/
    ├── web/
    └── api/
```

## Заметки о границах
- `design/tokens.json` — единственный источник цвета/типографики. `web/src/styles`
  генерится из него; ручная правка цветов в компонентах запрещена (brand-guardian
  ловит).
- `web/` и `api/` не лезут друг в друга кодом; общение — через HTTP-эндпоинты.
  (Если стек = Astro SSR-эндпоинты, `api/` живёт внутри `web/src/pages/api/`, но
  логические домены те же — leads/schedule/events/content/admin.)
- `prompts/` пуст намеренно: V1 без runtime-LLM. Не наполнять «на будущее».
