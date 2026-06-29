/**
 * content.ts — домен CONTENT (контент-страницы). CRUD по slug (PK).
 *
 * Заводит администратор/копирайтер. id = slug, upsert идемпотентен.
 * updated_at — ISO-строка, выставляется кодом при каждой записи (PG: DEFAULT now()).
 */
import { getDb } from './db.ts';

export type ContentInput = {
  slug: string;
  title: string;
  body?: string | null;
  hero_image?: string | null;
  meta_description?: string | null;
};

export type ContentRow = {
  slug: string;
  title: string;
  body: string | null;
  hero_image: string | null;
  meta_description: string | null;
  updated_at: string;
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const SLUG_RE = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/;

export function validateContent(input: Partial<ContentInput>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!s(input.slug)) errors.slug = 'Укажите slug.';
  else if (!SLUG_RE.test(s(input.slug))) errors.slug = 'Slug — латиница, цифры, дефис/слэш.';
  if (!s(input.title)) errors.title = 'Укажите заголовок страницы.';
  return { ok: Object.keys(errors).length === 0, errors };
}

function mapRow(r: any): ContentRow {
  return {
    slug: r.slug,
    title: r.title,
    body: r.body,
    hero_image: r.hero_image,
    meta_description: r.meta_description,
    updated_at: r.updated_at,
  };
}

/** Создаёт/обновляет контент-страницу. Идемпотентно по slug; обновляет updated_at. */
export function createContent(input: ContentInput): ContentRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO content_page (slug, title, body, hero_image, meta_description, updated_at)
     VALUES (@slug, @title, @body, @hero_image, @meta_description, @updated_at)
     ON CONFLICT(slug) DO UPDATE SET
       title=excluded.title, body=excluded.body, hero_image=excluded.hero_image,
       meta_description=excluded.meta_description, updated_at=excluded.updated_at`,
  ).run({
    slug: s(input.slug),
    title: s(input.title),
    body: input.body ?? null,
    hero_image: input.hero_image ?? null,
    meta_description: input.meta_description ?? null,
    updated_at: new Date().toISOString(),
  });
  return getContent(s(input.slug))!;
}

export function getContent(slug: string): ContentRow | undefined {
  const row = getDb().prepare('SELECT * FROM content_page WHERE slug = ?').get(slug);
  return row ? mapRow(row) : undefined;
}

export function listContent(): ContentRow[] {
  return (getDb().prepare('SELECT * FROM content_page ORDER BY slug').all() as any[]).map(mapRow);
}

export function updateContent(slug: string, patch: Partial<ContentInput>): ContentRow | undefined {
  const cur = getContent(slug);
  if (!cur) return undefined;
  return createContent({
    slug,
    title: patch.title ?? cur.title,
    body: patch.body !== undefined ? patch.body : cur.body,
    hero_image: patch.hero_image !== undefined ? patch.hero_image : cur.hero_image,
    meta_description:
      patch.meta_description !== undefined ? patch.meta_description : cur.meta_description,
  });
}

export function removeContent(slug: string): boolean {
  return getDb().prepare('DELETE FROM content_page WHERE slug = ?').run(slug).changes > 0;
}
