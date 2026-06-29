#!/usr/bin/env node
/**
 * load-content.mjs — загрузка/обновление контент-страниц из markdown в content_page.
 *
 * Читает web/src/content/*.md (кроме arenda.md — лендинг аренды собирается отдельно
 * во фронте, не из content_page), парсит YAML-подобный фронтматтер
 * (slug, title, meta_description, hero_image) и тело markdown, апсертит в content_page
 * через createContent/updateContent (домен CONTENT). Идемпотентно по slug:
 * повторный запуск перезаписывает body/meta из файла, не плодит строк.
 *
 * Зачем отдельный лоадер (а не seed.mjs): seed заливает только slug/title/meta и
 * НЕ перетирает body (заглушка под copywriter). Этот скрипт заливает РЕАЛЬНЫЙ body
 * из .md, который написал copywriter (T2-3). Запускать после правок контента.
 *
 * Использование (из каталога web/):
 *   node scripts/load-content.mjs
 *
 * БД: DATABASE_URL (file:./db/masterskaya.db) или дефолт web/db/masterskaya.db.
 * Запись только в локальную БД — никаких внешних систем (CLAUDE.md §4).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // web/scripts
const CONTENT_DIR = resolve(here, '../src/content/source'); // web/src/content/source

// Лендинг аренды — НЕ контент-страница (своя страница /arenda во фронте). Пропускаем.
const SKIP = new Set(['arenda.md']);

/**
 * Парсит фронтматтер вида:
 *   ---
 *   key: value
 *   ---
 *   <body>
 * Значения — строки до конца строки; завершающие inline-комментарии (` # ...`)
 * для hero_image отрезаем (в .md они помечают TODO-плейсхолдеры).
 */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) {
    return { data: {}, body: raw.trim() };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw.trim() };

  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, '').trimEnd();

  const data = {};
  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Снимаем кавычки, если есть.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[m[1]] = value;
  }

  // hero_image: отрезаем хвостовой inline-комментарий «  # TODO …» (путь без пробелов).
  if (typeof data.hero_image === 'string') {
    data.hero_image = data.hero_image.replace(/\s+#.*$/, '').trim();
  }
  return { data, body };
}

async function main() {
  // .ts-модуль content.ts (createContent) напрямую из .mjs без сборки не импортируется,
  // поэтому повторяем тот же upsert-семантику (ON CONFLICT(slug) DO UPDATE) на
  // better-sqlite3. SQL идентичен createContent (домен CONTENT) — источник истины тот же.
  const { default: Database } = await import('better-sqlite3');

  const url = process.env.DATABASE_URL?.trim();
  const rel = !url
    ? 'db/masterskaya.db'
    : url.startsWith('file:')
      ? url.slice('file:'.length)
      : url;
  const dbPath = rel === ':memory:' ? ':memory:' : resolve(here, '..', rel.replace(/^\.\//, ''));

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // content_page может ещё не существовать, если БД свежая и не было getDb().
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_page (
      slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT,
      hero_image TEXT, meta_description TEXT, updated_at TEXT NOT NULL
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO content_page (slug, title, body, hero_image, meta_description, updated_at)
    VALUES (@slug, @title, @body, @hero_image, @meta_description, @updated_at)
    ON CONFLICT(slug) DO UPDATE SET
      title=excluded.title, body=excluded.body, hero_image=excluded.hero_image,
      meta_description=excluded.meta_description, updated_at=excluded.updated_at
  `);

  const files = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.md') && !SKIP.has(f))
    .sort();

  let loaded = 0;
  const now = new Date().toISOString();
  for (const file of files) {
    const raw = readFileSync(resolve(CONTENT_DIR, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const slug = (data.slug || basename(file, '.md')).trim();
    const title = (data.title || slug).trim();
    if (!slug || !title) {
      console.warn(`  ⚠ пропуск ${file}: нет slug/title`);
      continue;
    }
    upsert.run({
      slug,
      title,
      body: body || null,
      hero_image: data.hero_image || null,
      meta_description: data.meta_description || null,
      updated_at: now,
    });
    const bodyLen = (body || '').length;
    console.log(`  ✓ ${slug.padEnd(16)} «${title}»  body: ${bodyLen} симв.`);
    loaded += 1;
  }

  console.log(`\nЗагружено страниц: ${loaded} (из ${files.length} .md, без arenda.md)`);
  db.close();
}

main().catch((e) => {
  console.error('Ошибка load-content:', e);
  process.exit(1);
});
