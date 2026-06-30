/**
 * halls.ts — домен SCHEDULE (залы). CRUD + детерминированная валидация.
 *
 * Залы заводит администратор (не пользователь), поэтому дедупа по idempotency_key
 * нет — id стабильный (slug-подобный), повтор create с тем же id это ошибка/конфликт.
 * Сидер использует upsert (ON CONFLICT DO UPDATE), чтобы быть идемпотентным.
 *
 * JSON-поля equipment/photos хранятся как TEXT(JSON); наружу отдаём распарсенными.
 */
import { getDb } from './db.ts';

export type HallInput = {
  id: string;
  name: string;
  area_m2?: number | null;
  capacity?: number | null;
  equipment?: string[];
  rate_hour?: string | null;
  rate_day?: string | null;
  rate_subscription?: string | null;
  photos?: string[];
  description?: string | null;
  sort?: number;
  photo_url?: string | null;
};

export type HallRow = {
  id: string;
  name: string;
  area_m2: number | null;
  capacity: number | null;
  equipment: string[];
  rate_hour: string | null;
  rate_day: string | null;
  rate_subscription: string | null;
  photos: string[];
  description: string | null;
  sort: number;
  photo_url: string | null;
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function validateHall(input: Partial<HallInput>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!s(input.id)) errors.id = 'Укажите идентификатор зала.';
  if (!s(input.name)) errors.name = 'Укажите название зала.';
  if (input.area_m2 != null && (!Number.isFinite(input.area_m2) || input.area_m2 < 0))
    errors.area_m2 = 'Площадь — неотрицательное число.';
  if (input.capacity != null && (!Number.isFinite(input.capacity) || input.capacity < 0))
    errors.capacity = 'Вместимость — неотрицательное число.';
  return { ok: Object.keys(errors).length === 0, errors };
}

function mapRow(r: any): HallRow {
  return {
    id: r.id,
    name: r.name,
    area_m2: r.area_m2,
    capacity: r.capacity,
    equipment: JSON.parse(r.equipment || '[]'),
    rate_hour: r.rate_hour,
    rate_day: r.rate_day,
    rate_subscription: r.rate_subscription,
    photos: JSON.parse(r.photos || '[]'),
    description: r.description,
    sort: r.sort,
    photo_url: r.photo_url ?? null,
  };
}

/** Создаёт зал. Идемпотентно по id: повтор с тем же id обновляет (upsert). */
export function createHall(input: HallInput): HallRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO hall (id, name, area_m2, capacity, equipment, rate_hour, rate_day,
       rate_subscription, photos, description, sort, photo_url)
     VALUES (@id, @name, @area_m2, @capacity, @equipment, @rate_hour, @rate_day,
       @rate_subscription, @photos, @description, @sort, @photo_url)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, area_m2=excluded.area_m2, capacity=excluded.capacity,
       equipment=excluded.equipment, rate_hour=excluded.rate_hour, rate_day=excluded.rate_day,
       rate_subscription=excluded.rate_subscription, photos=excluded.photos,
       description=excluded.description, sort=excluded.sort, photo_url=excluded.photo_url`,
  ).run({
    id: s(input.id),
    name: s(input.name),
    area_m2: input.area_m2 ?? null,
    capacity: input.capacity ?? null,
    equipment: JSON.stringify(input.equipment ?? []),
    rate_hour: input.rate_hour ?? null,
    rate_day: input.rate_day ?? null,
    rate_subscription: input.rate_subscription ?? null,
    photos: JSON.stringify(input.photos ?? []),
    description: input.description ?? null,
    sort: input.sort ?? 0,
    photo_url: input.photo_url ?? null,
  });
  return getHall(s(input.id))!;
}

export function getHall(id: string): HallRow | undefined {
  const row = getDb().prepare('SELECT * FROM hall WHERE id = ?').get(id);
  return row ? mapRow(row) : undefined;
}

export function listHalls(): HallRow[] {
  return (getDb().prepare('SELECT * FROM hall ORDER BY sort, name').all() as any[]).map(mapRow);
}

/** Частичное обновление зала. Возвращает обновлённую строку или undefined. */
export function updateHall(id: string, patch: Partial<HallInput>): HallRow | undefined {
  const cur = getHall(id);
  if (!cur) return undefined;
  const merged: HallInput = {
    id,
    name: patch.name ?? cur.name,
    area_m2: patch.area_m2 !== undefined ? patch.area_m2 : cur.area_m2,
    capacity: patch.capacity !== undefined ? patch.capacity : cur.capacity,
    equipment: patch.equipment ?? cur.equipment,
    rate_hour: patch.rate_hour !== undefined ? patch.rate_hour : cur.rate_hour,
    rate_day: patch.rate_day !== undefined ? patch.rate_day : cur.rate_day,
    rate_subscription:
      patch.rate_subscription !== undefined ? patch.rate_subscription : cur.rate_subscription,
    photos: patch.photos ?? cur.photos,
    description: patch.description !== undefined ? patch.description : cur.description,
    sort: patch.sort !== undefined ? patch.sort : cur.sort,
    photo_url: patch.photo_url !== undefined ? patch.photo_url : cur.photo_url,
  };
  return createHall(merged);
}

/** Удаляет зал. Возвращает true, если строка была удалена. */
export function removeHall(id: string): boolean {
  return getDb().prepare('DELETE FROM hall WHERE id = ?').run(id).changes > 0;
}
