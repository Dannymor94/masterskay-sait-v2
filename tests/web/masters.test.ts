/**
 * masters.test.ts — TDD for studio masters: listStudioMasters, getSpecialistBySlug,
 * createSpecialist with new fields. RED→GREEN (T-master-1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let tmpDir: string;

async function fresh() {
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  return import('../../web/src/server/specialists.ts');
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-masters-'));
});
afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('listStudioMasters', () => {
  it('returns only is_studio_master=1, ordered by sort then name', async () => {
    const sp = await fresh();
    sp.createSpecialist({ id: 'ext-1', name: 'External', is_studio_master: 0 });
    sp.createSpecialist({
      id: 'master-b', name: 'Master B', is_studio_master: 1, sort: 2,
      slug: 'master-b', directions: ['йога'],
    });
    sp.createSpecialist({
      id: 'master-a', name: 'Master A', is_studio_master: 1, sort: 1,
      slug: 'master-a', directions: ['практики'],
    });

    const masters = sp.listStudioMasters();
    expect(masters).toHaveLength(2);
    expect(masters[0].id).toBe('master-a'); // sort=1
    expect(masters[1].id).toBe('master-b'); // sort=2
    // External should not appear
    expect(masters.find((m) => m.id === 'ext-1')).toBeUndefined();
  });

  it('returns empty array when no studio masters', async () => {
    const sp = await fresh();
    sp.createSpecialist({ id: 'ext-1', name: 'External', is_studio_master: 0 });
    expect(sp.listStudioMasters()).toHaveLength(0);
  });
});

describe('getSpecialistBySlug', () => {
  it('finds specialist by slug', async () => {
    const sp = await fresh();
    sp.createSpecialist({
      id: 'master-todo-1', name: 'TODO Имя мастера 1', slug: 'master-todo-1',
      kind: 'йога', is_studio_master: 1, is_resident: 1,
      directions: ['TODO направление'], sort: 1, photo_slot: 'master-1',
    });
    const found = sp.getSpecialistBySlug('master-todo-1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('master-todo-1');
    expect(found!.slug).toBe('master-todo-1');
    expect(found!.photo_slot).toBe('master-1');
    expect(found!.directions).toEqual(['TODO направление']);
  });

  it('returns undefined for unknown slug', async () => {
    const sp = await fresh();
    expect(sp.getSpecialistBySlug('nonexistent')).toBeUndefined();
  });
});

describe('createSpecialist with new fields', () => {
  it('stores and retrieves slug, is_studio_master, directions, sort, photo_slot', async () => {
    const sp = await fresh();
    const created = sp.createSpecialist({
      id: 'test-master', name: 'Test Master',
      slug: 'test-slug', is_studio_master: 1,
      directions: ['направление 1', 'направление 2'],
      sort: 5, photo_slot: 'slot-key',
    });
    expect(created.slug).toBe('test-slug');
    expect(created.is_studio_master).toBe(1);
    expect(created.directions).toEqual(['направление 1', 'направление 2']);
    expect(created.sort).toBe(5);
    expect(created.photo_slot).toBe('slot-key');

    // Verify persistence via getSpecialist
    const fetched = sp.getSpecialist('test-master');
    expect(fetched!.is_studio_master).toBe(1);
    expect(fetched!.directions).toEqual(['направление 1', 'направление 2']);
  });

  it('idempotent: repeated create with same id updates, not duplicates', async () => {
    const sp = await fresh();
    sp.createSpecialist({ id: 'master-x', name: 'Name A', is_studio_master: 1, slug: 'slug-a', directions: ['A'] });
    sp.createSpecialist({ id: 'master-x', name: 'Name B', is_studio_master: 1, slug: 'slug-b', directions: ['B'] });
    const all = sp.listStudioMasters();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Name B');
    expect(all[0].directions).toEqual(['B']);
  });

  it('updateSpecialist patches new fields without losing existing ones', async () => {
    const sp = await fresh();
    sp.createSpecialist({
      id: 'u1', name: 'Master U', is_studio_master: 1, sort: 1, slug: 'u1',
    });
    const updated = sp.updateSpecialist('u1', { sort: 10, directions: ['new direction'] });
    expect(updated!.sort).toBe(10);
    expect(updated!.directions).toEqual(['new direction']);
    expect(updated!.name).toBe('Master U'); // not overwritten
    expect(updated!.is_studio_master).toBe(1); // not overwritten
  });
});
