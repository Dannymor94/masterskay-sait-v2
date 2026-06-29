/**
 * events.ts — домен EVENTS. CRUD событий + атомарный учёт регистраций.
 *
 * Заводит администратор; create идемпотентен по id (upsert), slug — UNIQUE.
 * registered_count наращивается атомарно при регистрации лида (T2-4):
 * registerSeats() в одной транзакции проверяет capacity и увеличивает счётчик.
 * Дедуп самой регистрации (один idempotency_key → один лид) — на стороне лидов.
 */
import { getDb } from './db.ts';

export type EventInput = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  datetime: string; // ISO-8601
  hall_id?: string | null;
  capacity?: number | null;
  registered_count?: number;
  is_published?: boolean | number;
};

export type EventRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  datetime: string;
  hall_id: string | null;
  capacity: number | null;
  registered_count: number;
  is_published: number; // 0/1
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const bit = (v: unknown): number => (v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateEvent(input: Partial<EventInput>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!s(input.id)) errors.id = 'Укажите идентификатор события.';
  if (!s(input.slug)) errors.slug = 'Укажите slug.';
  else if (!SLUG_RE.test(s(input.slug))) errors.slug = 'Slug — латиница, цифры и дефисы.';
  if (!s(input.title)) errors.title = 'Укажите название события.';
  if (!s(input.datetime)) errors.datetime = 'Укажите дату и время.';
  else if (Number.isNaN(Date.parse(s(input.datetime))))
    errors.datetime = 'Дата/время — формат ISO-8601.';
  if (input.capacity != null && (!Number.isFinite(input.capacity) || input.capacity < 0))
    errors.capacity = 'Вместимость — неотрицательное число.';
  return { ok: Object.keys(errors).length === 0, errors };
}

function mapRow(r: any): EventRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    datetime: r.datetime,
    hall_id: r.hall_id,
    capacity: r.capacity,
    registered_count: r.registered_count,
    is_published: r.is_published,
  };
}

export function createEvent(input: EventInput): EventRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO event (id, slug, title, description, datetime, hall_id, capacity,
       registered_count, is_published)
     VALUES (@id, @slug, @title, @description, @datetime, @hall_id, @capacity,
       @registered_count, @is_published)
     ON CONFLICT(id) DO UPDATE SET
       slug=excluded.slug, title=excluded.title, description=excluded.description,
       datetime=excluded.datetime, hall_id=excluded.hall_id, capacity=excluded.capacity,
       registered_count=excluded.registered_count, is_published=excluded.is_published`,
  ).run({
    id: s(input.id),
    slug: s(input.slug),
    title: s(input.title),
    description: input.description ?? null,
    datetime: s(input.datetime),
    hall_id: input.hall_id ?? null,
    capacity: input.capacity ?? null,
    registered_count: input.registered_count ?? 0,
    is_published: bit(input.is_published),
  });
  return getEvent(s(input.id))!;
}

export function getEvent(id: string): EventRow | undefined {
  const row = getDb().prepare('SELECT * FROM event WHERE id = ?').get(id);
  return row ? mapRow(row) : undefined;
}

export function getEventBySlug(slug: string): EventRow | undefined {
  const row = getDb().prepare('SELECT * FROM event WHERE slug = ?').get(slug);
  return row ? mapRow(row) : undefined;
}

export function listEvents(): EventRow[] {
  return (getDb().prepare('SELECT * FROM event ORDER BY datetime').all() as any[]).map(mapRow);
}

export function updateEvent(id: string, patch: Partial<EventInput>): EventRow | undefined {
  const cur = getEvent(id);
  if (!cur) return undefined;
  return createEvent({
    id,
    slug: patch.slug ?? cur.slug,
    title: patch.title ?? cur.title,
    description: patch.description !== undefined ? patch.description : cur.description,
    datetime: patch.datetime ?? cur.datetime,
    hall_id: patch.hall_id !== undefined ? patch.hall_id : cur.hall_id,
    capacity: patch.capacity !== undefined ? patch.capacity : cur.capacity,
    registered_count:
      patch.registered_count !== undefined ? patch.registered_count : cur.registered_count,
    is_published: patch.is_published !== undefined ? bit(patch.is_published) : cur.is_published,
  });
}

export function removeEvent(id: string): boolean {
  return getDb().prepare('DELETE FROM event WHERE id = ?').run(id).changes > 0;
}

/**
 * Атомарно резервирует места под событие (для T2-4: рост registered_count при
 * создании лида-регистрации). Не превышает capacity (если задана). Возвращает
 * {ok, registered_count}. Сам дедуп регистрации — на стороне лидов (idempotency_key).
 */
export function registerSeats(eventId: string, count: number): { ok: boolean; registered_count: number } {
  const db = getDb();
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const txn = db.transaction(() => {
    const ev = getEvent(eventId);
    if (!ev) return { ok: false, registered_count: 0 };
    if (ev.capacity != null && ev.registered_count + n > ev.capacity) {
      return { ok: false, registered_count: ev.registered_count };
    }
    db.prepare('UPDATE event SET registered_count = registered_count + ? WHERE id = ?').run(
      n,
      eventId,
    );
    return { ok: true, registered_count: ev.registered_count + n };
  });
  return txn();
}
