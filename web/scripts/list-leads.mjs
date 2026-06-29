#!/usr/bin/env node
/**
 * list-leads.mjs — локальный просмотр лидов для Антона (CLI, без публичного GET).
 *
 * Зачем CLI, а не эндпоинт: лиды содержат ПДн (имя/контакт). Публичный GET их бы
 * светил. Просмотр — только локально, у того, кто имеет доступ к серверу/БД.
 *
 * Использование (из каталога web/):
 *   node scripts/list-leads.mjs            # все лиды, новые сверху
 *   node scripts/list-leads.mjs arenda     # только тип arenda
 *
 * БД: DATABASE_URL (формат file:./db/masterskaya.db) или дефолт web/db/masterskaya.db.
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // web/scripts
const DEFAULT_DB = resolve(here, '../db/masterskaya.db'); // web/db/masterskaya.db

function resolveDbPath() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return DEFAULT_DB;
  const raw = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return resolve(here, '..', raw.replace(/^\.\//, '')); // от web/
}

const typeFilter = process.argv[2];
const dbPath = resolveDbPath();

if (!existsSync(dbPath)) {
  console.error(`БД не найдена: ${dbPath}`);
  console.error('Лидов ещё нет (форма не присылала заявок) или путь DATABASE_URL другой.');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

const rows = typeFilter
  ? db
      .prepare('SELECT * FROM lead WHERE type = ? ORDER BY created_at DESC')
      .all(typeFilter)
  : db.prepare('SELECT * FROM lead ORDER BY created_at DESC').all();

if (rows.length === 0) {
  console.log(typeFilter ? `Лидов типа "${typeFilter}" нет.` : 'Лидов пока нет.');
  process.exit(0);
}

console.log(`Лидов: ${rows.length}${typeFilter ? ` (тип: ${typeFilter})` : ''}\n`);

for (const r of rows) {
  let payload = r.payload;
  try {
    payload = JSON.stringify(JSON.parse(r.payload), null, 2);
  } catch {
    /* оставляем как есть */
  }
  console.log('─'.repeat(60));
  console.log(`id:         ${r.id}`);
  console.log(`type:       ${r.type}`);
  console.log(`status:     ${r.status}`);
  console.log(`name:       ${r.name}`);
  console.log(`contact:    ${r.contact}`);
  console.log(`source:     ${r.source_page ?? ''}`);
  console.log(`created_at: ${r.created_at}`);
  console.log(`payload:    ${payload}`);
}
console.log('─'.repeat(60));
