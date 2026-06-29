-- schema.sql — Мастерская V1. SQLite сейчас, схема Postgres-ready.
--
-- Домены БД разделены (SPEC §5): leads / schedule / events / content / admin.
-- Здесь — только домен LEADS (T1-1). Остальные таблицы добавятся своими миграциями.
--
-- Идемпотентность через pre-generated ID (CLAUDE.md §1, SPEC §4):
--   lead.id = idempotency_key (UUID из формы, генерится при рендере ДО отправки).
--   Повтор того же ключа НЕ создаёт второй лид (INSERT OR IGNORE / ON CONFLICT DO NOTHING).
--
-- Соответствия для портирования на Postgres:
--   id          TEXT       -> text (UUID-строка; можно uuid, но храним как пришло из формы)
--   payload     TEXT(JSON) -> jsonb
--   created_at  TEXT(ISO)  -> timestamptz DEFAULT now()
--   status      TEXT       -> text DEFAULT 'new'
-- В SQLite значения по умолчанию выставляет код (created_at = ISO-строка из приложения),
-- в Postgres created_at можно отдать СУБД (DEFAULT now()).
--
-- СИНХРОНИЗАЦИЯ: тот же DDL продублирован константой SCHEMA_DDL в web/src/server/db.ts.
-- Рантайм НЕ читает этот файл (после бандла его нет в dist/server/). Любую правку схемы
-- вносить синхронно: сюда, в db.ts (SCHEMA_DDL) и в migrations/0001_init.sql.

CREATE TABLE IF NOT EXISTS lead (
  id          TEXT PRIMARY KEY,            -- = idempotency_key (UUID). PG: text (или uuid)
  type        TEXT NOT NULL,               -- 'arenda' | 'visit' | 'event'
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',  -- JSON-текст. PG: jsonb DEFAULT '{}'::jsonb
  status      TEXT NOT NULL DEFAULT 'new', -- 'new' | ... (смена статуса — админка M2)
  source_page TEXT,                        -- например '/arenda'
  created_at  TEXT NOT NULL                -- ISO-8601. PG: timestamptz DEFAULT now()
);

-- Просмотр лидов в админке/скрипте — по типу и времени (SPEC §6).
CREATE INDEX IF NOT EXISTS idx_lead_type_created ON lead (type, created_at);

-- ============================================================================
-- M2 — домены SCHEDULE / EVENTS / CONTENT (T2-1). См. docs/m2-contract.md.
--
-- СИНХРОНИЗАЦИЯ: тот же DDL продублирован константой SCHEMA_DDL_M2 в
-- web/src/server/db.ts и в web/db/migrations/0002_m2.sql. Рантайм НЕ читает .sql.
-- Любую правку схемы вносить синхронно во все три места.
--
-- Postgres-соответствия:
--   INTEGER 0/1 (булевы)           -> boolean
--   TEXT с JSON (equipment/photos) -> jsonb (или text[])
--   *_at / datetime TEXT(ISO)      -> timestamptz (updated_at DEFAULT now())
--   rate_* TEXT                    -> text («по запросу»/число строкой; O2 пусто)
-- ============================================================================

CREATE TABLE IF NOT EXISTS hall (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  area_m2           INTEGER,
  capacity          INTEGER,
  equipment         TEXT NOT NULL DEFAULT '[]',   -- JSON-массив строк. PG: jsonb
  rate_hour         TEXT,                          -- «по запросу»/число строкой (O2)
  rate_day          TEXT,
  rate_subscription TEXT,
  photos            TEXT NOT NULL DEFAULT '[]',   -- JSON-массив путей. PG: jsonb
  description       TEXT,
  sort              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS specialist (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT,                               -- 'массаж'|'психолог'|…
  bio          TEXT,
  photo        TEXT,
  external_url TEXT,
  is_resident  INTEGER NOT NULL DEFAULT 0          -- 0/1. PG: boolean
);

CREATE TABLE IF NOT EXISTS slot (
  id            TEXT PRIMARY KEY,
  hall_id       TEXT NOT NULL REFERENCES hall(id),
  specialist_id TEXT REFERENCES specialist(id),
  weekday       INTEGER NOT NULL,                  -- 1..7 (пн..вс)
  time_start    TEXT NOT NULL,                     -- 'HH:MM'
  time_end      TEXT NOT NULL,                     -- 'HH:MM'
  title         TEXT,
  kind          TEXT NOT NULL DEFAULT 'own',       -- 'own' | 'arenda' (O1-приоритет)
  cta_type      TEXT NOT NULL,                     -- 'booking' | 'external'
  external_url  TEXT,                              -- обязателен при cta_type='external'
  conflict_flag INTEGER NOT NULL DEFAULT 0,        -- 0/1. PG: boolean
  is_published  INTEGER NOT NULL DEFAULT 0,        -- 0/1. PG: boolean
  conflict_confirmed INTEGER NOT NULL DEFAULT 0    -- 0/1. PG: boolean DEFAULT false.
                                                   -- M2-QA-1: =1 — админ вручную подтвердил публикацию
                                                   -- конфликтного слота. detectConflicts() уважает (не снимает is_published).
);
CREATE INDEX IF NOT EXISTS idx_slot_hall_weekday ON slot (hall_id, weekday);
CREATE INDEX IF NOT EXISTS idx_slot_published ON slot (is_published);

CREATE TABLE IF NOT EXISTS event (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT,
  datetime         TEXT NOT NULL,                  -- ISO-8601. PG: timestamptz
  hall_id          TEXT REFERENCES hall(id),
  capacity         INTEGER,
  registered_count INTEGER NOT NULL DEFAULT 0,
  is_published     INTEGER NOT NULL DEFAULT 0      -- 0/1. PG: boolean
);

CREATE TABLE IF NOT EXISTS content_page (
  slug             TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  body             TEXT,                           -- markdown
  hero_image       TEXT,
  meta_description TEXT,
  updated_at       TEXT NOT NULL                   -- ISO-8601. PG: timestamptz DEFAULT now()
);
