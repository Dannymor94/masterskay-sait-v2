/**
 * POST /api/leads/visit — приём заявки на визит (запись на занятие/практику).
 *
 * Контракт: docs/m2-contract.md «Формы визита и события», паттерн M1
 * (docs/m1-leads-contract.md §4). Инварианты: CLAUDE.md §1 (идемпотентность через
 * pre-generated ID, формы без JS).
 *
 * Поведение (строго как arenda.ts):
 *  1. Honeypot `company` непусто → НЕ создавать лид, тихий успех (303 /zapis/spasibo).
 *  2. Время-на-форме: нет form_rendered_at или (now − rendered) < 2с → тихий дроп.
 *  3. Валидация → ошибка: flash-cookie mst_flash {errors, values} + 303 на источник #zayavka.
 *  4. Успех → insertVisitLead (lead.type='visit') с дедупом → 303 /zapis/spasibo.
 *
 * PRG: всегда 303-редирект. ПДн только в POST-теле / в cookie (same-origin).
 * Цель Метрики `visit_lead` срабатывает на /zapis/spasibo (вешает фронт через Metrika).
 * Запись во внешние системы (CRM/уведомления) НЕ делаем — двухфазно с человеком (CLAUDE.md §4).
 */
import type { APIContext } from 'astro';
import { insertVisitLead, validateVisit, type VisitFields } from '../../../server/leads.ts';
import { logError } from '../../../server/logger.ts';

export const prerender = false;

const SPASIBO = '/zapis/spasibo';
const DEFAULT_SOURCE = '/zapis';
const MIN_FILL_MS = 2000;

// Безопасные для репопуляции поля (без служебных секретов/honeypot).
const REPOPULATE_KEYS = ['name', 'contact', 'direction', 'consent'] as const;

function pickValues(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of REPOPULATE_KEYS) {
    if (fields[k] !== undefined) out[k] = fields[k];
  }
  return out;
}

/** Якорь возврата при ошибке — на страницу-источник (из source_page) или дефолт /zapis. */
function errorAnchor(fields: Record<string, string>): string {
  const src = (fields.source_page ?? '').trim();
  const base = src && src.startsWith('/') ? src : DEFAULT_SOURCE;
  return `${base}#zayavka`;
}

export async function POST({ request, redirect, cookies }: APIContext): Promise<Response> {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }

  // 1. Honeypot → тихий успех.
  if ((fields.company ?? '').trim() !== '') {
    return redirect(SPASIBO, 303);
  }

  // 2. Время-на-форме → тихий дроп.
  const renderedAtRaw = (fields.form_rendered_at ?? '').trim();
  const renderedAt = renderedAtRaw ? Date.parse(renderedAtRaw) : NaN;
  if (Number.isNaN(renderedAt) || Date.now() - renderedAt < MIN_FILL_MS) {
    return redirect(SPASIBO, 303);
  }

  // 3. Валидация.
  const result = validateVisit(fields as VisitFields);
  if (!result.ok) {
    cookies.set(
      'mst_flash',
      JSON.stringify({ errors: result.errors, values: pickValues(fields) }),
      { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 300 },
    );
    return redirect(errorAnchor(fields), 303);
  }

  // 4. Успех: вставка с дедупом по idempotency_key (повтор — noop).
  try {
    insertVisitLead(fields as VisitFields);
  } catch (err) {
    logError('api/leads/visit', err);
    return new Response('Internal error', { status: 500 });
  }
  return redirect(SPASIBO, 303);
}
