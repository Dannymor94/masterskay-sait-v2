/**
 * db.ts — открытие и инициализация SQLite (домен данных).
 *
 * Инварианты:
 *  - DB-путь из DATABASE_URL (формат `file:./db/masterskaya.db`); префикс `file:` снимаем.
 *    Дефолт — <cwd>/db/masterskaya.db. Работает БЕЗ .env (его заводит человек, CLAUDE.md §2).
 *  - Идемпотентная инициализация схемы: CREATE TABLE IF NOT EXISTS (DDL встроен константой).
 *  - SQLite сейчас, схема Postgres-ready (см. db/schema.sql).
 *
 * ВАЖНО (прод-фикс): после бандла (`astro build`) модуль уезжает в dist/server/.
 * Любая привязка путей к import.meta.url ломается (ENOENT для db/schema.sql и
 * неверный дефолтный путь БД). Поэтому:
 *  - DDL держим строковой константой и НЕ читаем файл в рантайме;
 *  - относительные пути БД резолвим от process.cwd() (каталог запуска сервера = web/),
 *    а не от расположения модуля.
 *
 * Инстанс кэшируется по разрешённому пути (один коннект на путь в процессе).
 * В тестах DATABASE_URL указывает на временный файл + vi.resetModules() → свежий коннект.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { logError } from './logger.ts';

export type Db = Database.Database;

/**
 * DDL домена LEADS, встроенный в код (без чтения файла в рантайме).
 *
 * Источник истины для свежей БД и Postgres-миграций — web/db/schema.sql и
 * web/db/migrations/0001_init.sql. Эта константа ДОЛЖНА совпадать с ними:
 * любую правку схемы синхронизировать во всех трёх местах.
 */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS lead (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'new',
  source_page TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_type_created ON lead (type, created_at);
`;

/**
 * DDL домена M2 (schedule/events/content), встроенный в код.
 *
 * Источник истины для свежей БД и Postgres-миграций — web/db/schema.sql и
 * web/db/migrations/0002_m2.sql. Эта константа ДОЛЖНА совпадать с ними.
 *
 * Postgres-соответствия:
 *  - INTEGER 0/1 (булевы)            -> boolean
 *  - TEXT с JSON (equipment/photos)  -> jsonb
 *  - TEXT(ISO даты, updated_at)      -> timestamptz DEFAULT now()
 *  - rate_* TEXT                     -> text (значение «по запросу» или число строкой; O2 пусто)
 *  - weekday/time_* — INTEGER/TEXT('HH:MM') как есть.
 */
const SCHEMA_DDL_M2 = `
CREATE TABLE IF NOT EXISTS hall (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  area_m2           INTEGER,
  capacity          INTEGER,
  equipment         TEXT NOT NULL DEFAULT '[]',   -- JSON-массив строк. PG: jsonb / text[]
  rate_hour         TEXT,                          -- «по запросу»/число строкой (O2)
  rate_day          TEXT,
  rate_subscription TEXT,
  photos            TEXT NOT NULL DEFAULT '[]',   -- JSON-массив путей. PG: jsonb
  description       TEXT,
  sort              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS specialist (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT,                               -- 'массаж'|'психолог'|…
  bio             TEXT,
  photo           TEXT,
  external_url    TEXT,
  is_resident     INTEGER NOT NULL DEFAULT 0,         -- 0/1. PG: boolean
  slug            TEXT,                               -- kebab URL-slug for /mastera/[slug]
  photo_slot      TEXT,                               -- data-photo-slot placeholder key
  directions      TEXT NOT NULL DEFAULT '[]',         -- JSON-array of direction strings. PG: jsonb
  sort            INTEGER NOT NULL DEFAULT 0,         -- display order
  is_studio_master INTEGER NOT NULL DEFAULT 0         -- 0/1: studio master vs external. PG: boolean
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_specialist_slug ON specialist(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS slot (
  id            TEXT PRIMARY KEY,
  hall_id       TEXT NOT NULL REFERENCES hall(id),
  specialist_id TEXT REFERENCES specialist(id),
  weekday       INTEGER NOT NULL,                  -- 1..7 (пн..вс)
  time_start    TEXT NOT NULL,                     -- 'HH:MM'
  time_end      TEXT NOT NULL,                     -- 'HH:MM'
  title         TEXT,
  kind          TEXT NOT NULL DEFAULT 'own',       -- 'own' | 'arenda' (для O1-приоритета)
  cta_type      TEXT NOT NULL,                     -- 'booking' | 'external'
  external_url  TEXT,                              -- обязателен при cta_type='external'
  conflict_flag INTEGER NOT NULL DEFAULT 0,        -- 0/1. PG: boolean
  is_published  INTEGER NOT NULL DEFAULT 0,        -- 0/1. PG: boolean
  conflict_confirmed INTEGER NOT NULL DEFAULT 0    -- 0/1. PG: boolean. M2-QA-1: ручное подтверждение публикации конфликта
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
`;

const DEFAULT_DB_REL = 'db/masterskaya.db'; // от cwd (web/)

/** Разрешает путь к файлу БД из DATABASE_URL (снимая префикс file:) или дефолт. */
function resolveDbPath(): string {
  const url = process.env.DATABASE_URL?.trim();
  const rel = (() => {
    if (!url) return DEFAULT_DB_REL;
    if (url === ':memory:' || url === 'file::memory:') return ':memory:';
    return url.startsWith('file:') ? url.slice('file:'.length) : url;
  })();

  if (rel === ':memory:') return ':memory:';
  // Абсолютный путь — как есть; относительный — от cwd (каталог запуска сервера).
  return isAbsolute(rel) ? rel : resolve(process.cwd(), rel);
}

/**
 * Безопасный ADD COLUMN для существующих БД (idempotent).
 * SQLite не поддерживает ADD COLUMN IF NOT EXISTS, поэтому проверяем наличие
 * столбца через PRAGMA table_info. Если нет — добавляем. Если есть (свежая БД,
 * где DDL уже создал столбец) — пропускаем. Постгрес-эквиваленты — в migrations/.
 */
function ensureColumn(db: Db, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** Идемпотентные миграции столбцов поверх CREATE TABLE IF NOT EXISTS. */
function applyColumnMigrations(db: Db): void {
  // 0003: slot.conflict_confirmed — ручное подтверждение публикации конфликта (M2-QA-1).
  ensureColumn(db, 'slot', 'conflict_confirmed', 'conflict_confirmed INTEGER NOT NULL DEFAULT 0');
  // 0004: specialist — новые поля мастеров студии (T-master-1).
  ensureColumn(db, 'specialist', 'slug', 'slug TEXT');
  ensureColumn(db, 'specialist', 'photo_slot', 'photo_slot TEXT');
  ensureColumn(db, 'specialist', 'directions', "directions TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'specialist', 'sort', 'sort INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'specialist', 'is_studio_master', 'is_studio_master INTEGER NOT NULL DEFAULT 0');
}

let cachedPath: string | null = null;
let cachedDb: Db | null = null;

/** Возвращает инициализированный инстанс БД (один на путь в процессе). */
export function getDb(): Db {
  const path = resolveDbPath();
  if (cachedDb && cachedPath === path) return cachedDb;

  try {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Идемпотентная инициализация схемы из встроенного DDL (LEADS + M2).
    db.exec(SCHEMA_DDL);
    db.exec(SCHEMA_DDL_M2);
    // Миграции «по месту» для СУЩЕСТВУЮЩИХ БД, где CREATE TABLE IF NOT EXISTS уже
    // не выполнится (таблица есть, но без новых столбцов). На свежей БД эти ALTER —
    // no-op (столбец уже создан DDL выше → ловим ошибку «duplicate column» и пропускаем).
    applyColumnMigrations(db);

    cachedDb = db;
    cachedPath = path;
    return db;
  } catch (err) {
    logError('db/getDb', err, { dbPath: path });
    throw err;
  }
}
