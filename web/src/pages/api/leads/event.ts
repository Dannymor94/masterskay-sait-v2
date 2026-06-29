/**
 * POST /api/leads/event — регистрация на событие.
 *
 * Контракт: docs/m2-contract.md «Формы визита и события», паттерн M1
 * (docs/m1-leads-contract.md §4). Инварианты: CLAUDE.md §1 (идемпотентность).
 *
 * Поведение (паттерн arenda.ts) + атомарный учёт мест:
 *  1. Honeypot → тихий успех (303 на spasibo события).
 *  2. Время-на-форме < 2с → тихий дроп.
 *  3. Валидация (name/contact/consent/count≥1/event_id существует) → flash + 303 #zayavka.
 *  4. Успех → registerEventLead: в ОДНОЙ транзакции вставка лида (type='event',
 *     дедуп по idempotency_key) + registerSeats. Инкремент мест привязан к УСПЕШНОЙ
 *     вставке лида: повтор ключа → лид уже есть → места НЕ растут второй раз.
 *     Нет мест (capacity достигнута) → откат, flash «мест не осталось», лид не создан.
 *
 * PRG: всегда 303. ПДн только в POST-теле / cookie. Цель Метрики `event_register`
 * срабатывает на /sobytiya/<slug>/spasibo (вешает фронт через Metrika).
 * Запись во внешние системы НЕ делаем — двухфазно с человеком (CLAUDE.md §4).
 */
import type { APIContext } from 'astro';
import { registerEventLead, validateEventLead, type EventFields } from '../../../server/leads.ts';
import { getEvent } from '../../../server/events.ts';

export const prerender = false;

const MIN_FILL_MS = 2000;
const FALLBACK_SPASIBO = '/sobytiya'; // если событие не нашли (honeypot-кейс без слага)

const REPOPULATE_KEYS = ['name', 'contact', 'count', 'consent'] as const;

function pickValues(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of REPOPULATE_KEYS) {
    if (fields[k] !== undefined) out[k] = fields[k];
  }
  return out;
}

/** «Спасибо»-URL события: /sobytiya/<slug>/spasibo (по event_id), иначе общий /sobytiya. */
function spasiboUrl(eventId: string): string {
  const ev = eventId ? getEvent(eventId) : undefined;
  return ev ? `/sobytiya/${ev.slug}/spasibo` : FALLBACK_SPASIBO;
}

/** Якорь возврата при ошибке: на страницу события (по слагу) или source_page. */
function errorAnchor(fields: Record<string, string>): string {
  const ev = fields.event_id ? getEvent(fields.event_id.trim()) : undefined;
  if (ev) return `/sobytiya/${ev.slug}#zayavka`;
  const src = (fields.source_page ?? '').trim();
  const base = src && src.startsWith('/') ? src : FALLBACK_SPASIBO;
  return `${base}#zayavka`;
}

function setFlash(cookies: APIContext['cookies'], errors: Record<string, string>, fields: Record<string, string>) {
  cookies.set('mst_flash', JSON.stringify({ errors, values: pickValues(fields) }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 300,
  });
}

export async function POST({ request, redirect, cookies }: APIContext): Promise<Response> {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }

  const eventId = (fields.event_id ?? '').trim();

  // 1. Honeypot → тихий успех.
  if ((fields.company ?? '').trim() !== '') {
    return redirect(spasiboUrl(eventId), 303);
  }

  // 2. Время-на-форме → тихий дроп.
  const renderedAtRaw = (fields.form_rendered_at ?? '').trim();
  const renderedAt = renderedAtRaw ? Date.parse(renderedAtRaw) : NaN;
  if (Number.isNaN(renderedAt) || Date.now() - renderedAt < MIN_FILL_MS) {
    return redirect(spasiboUrl(eventId), 303);
  }

  // 3. Структурная валидация (включая существование события и count≥1).
  const result = validateEventLead(fields as EventFields);
  if (!result.ok) {
    setFlash(cookies, result.errors, fields);
    return redirect(errorAnchor(fields), 303);
  }

  // 4. Успех: транзакционная вставка лида + резерв мест.
  const reg = registerEventLead(fields as EventFields);
  if (!reg.ok) {
    // Единственная не-структурная причина отказа — нехватка мест (capacity достигнута).
    const msg =
      reg.reason === 'capacity' ? 'Мест на это событие не осталось.' : 'Событие не найдено.';
    const field = reg.reason === 'capacity' ? 'count' : 'event_id';
    setFlash(cookies, { [field]: msg }, fields);
    return redirect(errorAnchor(fields), 303);
  }

  return redirect(spasiboUrl(eventId), 303);
}
