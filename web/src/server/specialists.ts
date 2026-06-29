/**
 * specialists.ts — домен SCHEDULE (специалисты/резиденты). CRUD + валидация.
 *
 * Заводит администратор. id стабильный, create идемпотентен по id (upsert),
 * чтобы сидер не плодил дубли.
 */
import { getDb } from './db.ts';

export type SpecialistInput = {
  id: string;
  name: string;
  kind?: string | null;
  bio?: string | null;
  photo?: string | null;
  external_url?: string | null;
  is_resident?: boolean | number;
};

export type SpecialistRow = {
  id: string;
  name: string;
  kind: string | null;
  bio: string | null;
  photo: string | null;
  external_url: string | null;
  is_resident: number; // 0/1
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const bit = (v: unknown): number => (v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0);

export function validateSpecialist(input: Partial<SpecialistInput>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!s(input.id)) errors.id = 'Укажите идентификатор специалиста.';
  if (!s(input.name)) errors.name = 'Укажите имя/название.';
  return { ok: Object.keys(errors).length === 0, errors };
}

function mapRow(r: any): SpecialistRow {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    bio: r.bio,
    photo: r.photo,
    external_url: r.external_url,
    is_resident: r.is_resident,
  };
}

export function createSpecialist(input: SpecialistInput): SpecialistRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO specialist (id, name, kind, bio, photo, external_url, is_resident)
     VALUES (@id, @name, @kind, @bio, @photo, @external_url, @is_resident)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, bio=excluded.bio, photo=excluded.photo,
       external_url=excluded.external_url, is_resident=excluded.is_resident`,
  ).run({
    id: s(input.id),
    name: s(input.name),
    kind: input.kind ?? null,
    bio: input.bio ?? null,
    photo: input.photo ?? null,
    external_url: input.external_url ?? null,
    is_resident: bit(input.is_resident),
  });
  return getSpecialist(s(input.id))!;
}

export function getSpecialist(id: string): SpecialistRow | undefined {
  const row = getDb().prepare('SELECT * FROM specialist WHERE id = ?').get(id);
  return row ? mapRow(row) : undefined;
}

export function listSpecialists(): SpecialistRow[] {
  return (getDb().prepare('SELECT * FROM specialist ORDER BY name').all() as any[]).map(mapRow);
}

export function updateSpecialist(
  id: string,
  patch: Partial<SpecialistInput>,
): SpecialistRow | undefined {
  const cur = getSpecialist(id);
  if (!cur) return undefined;
  return createSpecialist({
    id,
    name: patch.name ?? cur.name,
    kind: patch.kind !== undefined ? patch.kind : cur.kind,
    bio: patch.bio !== undefined ? patch.bio : cur.bio,
    photo: patch.photo !== undefined ? patch.photo : cur.photo,
    external_url: patch.external_url !== undefined ? patch.external_url : cur.external_url,
    is_resident: patch.is_resident !== undefined ? bit(patch.is_resident) : cur.is_resident,
  });
}

export function removeSpecialist(id: string): boolean {
  return getDb().prepare('DELETE FROM specialist WHERE id = ?').run(id).changes > 0;
}
