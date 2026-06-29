/**
 * slots.ts — домен SCHEDULE (слоты расписания). CRUD + валидация «двух CTA».
 *
 * Два CTA на слот (SPEC §3): cta_type ∈ {booking, external}; для external
 * обязателен external_url. kind ∈ {own, arenda} нужен для O1-приоритета
 * (логика конфликтов — в schedule.ts).
 *
 * Заводит администратор. create идемпотентен по id (upsert) — сидер не плодит дубли.
 * Новые слоты по умолчанию НЕ опубликованы (is_published=0): публикация — явное
 * действие в админке (а конфликтные — только после ручного подтверждения, O1).
 */
import { getDb } from './db.ts';

export type CtaType = 'booking' | 'external';
export type SlotKind = 'own' | 'arenda';

export type SlotInput = {
  id: string;
  hall_id: string;
  specialist_id?: string | null;
  weekday: number; // 1..7
  time_start: string; // 'HH:MM'
  time_end: string; // 'HH:MM'
  title?: string | null;
  kind?: SlotKind;
  cta_type: CtaType;
  external_url?: string | null;
  conflict_flag?: boolean | number;
  is_published?: boolean | number;
  conflict_confirmed?: boolean | number; // M2-QA-1: ручное подтверждение публикации конфликта
};

export type SlotRow = {
  id: string;
  hall_id: string;
  specialist_id: string | null;
  weekday: number;
  time_start: string;
  time_end: string;
  title: string | null;
  kind: SlotKind;
  cta_type: CtaType;
  external_url: string | null;
  conflict_flag: number; // 0/1
  is_published: number; // 0/1
  conflict_confirmed: number; // 0/1 — M2-QA-1: ручное подтверждение публикации конфликта
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const bit = (v: unknown): number => (v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0);
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSlot(input: Partial<SlotInput>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!s(input.id)) errors.id = 'Укажите идентификатор слота.';
  if (!s(input.hall_id)) errors.hall_id = 'Выберите зал.';

  const wd = Number(input.weekday);
  if (!Number.isInteger(wd) || wd < 1 || wd > 7) errors.weekday = 'День недели — число 1..7.';

  if (!HHMM_RE.test(s(input.time_start))) errors.time_start = 'Время начала — формат ЧЧ:ММ.';
  if (!HHMM_RE.test(s(input.time_end))) errors.time_end = 'Время окончания — формат ЧЧ:ММ.';
  if (
    !errors.time_start &&
    !errors.time_end &&
    s(input.time_start) >= s(input.time_end)
  ) {
    errors.time_end = 'Окончание должно быть позже начала.';
  }

  const kind = s(input.kind) || 'own';
  if (kind !== 'own' && kind !== 'arenda') errors.kind = 'Тип слота — own или arenda.';

  const cta = s(input.cta_type);
  if (cta !== 'booking' && cta !== 'external') {
    errors.cta_type = 'CTA — booking или external.';
  } else if (cta === 'external' && !s(input.external_url)) {
    errors.external_url = 'Для внешнего CTA укажите ссылку.';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

function mapRow(r: any): SlotRow {
  return {
    id: r.id,
    hall_id: r.hall_id,
    specialist_id: r.specialist_id,
    weekday: r.weekday,
    time_start: r.time_start,
    time_end: r.time_end,
    title: r.title,
    kind: r.kind,
    cta_type: r.cta_type,
    external_url: r.external_url,
    conflict_flag: r.conflict_flag,
    is_published: r.is_published,
    conflict_confirmed: r.conflict_confirmed,
  };
}

export function createSlot(input: SlotInput): SlotRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO slot (id, hall_id, specialist_id, weekday, time_start, time_end, title,
       kind, cta_type, external_url, conflict_flag, is_published, conflict_confirmed)
     VALUES (@id, @hall_id, @specialist_id, @weekday, @time_start, @time_end, @title,
       @kind, @cta_type, @external_url, @conflict_flag, @is_published, @conflict_confirmed)
     ON CONFLICT(id) DO UPDATE SET
       hall_id=excluded.hall_id, specialist_id=excluded.specialist_id, weekday=excluded.weekday,
       time_start=excluded.time_start, time_end=excluded.time_end, title=excluded.title,
       kind=excluded.kind, cta_type=excluded.cta_type, external_url=excluded.external_url,
       conflict_flag=excluded.conflict_flag, is_published=excluded.is_published,
       conflict_confirmed=excluded.conflict_confirmed`,
  ).run({
    id: s(input.id),
    hall_id: s(input.hall_id),
    specialist_id: input.specialist_id ?? null,
    weekday: Number(input.weekday),
    time_start: s(input.time_start),
    time_end: s(input.time_end),
    title: input.title ?? null,
    kind: s(input.kind) || 'own',
    cta_type: s(input.cta_type),
    external_url: input.external_url ?? null,
    conflict_flag: bit(input.conflict_flag),
    is_published: bit(input.is_published),
    conflict_confirmed: bit(input.conflict_confirmed),
  });
  return getSlot(s(input.id))!;
}

export function getSlot(id: string): SlotRow | undefined {
  const row = getDb().prepare('SELECT * FROM slot WHERE id = ?').get(id);
  return row ? mapRow(row) : undefined;
}

export function listSlots(): SlotRow[] {
  return (
    getDb()
      .prepare('SELECT * FROM slot ORDER BY weekday, time_start, hall_id')
      .all() as any[]
  ).map(mapRow);
}

export function updateSlot(id: string, patch: Partial<SlotInput>): SlotRow | undefined {
  const cur = getSlot(id);
  if (!cur) return undefined;
  return createSlot({
    id,
    hall_id: patch.hall_id ?? cur.hall_id,
    specialist_id:
      patch.specialist_id !== undefined ? patch.specialist_id : cur.specialist_id,
    weekday: patch.weekday !== undefined ? patch.weekday : cur.weekday,
    time_start: patch.time_start ?? cur.time_start,
    time_end: patch.time_end ?? cur.time_end,
    title: patch.title !== undefined ? patch.title : cur.title,
    kind: patch.kind ?? cur.kind,
    cta_type: patch.cta_type ?? cur.cta_type,
    external_url: patch.external_url !== undefined ? patch.external_url : cur.external_url,
    conflict_flag: patch.conflict_flag !== undefined ? bit(patch.conflict_flag) : cur.conflict_flag,
    is_published: patch.is_published !== undefined ? bit(patch.is_published) : cur.is_published,
    conflict_confirmed:
      patch.conflict_confirmed !== undefined ? bit(patch.conflict_confirmed) : cur.conflict_confirmed,
  });
}

export function removeSlot(id: string): boolean {
  return getDb().prepare('DELETE FROM slot WHERE id = ?').run(id).changes > 0;
}
