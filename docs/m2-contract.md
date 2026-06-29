# M2 — Контракт: данные, расписание, контент, формы (общий для агентов)

> Вход: SPEC §3 (два CTA), §5 (модель данных), §6 (админка одна роль), §7;
> PLAN M2; TASKS M2; DECISIONS O1 (решён); docs/m1-leads-contract.md (паттерн форм).
> Цель Gate M2: контент залит; расписание публикуется БЕЗ пересечений; конфликты
> ждут ручного подтверждения; формы (визит/событие) работают без JS с дедупом.

## O1 — РЕШЕНО (Даниил)
**Приоритет у аренды.** При пересечении (один зал, тот же weekday, пересекающееся
время) аренды и «своего занятия» — выигрывает аренда. Конфликтующий слот получает
`conflict_flag = 1` и **НЕ публикуется автоматически** (`is_published = 0`), пока
человек вручную не подтвердит в админке. **Авто-публикации конфликтов нет.**
`/raspisanie` показывает только `is_published = 1`.

## Модель данных (SPEC §5, SQLite сейчас, Postgres-ready)
Булевы — INTEGER 0/1 (PG boolean). Массивы/JSON — TEXT с JSON (PG text[]/jsonb).
created_at/updated_at — ISO-текст (PG timestamptz default now()). Все DDL — встроены
константой в модуль (как `lead` в M1: рантайм НЕ читает .sql после бандла; .sql +
migrations/ остаются источником истины и синхронизируются с константой).

```
hall(
  id TEXT PK, name TEXT NOT NULL, area_m2 INTEGER, capacity INTEGER,
  equipment TEXT,            -- JSON-массив строк
  rate_hour TEXT, rate_day TEXT, rate_subscription TEXT,  -- TEXT: «по запросу»/число (O2 пусто)
  photos TEXT,               -- JSON-массив путей
  description TEXT, sort INTEGER DEFAULT 0
)
specialist(
  id TEXT PK, name TEXT NOT NULL, kind TEXT,   -- массаж/психолог/…
  bio TEXT, photo TEXT, external_url TEXT, is_resident INTEGER DEFAULT 0
)
slot(
  id TEXT PK, hall_id TEXT NOT NULL REFERENCES hall(id),
  specialist_id TEXT REFERENCES specialist(id),
  weekday INTEGER NOT NULL,            -- 1..7 (пн..вс)
  time_start TEXT NOT NULL,            -- 'HH:MM'
  time_end TEXT NOT NULL,              -- 'HH:MM'
  title TEXT,
  kind TEXT NOT NULL DEFAULT 'own',    -- 'own' (своё занятие) | 'arenda' (аренда) — для O1-приоритета
  cta_type TEXT NOT NULL,              -- 'booking' | 'external'
  external_url TEXT,                   -- обязателен при cta_type='external'
  conflict_flag INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0
)
event(
  id TEXT PK, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT,
  datetime TEXT NOT NULL, hall_id TEXT REFERENCES hall(id),
  capacity INTEGER, registered_count INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0
)
content_page(
  slug TEXT PK, title TEXT NOT NULL, body TEXT,   -- markdown
  hero_image TEXT, meta_description TEXT, updated_at TEXT NOT NULL
)
-- lead (из M1) переиспользуем: type ∈ {'arenda','visit','event'}; payload JSON.
```

## Два CTA на слот (SPEC §3)
- `cta_type='booking'` → кнопка «Записаться» → форма визита (наша, /api/leads/visit).
- `cta_type='external'` → кнопка «К специалисту» → `external_url` (внешняя ссылка).
Одна сетка, два типа кнопки. Никакой онлайн-оплаты.

## Конфликты (реализация O1)
Функция `detectConflicts()` (backend): для опубликованных/готовящихся слотов находит
пересечения (hall_id + weekday + перекрытие [time_start,time_end)). Если в паре есть
`kind='arenda'` и `kind='own'` — `own`-слот помечается `conflict_flag=1`,
`is_published=0`. Публикация конфликтного слота — только ручным действием в админке
(toggle is_published с явным подтверждением). `/raspisanie` рендерит только
`is_published=1`. Тест обязателен (T2-2/T2-5): конфликтный слот НЕ появляется в выдаче,
пока админ не подтвердил.

## Админка — ОДНА роль (SPEC §6)
- CRUD: hall, specialist, slot, event, content_page; просмотр лидов + смена статуса.
- Без мультиролей/самообслуживания (это V2). Маршруты `/admin/**`, SSR (prerender=false).
- **Авторизация — механизм строит агент, СЕКРЕТ заводит человек (CLAUDE.md §2):**
  логин-форма `/admin/login`; пароль сверяется с `ADMIN_PASSWORD_HASH` из env
  (хэш scrypt/Node crypto); сессия — подписанная httpOnly-cookie (`SESSION_SECRET` из env);
  middleware гейтит `/admin/**`. Агент даёт скрипт `scripts/hash-password.mjs` (человек
  запускает, кладёт хэш в `.env`). Агент НЕ создаёт аккаунты/пароли/секреты, НЕ коммитит .env.
  Если env пуст — админка отдаёт 503/«настройте доступ», не падает; публичный сайт работает.

## Формы визита и события (T2-4) — паттерн M1
- Визит: `POST /api/leads/visit`, lead.type='visit', поля: name, contact, direction(направление), consent (+ honeypot, idempotency_key, form_rendered_at, source_page). Цель Метрики `visit_lead`.
- Событие: `POST /api/leads/event`, lead.type='event', поля: name, contact, event_id(hidden), count(мест), consent (+ служебные). Цель `event_register`. registered_count увеличивать атомарно при создании лида; не превышать capacity (если задана).
- Тот же дедуп по idempotency_key (один ключ → один лид), honeypot, время-на-форме, PRG-редирект на «спасибо», ПДн только в теле/cookie.

## Границы (WORKFLOW §3)
- backend: web/src/server/**, web/src/pages/api/**, web/src/pages/admin/** (SSR-логика), web/db/**, tests/web/*server*|*leads*|*schedule*|*admin*.
- frontend: web/src/pages/*.astro (raspisanie, content), web/src/components/**, формы-вёрстка, прогрессивный JS.
- copywriter: web/src/content/** (тексты контент-страниц).
- НЕ трогать: design/tokens.json, .env*, V2 (самообслуживаемая админка/оплата/кабинеты).

## Метрика
Цели: `visit_lead`, `event_register` (в дополнение к `arenda_lead`). Компонент Metrika.astro
уже есть. 152-ФЗ (баннер согласия + /privacy) — долг M3, как и в M1.
