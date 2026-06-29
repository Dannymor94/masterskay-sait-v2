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
  slug?: string | null;
  photo_slot?: string | null;
  directions?: string[] | string | null; // array stored as JSON; string accepted as-is
  sort?: number | null;
  is_studio_master?: boolean | number;
};

export type SpecialistRow = {
  id: string;
  name: string;
  kind: string | null;
  bio: string | null;
  photo: string | null;
  external_url: string | null;
  is_resident: number; // 0/1
  slug: string | null;
  photo_slot: string | null;
  directions: string[]; // deserialized from JSON
  sort: number;
  is_studio_master: number; // 0/1
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const bit = (v: unknown): number => (v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0);

/** Serialize directions to JSON string for storage. */
function serializeDirections(d: string[] | string | null | undefined): string {
  if (!d) return '[]';
  if (Array.isArray(d)) return JSON.stringify(d);
  // Assume already a JSON string
  return d;
}

/** Deserialize directions JSON string to array. */
function parseDirections(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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
    slug: r.slug ?? null,
    photo_slot: r.photo_slot ?? null,
    directions: parseDirections(r.directions),
    sort: r.sort ?? 0,
    is_studio_master: r.is_studio_master ?? 0,
  };
}

export function createSpecialist(input: SpecialistInput): SpecialistRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO specialist
       (id, name, kind, bio, photo, external_url, is_resident,
        slug, photo_slot, directions, sort, is_studio_master)
     VALUES
       (@id, @name, @kind, @bio, @photo, @external_url, @is_resident,
        @slug, @photo_slot, @directions, @sort, @is_studio_master)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, bio=excluded.bio, photo=excluded.photo,
       external_url=excluded.external_url, is_resident=excluded.is_resident,
       slug=excluded.slug, photo_slot=excluded.photo_slot, directions=excluded.directions,
       sort=excluded.sort, is_studio_master=excluded.is_studio_master`,
  ).run({
    id: s(input.id),
    name: s(input.name),
    kind: input.kind ?? null,
    bio: input.bio ?? null,
    photo: input.photo ?? null,
    external_url: input.external_url ?? null,
    is_resident: bit(input.is_resident),
    slug: input.slug ?? null,
    photo_slot: input.photo_slot ?? null,
    directions: serializeDirections(input.directions),
    sort: input.sort ?? 0,
    is_studio_master: bit(input.is_studio_master),
  });
  return getSpecialist(s(input.id))!;
}

export function getSpecialist(id: string): SpecialistRow | undefined {
  const row = getDb().prepare('SELECT * FROM specialist WHERE id = ?').get(id);
  return row ? mapRow(row) : undefined;
}

export function getSpecialistBySlug(slug: string): SpecialistRow | undefined {
  const row = getDb().prepare('SELECT * FROM specialist WHERE slug = ?').get(slug);
  return row ? mapRow(row) : undefined;
}

export function listSpecialists(): SpecialistRow[] {
  return (getDb().prepare('SELECT * FROM specialist ORDER BY name').all() as any[]).map(mapRow);
}

export function listStudioMasters(): SpecialistRow[] {
  return (
    getDb()
      .prepare('SELECT * FROM specialist WHERE is_studio_master = 1 ORDER BY sort, name')
      .all() as any[]
  ).map(mapRow);
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
    slug: patch.slug !== undefined ? patch.slug : cur.slug,
    photo_slot: patch.photo_slot !== undefined ? patch.photo_slot : cur.photo_slot,
    directions: patch.directions !== undefined ? patch.directions : cur.directions,
    sort: patch.sort !== undefined ? patch.sort : cur.sort,
    is_studio_master:
      patch.is_studio_master !== undefined ? bit(patch.is_studio_master) : cur.is_studio_master,
  });
}

export function removeSpecialist(id: string): boolean {
  return getDb().prepare('DELETE FROM specialist WHERE id = ?').run(id).changes > 0;
}
