/**
 * POST /api/leads/arenda — приём заявки на аренду (главная конверсия).
 *
 * Контракт: docs/m1-leads-contract.md §4. Инварианты: CLAUDE.md §1 (идемпотентность
 * через pre-generated ID, формы без JS), SPEC §4.
 *
 * Поведение (строго по контракту):
 *  1. Honeypot `company` непусто → НЕ создавать лид, тихий успех (303 /arenda/spasibo).
 *  2. Время-на-форме: нет form_rendered_at или (now − rendered) < 2с → тихий дроп
 *     (тот же успешный путь, лид не создавать).
 *  3. Валидация → ошибка: flash-cookie mst_flash {errors, values} + 303 /arenda#zayavka.
 *  4. Успех → insert с дедупом (id = idempotency_key) → 303 /arenda/spasibo.
 *
 * PRG: всегда 303-редирект. Никаких ПДн в URL — всё в POST-теле / в cookie (same-origin).
 * Запись во внешние системы (CRM/уведомления) НЕ делаем — это двухфазно с человеком.
 */
import type { APIContext } from 'astro';
import { insertArendaLead, validateArenda, type ArendaFields } from '../../../server/leads.ts';

export const prerender = false;

const SPASIBO = '/arenda/spasibo';
const FORM_ANCHOR = '/arenda#zayavka';
const MIN_FILL_MS = 2000; // нижний порог времени-на-форме (антиспам)

// Поля, которые безопасно вернуть для репопуляции формы (без служебных секретов/honeypot).
const REPOPULATE_KEYS = [
  'name',
  'contact',
  'activity',
  'activity_other',
  'hall',
  'format',
  'schedule',
  'start',
  'comment',
  'consent',
] as const;

function pickValues(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of REPOPULATE_KEYS) {
    if (fields[k] !== undefined) out[k] = fields[k];
  }
  return out;
}

export async function POST({ request, redirect, cookies }: APIContext): Promise<Response> {
  // Парсим form-urlencoded (нативный submit без JS) в плоский объект строк.
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }

  // 1. Honeypot: реальный пользователь не заполняет company. Тихий успех.
  if ((fields.company ?? '').trim() !== '') {
    return redirect(SPASIBO, 303);
  }

  // 2. Время-на-форме: нет токена рендера или слишком быстро → бот. Тихий дроп.
  const renderedAtRaw = (fields.form_rendered_at ?? '').trim();
  const renderedAt = renderedAtRaw ? Date.parse(renderedAtRaw) : NaN;
  if (Number.isNaN(renderedAt) || Date.now() - renderedAt < MIN_FILL_MS) {
    return redirect(SPASIBO, 303);
  }

  // 3. Валидация.
  const result = validateArenda(fields as ArendaFields);
  if (!result.ok) {
    const flash = JSON.stringify({
      errors: result.errors,
      values: pickValues(fields),
    });
    cookies.set('mst_flash', flash, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
    return redirect(FORM_ANCHOR, 303);
  }

  // 4. Успех: вставка с дедупом по idempotency_key (повтор — noop, ответ всё равно успешный).
  insertArendaLead(fields as ArendaFields);
  return redirect(SPASIBO, 303);
}
