import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * CRUD smoke-тесты M2: halls / specialists / slots / events / content.
 * create→get→update→list→remove. Идемпотентность create по id (upsert).
 * RED→GREEN: до реализации модулей падают.
 */

let tmpDir: string;

async function fresh() {
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  return {
    halls: await import('../../web/src/server/halls.ts'),
    specialists: await import('../../web/src/server/specialists.ts'),
    slots: await import('../../web/src/server/slots.ts'),
    events: await import('../../web/src/server/events.ts'),
    content: await import('../../web/src/server/content.ts'),
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-crud-'));
});
afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('halls CRUD', () => {
  it('create→get→update→list→remove + JSON-поля', async () => {
    const { halls } = await fresh();
    const h = halls.createHall({
      id: 'big', name: 'Большой', area_m2: 70, capacity: 30,
      equipment: ['коврики', 'болстеры'], rate_subscription: 'по запросу',
      photos: ['/img/a.jpg'],
    });
    expect(h.id).toBe('big');
    expect(h.equipment).toEqual(['коврики', 'болстеры']);
    expect(halls.getHall('big')!.area_m2).toBe(70);

    const upd = halls.updateHall('big', { capacity: 40 });
    expect(upd!.capacity).toBe(40);
    expect(upd!.name).toBe('Большой'); // не затёрто

    expect(halls.listHalls()).toHaveLength(1);
    expect(halls.removeHall('big')).toBe(true);
    expect(halls.getHall('big')).toBeUndefined();
  });

  it('повторный create с тем же id не плодит дубли (upsert)', async () => {
    const { halls } = await fresh();
    halls.createHall({ id: 'big', name: 'A' });
    halls.createHall({ id: 'big', name: 'B' });
    expect(halls.listHalls()).toHaveLength(1);
    expect(halls.getHall('big')!.name).toBe('B');
  });
});

describe('specialists CRUD', () => {
  it('create→get→update→list→remove + is_resident', async () => {
    const { specialists } = await fresh();
    const sp = specialists.createSpecialist({
      id: 'demo-1', name: 'Демо-специалист', kind: 'массаж', is_resident: true,
    });
    expect(sp.is_resident).toBe(1);
    expect(specialists.updateSpecialist('demo-1', { is_resident: false })!.is_resident).toBe(0);
    expect(specialists.listSpecialists()).toHaveLength(1);
    expect(specialists.removeSpecialist('demo-1')).toBe(true);
    expect(specialists.getSpecialist('demo-1')).toBeUndefined();
  });
});

describe('slots CRUD', () => {
  it('create→get→update→list→remove', async () => {
    const { halls, slots } = await fresh();
    halls.createHall({ id: 'big', name: 'Большой' });
    slots.createSlot({
      id: 's1', hall_id: 'big', weekday: 1, time_start: '10:00', time_end: '11:00',
      kind: 'own', cta_type: 'booking',
    });
    expect(slots.getSlot('s1')!.cta_type).toBe('booking');
    expect(slots.updateSlot('s1', { title: 'Хатха' })!.title).toBe('Хатха');
    expect(slots.listSlots()).toHaveLength(1);
    expect(slots.removeSlot('s1')).toBe(true);
  });
});

describe('events CRUD + registerSeats', () => {
  it('create→get→update→list→remove + slug + атомарный счётчик', async () => {
    const { events } = await fresh();
    const e = events.createEvent({
      id: 'e1', slug: 'chai-ceremony', title: 'Чайная церемония',
      datetime: '2026-09-01T18:00:00.000Z', capacity: 2,
    });
    expect(e.slug).toBe('chai-ceremony');
    expect(events.getEventBySlug('chai-ceremony')!.id).toBe('e1');
    expect(events.updateEvent('e1', { is_published: true })!.is_published).toBe(1);

    expect(events.registerSeats('e1', 1).ok).toBe(true);
    expect(events.registerSeats('e1', 1).ok).toBe(true);
    const over = events.registerSeats('e1', 1); // capacity=2 уже занята
    expect(over.ok).toBe(false);
    expect(events.getEvent('e1')!.registered_count).toBe(2);

    expect(events.listEvents()).toHaveLength(1);
    expect(events.removeEvent('e1')).toBe(true);
  });
});

describe('content CRUD', () => {
  it('create→get→update→list→remove + updated_at', async () => {
    const { content } = await fresh();
    const c = content.createContent({ slug: 'chaynaya', title: 'Чайная' });
    expect(c.slug).toBe('chaynaya');
    expect(c.updated_at).toBeTruthy();
    expect(content.updateContent('chaynaya', { body: '# Привет' })!.body).toBe('# Привет');
    expect(content.listContent()).toHaveLength(1);
    expect(content.removeContent('chaynaya')).toBe(true);
  });

  it('невалидный slug → ошибка валидации', async () => {
    const { content } = await fresh();
    expect(content.validateContent({ slug: 'Плохой Slug', title: 'X' }).ok).toBe(false);
    expect(content.validateContent({ slug: 'ok-slug', title: 'X' }).ok).toBe(true);
  });
});
