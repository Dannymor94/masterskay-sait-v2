import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Gate M2 — O1 (приоритет аренды) и публикация расписания.
 *
 * detectConflicts(): пересечение arenda↔own в одном зале/weekday/времени →
 *   own-слот получает conflict_flag=1, is_published=0 (НЕ публикуется авто).
 * publishedSlots(): не возвращает неподтверждённый конфликт; после ручного
 *   confirmPublishConflict(id, true) — возвращает. Непересекающиеся публикуются.
 *
 * RED→GREEN: до реализации schedule.ts/slots.ts импорт/вызовы падают.
 */

let tmpDir: string;

async function fresh() {
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  const halls = await import('../../web/src/server/halls.ts');
  const slots = await import('../../web/src/server/slots.ts');
  const schedule = await import('../../web/src/server/schedule.ts');
  halls.createHall({ id: 'big', name: 'Большой' });
  halls.createHall({ id: 'small', name: 'Малый' });
  return { ...slots, ...schedule };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-sched-'));
});
afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('O1 — detectConflicts (приоритет аренды)', () => {
  it('пересечение arenda↔own в одном зале/времени → own помечен conflict, не опубликован', async () => {
    const m = await fresh();
    m.createSlot({
      id: 'arenda-1', hall_id: 'big', weekday: 2, time_start: '18:00', time_end: '20:00',
      kind: 'arenda', cta_type: 'external', external_url: 'https://t.me/x', is_published: 1,
    });
    m.createSlot({
      id: 'own-1', hall_id: 'big', weekday: 2, time_start: '19:00', time_end: '21:00',
      kind: 'own', cta_type: 'booking', is_published: 1,
    });

    m.detectConflicts();

    const own = m.getSlot('own-1')!;
    expect(own.conflict_flag).toBe(1);
    expect(own.is_published).toBe(0);
    // аренда не трогается
    const arenda = m.getSlot('arenda-1')!;
    expect(arenda.conflict_flag).toBe(0);
    expect(arenda.is_published).toBe(1);
  });

  it('publishedSlots НЕ содержит неподтверждённый конфликт; после confirm — содержит', async () => {
    const m = await fresh();
    m.createSlot({
      id: 'arenda-1', hall_id: 'big', weekday: 2, time_start: '18:00', time_end: '20:00',
      kind: 'arenda', cta_type: 'external', external_url: 'https://t.me/x', is_published: 1,
    });
    m.createSlot({
      id: 'own-1', hall_id: 'big', weekday: 2, time_start: '19:00', time_end: '21:00',
      kind: 'own', cta_type: 'booking', is_published: 1,
    });
    m.detectConflicts();

    let ids = m.publishedSlots().map((s: any) => s.id);
    expect(ids).toContain('arenda-1');
    expect(ids).not.toContain('own-1');

    // без подтверждения (confirm=false) — слот остаётся скрытым (is_published=0)
    const unconf = m.confirmPublishConflict('own-1', false);
    expect(unconf!.is_published).toBe(0);
    expect(unconf!.conflict_confirmed).toBe(0);
    expect(m.publishedSlots().map((s: any) => s.id)).not.toContain('own-1');

    // ручное подтверждение
    const res = m.confirmPublishConflict('own-1', true);
    expect(res!.is_published).toBe(1);
    expect(res!.conflict_confirmed).toBe(1);
    ids = m.publishedSlots().map((s: any) => s.id);
    expect(ids).toContain('own-1');
  });

  it('M2-QA-1: подтверждённый конфликт ОСТАЁТСЯ опубликованным после повторного detectConflicts()', async () => {
    const m = await fresh();
    m.createSlot({
      id: 'arenda-1', hall_id: 'big', weekday: 2, time_start: '18:00', time_end: '20:00',
      kind: 'arenda', cta_type: 'external', external_url: 'https://t.me/x', is_published: 1,
    });
    m.createSlot({
      id: 'own-1', hall_id: 'big', weekday: 2, time_start: '19:00', time_end: '21:00',
      kind: 'own', cta_type: 'booking', is_published: 1,
    });

    // 1) Первый прогон детектора (рендер): own скрыт (конфликт, не подтверждён).
    m.detectConflicts();
    expect(m.publishedSlots().map((s: any) => s.id)).not.toContain('own-1');

    // 2) Без подтверждения повторные рендеры держат own скрытым (идемпотентно).
    m.detectConflicts();
    m.detectConflicts();
    expect(m.publishedSlots().map((s: any) => s.id)).not.toContain('own-1');

    // 3) Админ вручную подтверждает публикацию конфликта.
    const confirmed = m.confirmPublishConflict('own-1', true);
    expect(confirmed!.is_published).toBe(1);
    expect(confirmed!.conflict_confirmed).toBe(1);
    expect(m.publishedSlots().map((s: any) => s.id)).toContain('own-1');

    // 4) КЛЮЧЕВОЙ кейс бага: следующий рендер снова вызывает detectConflicts()
    //    при ВСЁ ЕЩЁ пересекающейся аренде — публикация own ДОЛЖНА сохраниться.
    m.detectConflicts();
    expect(m.getSlot('own-1')!.is_published).toBe(1);
    expect(m.getSlot('own-1')!.conflict_confirmed).toBe(1);
    expect(m.publishedSlots().map((s: any) => s.id)).toContain('own-1');

    // ...и остаётся видимым после ещё нескольких прогонов (стабильность).
    m.detectConflicts();
    m.detectConflicts();
    expect(m.publishedSlots().map((s: any) => s.id)).toContain('own-1');

    // 5) Снятие подтверждения (confirm=false) снова скрывает; повторный detect — тоже.
    const unset = m.confirmPublishConflict('own-1', false);
    expect(unset!.is_published).toBe(0);
    expect(unset!.conflict_confirmed).toBe(0);
    expect(m.publishedSlots().map((s: any) => s.id)).not.toContain('own-1');
    m.detectConflicts();
    expect(m.publishedSlots().map((s: any) => s.id)).not.toContain('own-1');

    // 6) Если аренда исчезла — конфликт снят, conflict_confirmed сброшен в 0.
    m.confirmPublishConflict('own-1', true); // снова подтверждаем
    m.removeSlot('arenda-1');
    m.detectConflicts();
    const own = m.getSlot('own-1')!;
    expect(own.conflict_flag).toBe(0);
    expect(own.conflict_confirmed).toBe(0);
  });

  it('непересекающиеся слоты публикуются нормально, без конфликта', async () => {
    const m = await fresh();
    m.createSlot({
      id: 'a', hall_id: 'big', weekday: 2, time_start: '10:00', time_end: '12:00',
      kind: 'arenda', cta_type: 'external', external_url: 'https://t.me/x', is_published: 1,
    });
    m.createSlot({
      id: 'b', hall_id: 'big', weekday: 2, time_start: '12:00', time_end: '14:00',
      kind: 'own', cta_type: 'booking', is_published: 1,
    });
    // другой зал — тоже не конфликт
    m.createSlot({
      id: 'c', hall_id: 'small', weekday: 2, time_start: '10:00', time_end: '12:00',
      kind: 'own', cta_type: 'booking', is_published: 1,
    });
    m.detectConflicts();

    expect(m.getSlot('b')!.conflict_flag).toBe(0);
    expect(m.getSlot('c')!.conflict_flag).toBe(0);
    const ids = m.publishedSlots().map((s: any) => s.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('смежные впритык (end==start) НЕ конфликтуют', async () => {
    const m = await fresh();
    m.createSlot({
      id: 'a', hall_id: 'big', weekday: 3, time_start: '18:00', time_end: '19:00',
      kind: 'arenda', cta_type: 'external', external_url: 'https://t.me/x', is_published: 1,
    });
    m.createSlot({
      id: 'b', hall_id: 'big', weekday: 3, time_start: '19:00', time_end: '20:00',
      kind: 'own', cta_type: 'booking', is_published: 1,
    });
    m.detectConflicts();
    expect(m.getSlot('b')!.conflict_flag).toBe(0);
  });
});

describe('validateSlot — два CTA', () => {
  it('external без external_url → ошибка', async () => {
    const m = await fresh();
    const res = m.validateSlot({
      id: 'x', hall_id: 'big', weekday: 1, time_start: '10:00', time_end: '11:00',
      cta_type: 'external',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.external_url).toBeTruthy();
  });

  it('booking валиден без external_url', async () => {
    const m = await fresh();
    const res = m.validateSlot({
      id: 'x', hall_id: 'big', weekday: 1, time_start: '10:00', time_end: '11:00',
      cta_type: 'booking',
    });
    expect(res.ok).toBe(true);
  });
});
