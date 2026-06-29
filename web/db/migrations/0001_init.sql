-- 0001_init.sql — первая миграция домена LEADS (T1-1, стадия M1).
-- Тот же DDL, что в db/schema.sql (источник истины для свежей БД — schema.sql,
-- миграции — для пошаговой эволюции существующей БД; на M1 они совпадают).
--
-- Postgres-соответствия: payload TEXT(JSON) -> jsonb;
--   created_at TEXT(ISO) -> timestamptz DEFAULT now(); status DEFAULT 'new'.

CREATE TABLE IF NOT EXISTS lead (
  id          TEXT PRIMARY KEY,            -- = idempotency_key (UUID). PG: text (или uuid)
  type        TEXT NOT NULL,               -- 'arenda' | 'visit' | 'event'
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',  -- JSON-текст. PG: jsonb DEFAULT '{}'::jsonb
  status      TEXT NOT NULL DEFAULT 'new',
  source_page TEXT,
  created_at  TEXT NOT NULL                -- ISO-8601. PG: timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_type_created ON lead (type, created_at);
