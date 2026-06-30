/**
 * scheduleView.ts — чистые хелперы вёрстки расписания (/raspisanie).
 *
 * Чистые функции без обращения к БД: фильтрация публикации и группировка по дням.
 * Источник истины по конфликтам/публикации — серверный schedule.ts (detectConflicts
 * + publishedSlots). Здесь — дополнительный гарант на уровне вёрстки: в выдачу
 * попадают ТОЛЬКО is_published=1 (O1: конфликтный/неопубликованный слот не виден,
 * пока админ вручную не подтвердил). Тип слота зеркалит SlotRow из server/slots.ts
 * (frontend не импортирует server-модуль — это нарушение границ каталогов).
 */

export type ScheduleSlot = {
  id: string;
  hall_id: string;
  specialist_id: string | null;
  weekday: number; // 1..7 (пн..вс)
  time_start: string; // 'HH:MM'
  time_end: string; // 'HH:MM'
  title: string | null;
  kind: 'own' | 'arenda';
  cta_type: 'booking' | 'external';
  external_url: string | null;
  conflict_flag: number; // 0/1
  is_published: number; // 0/1
};

export type DayGroup = {
  weekday: number;
  label: string;
  slots: ScheduleSlot[];
};

/** Полные названия дней недели (1=Пн .. 7=Вс). */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
  7: 'Воскресенье',
};

/**
 * Оставляет только опубликованные слоты (is_published=1). Конфликтные/неопубли-
 * кованные отсекаются — независимо от conflict_flag (он лишь причина is_published=0).
 */
export function publishedForView<T extends { is_published: number }>(slots: T[]): T[] {
  return slots.filter((s) => s.is_published === 1);
}

/**
 * Группирует слоты по дню недели (1..7), внутри дня сортирует по времени начала.
 * Возвращает только дни, где есть слоты, в порядке пн→вс. Пустой ввод → [].
 */
export function groupByWeekday<T extends { weekday: number; time_start: string }>(
  slots: T[],
): { weekday: number; label: string; slots: T[] }[] {
  const byDay = new Map<number, T[]>();
  for (const slot of slots) {
    const arr = byDay.get(slot.weekday);
    if (arr) arr.push(slot);
    else byDay.set(slot.weekday, [slot]);
  }
  const result: { weekday: number; label: string; slots: T[] }[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    const arr = byDay.get(wd);
    if (!arr || arr.length === 0) continue;
    arr.sort((a, b) => (a.time_start < b.time_start ? -1 : a.time_start > b.time_start ? 1 : 0));
    result.push({ weekday: wd, label: WEEKDAY_LABELS[wd] ?? `День ${wd}`, slots: arr });
  }
  return result;
}

/**
 * Ссылка на форму визита (T2-4 создаст /zapis) с предзаполнением зала и слота.
 * Параметры в query, чтобы читались и серверно (SSR-форма визита), и без JS.
 * Если передан masterSlug — добавляет ?master=<slug> для предзаполнения мастера.
 */
export function bookingHref(
  slot: { hall_id: string; id: string },
  masterSlug?: string | null,
): string {
  const p = new URLSearchParams({ hall: slot.hall_id, slot: slot.id });
  if (masterSlug) p.set('master', masterSlug);
  return `/zapis?${p.toString()}`;
}
