import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { fileURLToPath } from 'node:url';

/**
 * T2-2 — контракт страницы единого расписания /raspisanie (вёрстка, без JS).
 *
 * Проверяем РАЗМЕТКУ компонента ScheduleSlot.astro через Astro Container API
 * (как arenda.test.ts), на фикстуре слотов:
 *  - cta_type='booking' → кнопка «Записаться», href ведёт на форму визита
 *    /zapis?hall=<hall_id>&slot=<slot_id> (T2-4 создаст /zapis);
 *  - cta_type='external' → ссылка «К специалисту», href=external_url,
 *    target=_blank + rel содержит noopener (без онлайн-оплаты);
 *  - семантика: слот — <article>, есть время и название.
 *
 * Плюс — чистый хелпер фильтрации/группировки (scheduleView.ts): в выдачу
 * /raspisanie попадают ТОЛЬКО is_published=1 (O1: конфликтный/неопубликованный
 * слот не виден, пока админ не подтвердил). Это гарант на уровне вёрстки в
 * дополнение к серверному publishedSlots().
 */

type SlotRow = {
  id: string;
  hall_id: string;
  specialist_id: string | null;
  weekday: number;
  time_start: string;
  time_end: string;
  title: string | null;
  kind: 'own' | 'arenda';
  cta_type: 'booking' | 'external';
  external_url: string | null;
  conflict_flag: number;
  is_published: number;
};

const ScheduleSlotPath = fileURLToPath(
  new URL('../../web/src/components/ScheduleSlot.astro', import.meta.url),
);

function makeSlot(over: Partial<SlotRow>): SlotRow {
  return {
    id: 'slot-x',
    hall_id: 'big-70',
    specialist_id: null,
    weekday: 1,
    time_start: '10:00',
    time_end: '11:30',
    title: 'Занятие',
    kind: 'own',
    cta_type: 'booking',
    external_url: null,
    conflict_flag: 0,
    is_published: 1,
    ...over,
  };
}

let container: AstroContainer;
let SlotComponent: any;

beforeAll(async () => {
  container = await AstroContainer.create();
  SlotComponent = (await import(ScheduleSlotPath)).default;
}, 30_000);

async function renderSlot(slot: SlotRow, hallName = 'Большой зал', specialistName: string | null = null) {
  return container.renderToString(SlotComponent, {
    props: { item: slot, hallName, specialistName },
  });
}

describe('ScheduleSlot — два CTA на слот', () => {
  it('booking-слот → кнопка «Записаться» с href /zapis?hall=&slot=', async () => {
    const slot = makeSlot({
      id: 'slot-yoga-mon',
      hall_id: 'big-70',
      cta_type: 'booking',
      title: 'Хатха-йога',
    });
    const html = await renderSlot(slot);

    expect(html).toMatch(/Записаться/);
    // ссылка на форму визита с предзаполнением зала и слота
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const booking = anchors.find((m) => /Записаться/.test(m[2]));
    expect(booking, 'должна быть ссылка-кнопка «Записаться»').toBeTruthy();
    const href = booking![1];
    expect(href).toContain('/zapis');
    expect(href).toContain('hall=big-70');
    expect(href).toContain('slot=slot-yoga-mon');
  });

  it('booking-слот НЕ содержит внешней ссылки «К специалисту»', async () => {
    const html = await renderSlot(makeSlot({ cta_type: 'booking' }));
    expect(html).not.toMatch(/К специалисту/);
  });

  it('external-слот → ссылка «К специалисту» с href=external_url, target и rel noopener', async () => {
    const slot = makeSlot({
      id: 'slot-psy-wed',
      cta_type: 'external',
      external_url: 'https://example.com/demo-psy',
      title: 'Консультация психолога',
    });
    const html = await renderSlot(slot);

    expect(html).toMatch(/К специалисту/);
    const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map((m) => m[0]);
    const ext = anchors.find((a) => /К специалисту/.test(a));
    expect(ext, 'должна быть ссылка «К специалисту»').toBeTruthy();
    expect(ext!).toMatch(/href="https:\/\/example\.com\/demo-psy"/);
    expect(ext!).toMatch(/target="_blank"/);
    expect(ext!).toMatch(/rel="[^"]*noopener[^"]*"/);
  });

  it('external-слот НЕ содержит кнопки «Записаться»', async () => {
    const html = await renderSlot(
      makeSlot({ cta_type: 'external', external_url: 'https://example.com/x' }),
    );
    expect(html).not.toMatch(/Записаться/);
  });

  it('слот рендерит время, название и зал; <article> как семантику', async () => {
    const html = await renderSlot(
      makeSlot({ time_start: '18:00', time_end: '20:00', title: 'Аренда: вечер' }),
      'Большой зал',
    );
    expect(html).toMatch(/<article\b/i);
    expect(html).toContain('18:00');
    expect(html).toContain('20:00');
    expect(html).toContain('Аренда: вечер');
    expect(html).toContain('Большой зал');
  });

  it('специалист выводится, если задан', async () => {
    const html = await renderSlot(makeSlot({}), 'Большой зал', 'Демо-специалист');
    expect(html).toContain('Демо-специалист');
  });
});

describe('scheduleView — фильтрация публикации и группировка (O1)', () => {
  it('publishedForView оставляет только is_published=1 (конфликт скрыт)', async () => {
    const { publishedForView } = await import(
      '../../web/src/components/scheduleView.ts'
    );
    const slots: SlotRow[] = [
      makeSlot({ id: 'arenda', kind: 'arenda', cta_type: 'external', external_url: 'https://x', is_published: 1 }),
      // конфликтный own: detectConflicts снял публикацию
      makeSlot({ id: 'own-conflict', kind: 'own', conflict_flag: 1, is_published: 0 }),
      makeSlot({ id: 'normal', is_published: 1 }),
    ];
    const ids = publishedForView(slots).map((s) => s.id);
    expect(ids).toContain('arenda');
    expect(ids).toContain('normal');
    expect(ids).not.toContain('own-conflict');
  });

  it('groupByWeekday группирует по дням 1..7 и сортирует слоты по времени', async () => {
    const { groupByWeekday } = await import(
      '../../web/src/components/scheduleView.ts'
    );
    const slots: SlotRow[] = [
      makeSlot({ id: 'a', weekday: 2, time_start: '19:00', time_end: '21:00' }),
      makeSlot({ id: 'b', weekday: 2, time_start: '10:00', time_end: '11:00' }),
      makeSlot({ id: 'c', weekday: 1, time_start: '09:00', time_end: '10:00' }),
    ];
    const groups = groupByWeekday(slots);
    // только дни, где есть слоты
    const days = groups.map((g) => g.weekday);
    expect(days).toEqual([1, 2]);
    const tue = groups.find((g) => g.weekday === 2)!;
    expect(tue.slots.map((s) => s.id)).toEqual(['b', 'a']); // по времени
    expect(tue.label).toBe('Вторник');
  });

  it('пустой ввод → пустые группы (страница покажет «расписание обновляется»)', async () => {
    const { groupByWeekday } = await import(
      '../../web/src/components/scheduleView.ts'
    );
    expect(groupByWeekday([])).toEqual([]);
  });
});
