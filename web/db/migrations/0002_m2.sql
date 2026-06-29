-- 0002_m2.sql — миграция доменов SCHEDULE / EVENTS / CONTENT (T2-1, стадия M2).
-- Тот же DDL, что и в web/db/schema.sql (источник истины для свежей БД) и в
-- константе SCHEMA_DDL_M2 в web/src/server/db.ts (рантайм). Синхронизировать все три.
--
-- Postgres-соответствия:
--   INTEGER 0/1 (булевы)           -> boolean
--   TEXT с JSON (equipment/photos) -> jsonb (или text[])
--   *_at / datetime TEXT(ISO)      -> timestamptz (updated_at DEFAULT now())
--   rate_* TEXT                    -> text («по запросу»/число строкой; O2 пусто)
-- lead (0001) не трогаем; type расширяется значениями 'visit'|'event' на уровне кода.

CREATE TABLE IF NOT EXISTS hall (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  area_m2           INTEGER,
  capacity          INTEGER,
  equipment         TEXT NOT NULL DEFAULT '[]',
  rate_hour         TEXT,
  rate_day          TEXT,
  rate_subscription TEXT,
  photos            TEXT NOT NULL DEFAULT '[]',
  description       TEXT,
  sort              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS specialist (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT,
  bio          TEXT,
  photo        TEXT,
  external_url TEXT,
  is_resident  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slot (
  id            TEXT PRIMARY KEY,
  hall_id       TEXT NOT NULL REFERENCES hall(id),
  specialist_id TEXT REFERENCES specialist(id),
  weekday       INTEGER NOT NULL,
  time_start    TEXT NOT NULL,
  time_end      TEXT NOT NULL,
  title         TEXT,
  kind          TEXT NOT NULL DEFAULT 'own',
  cta_type      TEXT NOT NULL,
  external_url  TEXT,
  conflict_flag INTEGER NOT NULL DEFAULT 0,
  is_published  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_slot_hall_weekday ON slot (hall_id, weekday);
CREATE INDEX IF NOT EXISTS idx_slot_published ON slot (is_published);

CREATE TABLE IF NOT EXISTS event (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT,
  datetime         TEXT NOT NULL,
  hall_id          TEXT REFERENCES hall(id),
  capacity         INTEGER,
  registered_count INTEGER NOT NULL DEFAULT 0,
  is_published     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS content_page (
  slug             TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  body             TEXT,
  hero_image       TEXT,
  meta_description TEXT,
  updated_at       TEXT NOT NULL
);
