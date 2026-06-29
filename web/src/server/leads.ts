/**
 * leads.ts — домен LEADS. Маппинг полей формы аренды → колонки таблицы lead,
 * вставка с ИДЕМПОТЕНТНЫМ дедупом, чтение, валидация.
 *
 * Идемпотентность (CLAUDE.md §1, SPEC §4): lead.id = idempotency_key (UUID из формы).
 * Дедуп на уровне БД через `INSERT ... ON CONFLICT(id) DO NOTHING`. Повтор того же
 * ключа → строка не добавляется (created:false). Ключ НЕ выводится из внешней системы.
 *
 * Валидация детерминированная, без runtime-LLM (validateArenda — чистая функция).
 */
import { getDb } from './db.ts';
import { registerSeats, getEvent } from './events.ts';

export type ArendaFields = {
  idempotency_key?: string;
  name?: string;
  contact?: string;
  activity?: string;
  activity_other?: string;
  hall?: string;
  format?: string;
  schedule?: string;
  start?: string;
  comment?: string;
  consent?: string;
  cta_origin?: string;
  source_page?: string;
  // honeypot / антиспам обрабатываются в эндпоинте, в payload не пишем
};

export type LeadRow = {
  id: string;
  type: string;
  name: string;
  contact: string;
  payload: string;
  status: string;
  source_page: string | null;
  created_at: string;
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Детерминированная валидация заявки на аренду (контракт §4.3).
 * Обязательны: name, contact, activity, format, consent=yes, валидный UUID-ключ.
 * Условные: format=regular → schedule; activity=Другое → activity_other.
 */
export function validateArenda(fields: ArendaFields): ValidationResult {
  const errors: Record<string, string> = {};

  if (!s(fields.idempotency_key) || !UUID_RE.test(s(fields.idempotency_key))) {
    errors.idempotency_key = 'Некорректный ключ заявки. Обновите страницу и попробуйте снова.';
  }
  if (!s(fields.name)) errors.name = 'Укажите, как вас зовут.';
  if (!s(fields.contact)) errors.contact = 'Укажите телефон или мессенджер для связи.';
  if (!s(fields.activity)) errors.activity = 'Выберите вид деятельности.';

  if (s(fields.activity) === 'Другое' && !s(fields.activity_other)) {
    errors.activity_other = 'Коротко напишите, чем вы занимаетесь.';
  }

  const format = s(fields.format);
  if (!format) {
    errors.format = 'Выберите формат аренды.';
  } else if (format !== 'regular' && format !== 'onetime') {
    errors.format = 'Выберите формат аренды.';
  }
  if (format === 'regular' && !s(fields.schedule)) {
    errors.schedule = 'Укажите удобные дни и время.';
  }

  if (s(fields.consent) !== 'yes') {
    errors.consent = 'Нужно согласие на обработку персональных данных.';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Собирает JSON-payload из не-колоночных полей формы. */
function buildPayload(fields: ArendaFields): string {
  return JSON.stringify({
    activity: s(fields.activity),
    activity_other: s(fields.activity_other),
    hall: s(fields.hall),
    format: s(fields.format),
    schedule: s(fields.schedule),
    start: s(fields.start),
    comment: s(fields.comment),
    cta_origin: s(fields.cta_origin),
  });
}

/**
 * Вставляет лид аренды с дедупом по idempotency_key.
 * Возвращает {created, id}: created=false, если лид с таким id уже был (noop).
 */
export function insertArendaLead(fields: ArendaFields): { created: boolean; id: string } {
  const id = s(fields.idempotency_key);
  const db = getDb();

  const stmt = db.prepare(
    `INSERT INTO lead (id, type, name, contact, payload, status, source_page, created_at)
     VALUES (@id, 'arenda', @name, @contact, @payload, 'new', @source_page, @created_at)
     ON CONFLICT(id) DO NOTHING`,
  );
  const info = stmt.run({
    id,
    name: s(fields.name),
    contact: s(fields.contact),
    payload: buildPayload(fields),
    source_page: s(fields.source_page) || null,
    created_at: new Date().toISOString(),
  });

  return { created: info.changes > 0, id };
}

// ───────────────────────────── VISIT (T2-4) ─────────────────────────────

export type VisitFields = {
  idempotency_key?: string;
  name?: string;
  contact?: string;
  direction?: string; // направление (йога/практика/…) — необязательно
  consent?: string;
  source_page?: string;
};

/**
 * Валидация заявки на визит (m2-contract: name, contact, consent + UUID-ключ).
 * direction необязательно (может приходить из расписания, может быть пустым).
 */
export function validateVisit(fields: VisitFields): ValidationResult {
  const errors: Record<string, string> = {};
  if (!s(fields.idempotency_key) || !UUID_RE.test(s(fields.idempotency_key))) {
    errors.idempotency_key = 'Некорректный ключ заявки. Обновите страницу и попробуйте снова.';
  }
  if (!s(fields.name)) errors.name = 'Укажите, как вас зовут.';
  if (!s(fields.contact)) errors.contact = 'Укажите телефон или мессенджер для связи.';
  if (s(fields.consent) !== 'yes') {
    errors.consent = 'Нужно согласие на обработку персональных данных.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Вставляет лид визита (type='visit') с дедупом по idempotency_key.
 * Повтор того же ключа → noop (created:false).
 */
export function insertVisitLead(fields: VisitFields): { created: boolean; id: string } {
  const id = s(fields.idempotency_key);
  const db = getDb();
  const payload = JSON.stringify({ direction: s(fields.direction) });
  const info = db
    .prepare(
      `INSERT INTO lead (id, type, name, contact, payload, status, source_page, created_at)
       VALUES (@id, 'visit', @name, @contact, @payload, 'new', @source_page, @created_at)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run({
      id,
      name: s(fields.name),
      contact: s(fields.contact),
      payload,
      source_page: s(fields.source_page) || null,
      created_at: new Date().toISOString(),
    });
  return { created: info.changes > 0, id };
}

// ───────────────────────────── EVENT (T2-4) ─────────────────────────────

export type EventFields = {
  idempotency_key?: string;
  name?: string;
  contact?: string;
  event_id?: string;
  count?: string;
  consent?: string;
  source_page?: string;
};

/** Возвращает количество мест как целое ≥0 (нечисло/мусор → 0). */
function parseCount(v: unknown): number {
  const n = Math.floor(Number(s(v)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Валидация регистрации на событие. name/contact/consent + UUID-ключ + event_id +
 * count≥1 + существование события. Проверку capacity делаем при вставке
 * (атомарно с registerSeats), здесь — структурная валидация.
 */
export function validateEventLead(fields: EventFields): ValidationResult {
  const errors: Record<string, string> = {};
  if (!s(fields.idempotency_key) || !UUID_RE.test(s(fields.idempotency_key))) {
    errors.idempotency_key = 'Некорректный ключ заявки. Обновите страницу и попробуйте снова.';
  }
  if (!s(fields.name)) errors.name = 'Укажите, как вас зовут.';
  if (!s(fields.contact)) errors.contact = 'Укажите телефон или мессенджер для связи.';
  if (parseCount(fields.count) < 1) errors.count = 'Укажите количество мест (минимум 1).';
  if (!s(fields.event_id)) {
    errors.event_id = 'Не выбрано событие.';
  } else if (!getEvent(s(fields.event_id))) {
    errors.event_id = 'Событие не найдено.';
  }
  if (s(fields.consent) !== 'yes') {
    errors.consent = 'Нужно согласие на обработку персональных данных.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Регистрация на событие в ОДНОЙ транзакции:
 *  1) пробуем вставить лид (дедуп по idempotency_key);
 *  2) ТОЛЬКО если лид реально создан (created) — резервируем места registerSeats.
 *
 * Привязка инкремента к успешной вставке лида гарантирует: повтор того же ключа
 * (лид уже есть → created=false) НЕ наращивает registered_count второй раз.
 *
 * Если мест не хватает (capacity достигнута) — вся транзакция откатывается:
 * лид не создаётся, count не меняется. Возвращаем причину для flash-ошибки.
 *
 * Результат:
 *  - {ok:true, created, registered_count} — успех (created=false при повторе ключа);
 *  - {ok:false, reason:'capacity'|'no_event'} — отказ (валидационная ошибка в эндпоинте).
 */
export function registerEventLead(
  fields: EventFields,
):
  | { ok: true; created: boolean; registered_count: number }
  | { ok: false; reason: 'capacity' | 'no_event' } {
  const id = s(fields.idempotency_key);
  const eventId = s(fields.event_id);
  const count = parseCount(fields.count);
  const db = getDb();

  const txn = db.transaction(() => {
    const ev = getEvent(eventId);
    if (!ev) return { ok: false, reason: 'no_event' as const };

    const info = db
      .prepare(
        `INSERT INTO lead (id, type, name, contact, payload, status, source_page, created_at)
         VALUES (@id, 'event', @name, @contact, @payload, 'new', @source_page, @created_at)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        id,
        name: s(fields.name),
        contact: s(fields.contact),
        payload: JSON.stringify({ event_id: eventId, count }),
        source_page: s(fields.source_page) || null,
        created_at: new Date().toISOString(),
      });

    const created = info.changes > 0;
    if (!created) {
      // Повтор ключа — лид уже был. Места НЕ трогаем (идемпотентность).
      return { ok: true, created: false, registered_count: ev.registered_count };
    }

    // Лид только что создан — резервируем места атомарно.
    const seats = registerSeats(eventId, count);
    if (!seats.ok) {
      // Мест нет: откатываем вставку лида (throw откатит транзакцию better-sqlite3).
      throw new CapacityError();
    }
    return { ok: true, created: true, registered_count: seats.registered_count };
  });

  try {
    return txn() as
      | { ok: true; created: boolean; registered_count: number }
      | { ok: false; reason: 'no_event' };
  } catch (e) {
    if (e instanceof CapacityError) return { ok: false, reason: 'capacity' };
    throw e;
  }
}

/** Внутренняя ошибка для отката транзакции при нехватке мест. */
class CapacityError extends Error {}

/** Возвращает лид по id или undefined. */
export function getLead(id: string): LeadRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM lead WHERE id = ?').get(id) as
    | LeadRow
    | undefined;
}

/** Допустимые статусы лида (смена в админке M2). */
export const LEAD_STATUSES = ['new', 'in_progress', 'done', 'rejected'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Меняет статус лида. Возвращает true, если строка обновлена и статус валиден. */
export function updateLeadStatus(id: string, status: string): boolean {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) return false;
  const db = getDb();
  return db.prepare('UPDATE lead SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

/** Список лидов (опц. фильтр по типу), новые сверху. */
export function listLeads(type?: string): LeadRow[] {
  const db = getDb();
  if (type) {
    return db
      .prepare('SELECT * FROM lead WHERE type = ? ORDER BY created_at DESC')
      .all(type) as LeadRow[];
  }
  return db
    .prepare('SELECT * FROM lead ORDER BY created_at DESC')
    .all() as LeadRow[];
}
