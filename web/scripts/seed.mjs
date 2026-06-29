/**
 * seed.mjs — наполнение демо-данными M2 (T2-1). Идемпотентно: повторный запуск
 * НЕ плодит дубли (стабильные id/slug + upsert в CRUD-модулях).
 *
 * Запуск (из каталога web/):  node scripts/seed.mjs
 * БД берётся из DATABASE_URL (или дефолт db/masterskaya.db от cwd).
 *
 * Никаких реальных выдуманных имён специалистов — все помечены «демо».
 * Ставки/оснащение где нет данных (O2) — «по запросу». Фото = плейсхолдеры.
 * Содержит ОДНУ намеренную пару-конфликт (аренда vs своё занятие, один зал/время)
 * для демонстрации O1: после detectConflicts() own-слот получит conflict_flag=1.
 *
 * Источники модулей — .ts через сборку Astro в рантайме нельзя; поэтому сидер
 * импортирует серверные модули напрямую (Node ESM + tsx не требуется: better-sqlite3
 * — обычный CJS, а наши .ts мы импортируем через динамический import с расширением).
 * Чтобы не зависеть от TS-загрузчика, сидер использует тот же getDb() через
 * скомпилированные-на-лету импорты невозможно — поэтому работаем с БД напрямую SQL,
 * повторяя upsert-семантику модулей. Схему создаёт getDb()-эквивалентный DDL ниже.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';

const DEFAULT_DB_REL = 'db/masterskaya.db';

function resolveDbPath() {
  const url = (process.env.DATABASE_URL || '').trim();
  let rel = DEFAULT_DB_REL;
  if (url) {
    if (url === ':memory:' || url === 'file::memory:') return ':memory:';
    rel = url.startsWith('file:') ? url.slice('file:'.length) : url;
  }
  return isAbsolute(rel) ? rel : resolve(process.cwd(), rel);
}

const path = resolveDbPath();
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const db = new Database(path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// DDL — синхронизирован со schema.sql / db.ts. На случай свежей БД.
db.exec(`
CREATE TABLE IF NOT EXISTS hall (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, area_m2 INTEGER, capacity INTEGER,
  equipment TEXT NOT NULL DEFAULT '[]', rate_hour TEXT, rate_day TEXT,
  rate_subscription TEXT, photos TEXT NOT NULL DEFAULT '[]', description TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS specialist (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT, bio TEXT, photo TEXT,
  external_url TEXT, is_resident INTEGER NOT NULL DEFAULT 0,
  slug TEXT, photo_slot TEXT, directions TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0, is_studio_master INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS slot (
  id TEXT PRIMARY KEY, hall_id TEXT NOT NULL REFERENCES hall(id),
  specialist_id TEXT REFERENCES specialist(id), weekday INTEGER NOT NULL,
  time_start TEXT NOT NULL, time_end TEXT NOT NULL, title TEXT,
  kind TEXT NOT NULL DEFAULT 'own', cta_type TEXT NOT NULL, external_url TEXT,
  conflict_flag INTEGER NOT NULL DEFAULT 0, is_published INTEGER NOT NULL DEFAULT 0,
  conflict_confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_slot_hall_weekday ON slot (hall_id, weekday);
CREATE INDEX IF NOT EXISTS idx_slot_published ON slot (is_published);
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  description TEXT, datetime TEXT NOT NULL, hall_id TEXT REFERENCES hall(id),
  capacity INTEGER, registered_count INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS content_page (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, hero_image TEXT,
  meta_description TEXT, updated_at TEXT NOT NULL
);
`);

const now = new Date().toISOString();

const upsertHall = db.prepare(`
INSERT INTO hall (id, name, area_m2, capacity, equipment, rate_hour, rate_day,
  rate_subscription, photos, description, sort)
VALUES (@id,@name,@area_m2,@capacity,@equipment,@rate_hour,@rate_day,
  @rate_subscription,@photos,@description,@sort)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, area_m2=excluded.area_m2,
  capacity=excluded.capacity, equipment=excluded.equipment, rate_hour=excluded.rate_hour,
  rate_day=excluded.rate_day, rate_subscription=excluded.rate_subscription,
  photos=excluded.photos, description=excluded.description, sort=excluded.sort`);

// Apply column migrations for existing DBs (SQLite has no ADD COLUMN IF NOT EXISTS).
{
  const cols = db.prepare('PRAGMA table_info(specialist)').all().map((c) => c.name);
  if (!cols.includes('slug')) db.exec("ALTER TABLE specialist ADD COLUMN slug TEXT");
  if (!cols.includes('photo_slot')) db.exec("ALTER TABLE specialist ADD COLUMN photo_slot TEXT");
  if (!cols.includes('directions')) db.exec("ALTER TABLE specialist ADD COLUMN directions TEXT NOT NULL DEFAULT '[]'");
  if (!cols.includes('sort')) db.exec("ALTER TABLE specialist ADD COLUMN sort INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes('is_studio_master')) db.exec("ALTER TABLE specialist ADD COLUMN is_studio_master INTEGER NOT NULL DEFAULT 0");
}

const upsertSpec = db.prepare(`
INSERT INTO specialist (id, name, kind, bio, photo, external_url, is_resident,
  slug, photo_slot, directions, sort, is_studio_master)
VALUES (@id,@name,@kind,@bio,@photo,@external_url,@is_resident,
  @slug,@photo_slot,@directions,@sort,@is_studio_master)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, bio=excluded.bio,
  photo=excluded.photo, external_url=excluded.external_url, is_resident=excluded.is_resident,
  slug=excluded.slug, photo_slot=excluded.photo_slot, directions=excluded.directions,
  sort=excluded.sort, is_studio_master=excluded.is_studio_master`);

const upsertSlot = db.prepare(`
INSERT INTO slot (id, hall_id, specialist_id, weekday, time_start, time_end, title,
  kind, cta_type, external_url, conflict_flag, is_published)
VALUES (@id,@hall_id,@specialist_id,@weekday,@time_start,@time_end,@title,
  @kind,@cta_type,@external_url,@conflict_flag,@is_published)
ON CONFLICT(id) DO UPDATE SET hall_id=excluded.hall_id, specialist_id=excluded.specialist_id,
  weekday=excluded.weekday, time_start=excluded.time_start, time_end=excluded.time_end,
  title=excluded.title, kind=excluded.kind, cta_type=excluded.cta_type,
  external_url=excluded.external_url, conflict_flag=excluded.conflict_flag,
  is_published=excluded.is_published`);

const upsertEvent = db.prepare(`
INSERT INTO event (id, slug, title, description, datetime, hall_id, capacity,
  registered_count, is_published)
VALUES (@id,@slug,@title,@description,@datetime,@hall_id,@capacity,@registered_count,@is_published)
ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, title=excluded.title,
  description=excluded.description, datetime=excluded.datetime, hall_id=excluded.hall_id,
  capacity=excluded.capacity, is_published=excluded.is_published`);

const upsertContent = db.prepare(`
INSERT INTO content_page (slug, title, body, hero_image, meta_description, updated_at)
VALUES (@slug,@title,@body,@hero_image,@meta_description,@updated_at)
ON CONFLICT(slug) DO UPDATE SET title=excluded.title,
  meta_description=excluded.meta_description`);
// тело контента (body) НЕ перетираем при повторном сидинге — его наполняет copywriter (T2-3).

const seed = db.transaction(() => {
  // --- Залы (SPEC §2): Большой 70 / Малый 30 / Чайный 45 ---
  upsertHall.run({
    id: 'big-70', name: 'Большой зал', area_m2: 70, capacity: 30,
    equipment: JSON.stringify(['коврики', 'болстеры', 'пледы', 'зеркала']),
    rate_hour: 'по запросу', rate_day: 'по запросу', rate_subscription: 'по запросу',
    photos: JSON.stringify(['/img/placeholders/hall-big.svg']),
    description: 'Просторный светлый зал для групповых практик.', sort: 1,
  });
  upsertHall.run({
    id: 'small-30', name: 'Малый зал', area_m2: 30, capacity: 12,
    equipment: JSON.stringify(['коврики', 'болстеры', 'массажный стол (по запросу)']),
    rate_hour: 'по запросу', rate_day: 'по запросу', rate_subscription: 'по запросу',
    photos: JSON.stringify(['/img/placeholders/hall-small.svg']),
    description: 'Камерный зал для индивидуальной работы и малых групп.', sort: 2,
  });
  upsertHall.run({
    id: 'tea-45', name: 'Чайный зал', area_m2: 45, capacity: 16,
    equipment: JSON.stringify(['чабань', 'подушки для сидения', 'низкие столы']),
    rate_hour: 'по запросу', rate_day: 'по запросу', rate_subscription: 'по запросу',
    photos: JSON.stringify(['/img/placeholders/hall-tea.svg']),
    description: 'Атмосферное пространство для чайных церемоний и медитаций.', sort: 3,
  });

  // --- Специалисты (демо, без реальных имён) ---
  const noMaster = { slug: null, photo_slot: null, directions: '[]', sort: 0, is_studio_master: 0 };
  upsertSpec.run({
    id: 'demo-massage', name: 'Демо-специалист · массаж', kind: 'массаж',
    bio: 'Демо-карточка. Заменит администратор реальными данными.',
    photo: '/img/placeholders/specialist.svg', external_url: null, is_resident: 1,
    ...noMaster,
  });
  upsertSpec.run({
    id: 'demo-psy', name: 'Демо-специалист · психолог', kind: 'психолог',
    bio: 'Демо-карточка. Ведёт по внешней записи.',
    photo: '/img/placeholders/specialist.svg', external_url: 'https://example.com/demo-psy',
    is_resident: 1, ...noMaster,
  });
  upsertSpec.run({
    id: 'demo-yoga', name: 'Демо-преподаватель · йога', kind: 'йога',
    bio: 'Демо-карточка преподавателя направления.',
    photo: '/img/placeholders/specialist.svg', external_url: null, is_resident: 0,
    ...noMaster,
  });

  // --- Мастера студии (TODO — заменить реальными данными) ---
  upsertSpec.run({
    id: 'master-todo-1', name: 'TODO Имя мастера 1', slug: 'master-todo-1', kind: 'йога',
    bio: null, photo: null, external_url: null, is_resident: 1,
    photo_slot: 'master-1', directions: JSON.stringify(['TODO направление']), sort: 1, is_studio_master: 1,
  });
  upsertSpec.run({
    id: 'master-todo-2', name: 'TODO Имя мастера 2', slug: 'master-todo-2', kind: 'практики',
    bio: null, photo: null, external_url: null, is_resident: 1,
    photo_slot: 'master-2', directions: JSON.stringify(['TODO направление']), sort: 2, is_studio_master: 1,
  });

  // --- Слоты ---
  // Нормальные, опубликованные (booking + external CTA).
  upsertSlot.run({
    id: 'slot-yoga-mon', hall_id: 'big-70', specialist_id: 'demo-yoga', weekday: 1,
    time_start: '10:00', time_end: '11:30', title: 'Хатха-йога (демо)',
    kind: 'own', cta_type: 'booking', external_url: null,
    conflict_flag: 0, is_published: 1,
  });
  upsertSlot.run({
    id: 'slot-psy-wed', hall_id: 'small-30', specialist_id: 'demo-psy', weekday: 3,
    time_start: '15:00', time_end: '16:00', title: 'Консультация психолога (демо)',
    kind: 'own', cta_type: 'external', external_url: 'https://example.com/demo-psy',
    conflict_flag: 0, is_published: 1,
  });

  // НАМЕРЕННАЯ ПАРА-КОНФЛИКТ (демонстрация O1): один зал big-70, weekday 2 (вт),
  // аренда 18:00–20:00 пересекается со «своим занятием» 19:00–21:00.
  // detectConflicts() пометит own-слот conflict_flag=1, is_published=0.
  upsertSlot.run({
    id: 'slot-arenda-tue-evening', hall_id: 'big-70', specialist_id: 'demo-massage', weekday: 2,
    time_start: '18:00', time_end: '20:00', title: 'Аренда: вечерний блок (демо)',
    kind: 'arenda', cta_type: 'external', external_url: 'https://example.com/demo-arenda',
    conflict_flag: 0, is_published: 1,
  });
  upsertSlot.run({
    id: 'slot-own-tue-evening', hall_id: 'big-70', specialist_id: 'demo-yoga', weekday: 2,
    time_start: '19:00', time_end: '21:00', title: 'Своё занятие: вечерняя йога (демо)',
    kind: 'own', cta_type: 'booking', external_url: null,
    conflict_flag: 0, is_published: 1, // detectConflicts снимет публикацию
  });

  // --- События ---
  upsertEvent.run({
    id: 'evt-tea-ceremony', slug: 'chajnaja-ceremonija-demo', title: 'Чайная церемония (демо)',
    description: 'Демо-событие. Замените реальными данными в админке.',
    datetime: '2026-09-13T18:00:00.000Z', hall_id: 'tea-45', capacity: 16,
    registered_count: 0, is_published: 1,
  });
  upsertEvent.run({
    id: 'evt-sound-meditation', slug: 'zvukovaja-meditacija-demo', title: 'Звуковая медитация (демо)',
    description: 'Демо-событие.',
    datetime: '2026-09-20T19:00:00.000Z', hall_id: 'big-70', capacity: 24,
    registered_count: 0, is_published: 0,
  });

  // --- Контент-заготовки (body пустой/TODO — наполнит copywriter T2-3) ---
  const pages = [
    ['napravleniya', 'Направления йоги'],
    ['praktiki', 'Практики'],
    ['chaynaya', 'Чайная'],
    ['tury', 'Йога-туры'],
    ['psiholog', 'Консультация психолога'],
  ];
  for (const [slug, title] of pages) {
    upsertContent.run({
      slug, title, body: '<!-- TODO: текст наполнит copywriter (T2-3) -->',
      hero_image: '/img/placeholders/hero.svg',
      meta_description: `${title} — центр практик «Мастерская».`,
      updated_at: now,
    });
  }
});

seed();

const counts = {
  hall: db.prepare('SELECT COUNT(*) c FROM hall').get().c,
  specialist: db.prepare('SELECT COUNT(*) c FROM specialist').get().c,
  slot: db.prepare('SELECT COUNT(*) c FROM slot').get().c,
  event: db.prepare('SELECT COUNT(*) c FROM event').get().c,
  content_page: db.prepare('SELECT COUNT(*) c FROM content_page').get().c,
};
db.close();

console.log('seed.mjs: готово (идемпотентно). Записи:', counts);
console.log('Подсказка: для O1 запустите detectConflicts() — own-слот');
console.log('  slot-own-tue-evening получит conflict_flag=1, is_published=0.');
