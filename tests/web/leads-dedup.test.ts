import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Gate M1 — главный инвариант идемпотентности (CLAUDE.md §1, контракт §4.4).
 *
 * Одна заявка = один лид. Повтор того же idempotency_key НЕ создаёт второй лид
 * (второй вызов — noop, created:false). Дедуп на уровне БД: id = idempotency_key.
 *
 * RED→GREEN: до реализации web/src/server/{db,leads}.ts импорт/вызовы падают.
 *
 * Каждый тест — на СВОЕЙ временной БД (DATABASE_URL на временный файл),
 * чтобы изоляция и портируемость были как в реальном раннере.
 */

let tmpDir: string;

async function freshLeadsModule() {
  // Свежий модуль с актуальным DATABASE_URL: сбрасываем кэш модулей,
  // чтобы db.ts открыл новую (временную) БД.
  const dbFile = join(tmpDir, `t-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  const leads = await import('../../web/src/server/leads.ts');
  return leads;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mst-leads-'));
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  rmSync(tmpDir, { recursive: true, force: true });
});

const baseInput = (key: string) => ({
  idempotency_key: key,
  name: 'Анна',
  contact: '+7 900 000-00-00',
  activity: 'Массаж',
  activity_other: '',
  hall: 'big-70',
  format: 'regular',
  schedule: 'вт, чт 18:00–21:00',
  start: 'с сентября',
  comment: 'нужен массажный стол',
  cta_origin: 'hall-big',
  source_page: '/arenda',
  consent: 'yes',
});

describe('insertArendaLead — дедуп по idempotency_key (Gate M1)', () => {
  it('два вызова с ОДНИМ ключом → ровно один лид; второй created:false', async () => {
    const { insertArendaLead, listLeads, getLead } = await freshLeadsModule();
    const key = randomUUID();

    const first = insertArendaLead(baseInput(key));
    const second = insertArendaLead(baseInput(key));

    expect(first.created).toBe(true);
    expect(first.id).toBe(key);
    expect(second.created).toBe(false);
    expect(second.id).toBe(key);

    const all = listLeads('arenda');
    expect(all).toHaveLength(1);

    const row = getLead(key);
    expect(row).toBeTruthy();
    expect(row.id).toBe(key);
    expect(row.type).toBe('arenda');
    expect(row.name).toBe('Анна');
    expect(row.status).toBe('new');
    expect(row.source_page).toBe('/arenda');
    // payload — JSON-текст с полями формы
    const payload = JSON.parse(row.payload);
    expect(payload.activity).toBe('Массаж');
    expect(payload.format).toBe('regular');
    expect(payload.hall).toBe('big-70');
  });

  it('разные ключи → два лида', async () => {
    const { insertArendaLead, listLeads } = await freshLeadsModule();
    const a = insertArendaLead(baseInput(randomUUID()));
    const b = insertArendaLead(baseInput(randomUUID()));

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(listLeads('arenda')).toHaveLength(2);
  });
});

describe('validateArenda — детерминированная валидация', () => {
  it('валидный набор полей → ok', async () => {
    const { validateArenda } = await freshLeadsModule();
    const res = validateArenda(baseInput(randomUUID()));
    expect(res.ok).toBe(true);
    expect(Object.keys(res.errors)).toHaveLength(0);
  });

  it('нет name/contact/activity/consent → ошибки по полям', async () => {
    const { validateArenda } = await freshLeadsModule();
    const res = validateArenda({
      idempotency_key: randomUUID(),
      name: '',
      contact: '',
      activity: '',
      format: 'onetime',
      consent: '',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.name).toBeTruthy();
    expect(res.errors.contact).toBeTruthy();
    expect(res.errors.activity).toBeTruthy();
    expect(res.errors.consent).toBeTruthy();
  });

  it('format=regular без schedule → ошибка schedule', async () => {
    const { validateArenda } = await freshLeadsModule();
    const res = validateArenda({
      ...baseInput(randomUUID()),
      format: 'regular',
      schedule: '',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.schedule).toBeTruthy();
  });

  it('activity=Другое без activity_other → ошибка activity_other', async () => {
    const { validateArenda } = await freshLeadsModule();
    const res = validateArenda({
      ...baseInput(randomUUID()),
      activity: 'Другое',
      activity_other: '',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.activity_other).toBeTruthy();
  });

  it('idempotency_key пустой или не-UUID → ошибка', async () => {
    const { validateArenda } = await freshLeadsModule();
    const empty = validateArenda({ ...baseInput('') });
    expect(empty.ok).toBe(false);
    expect(empty.errors.idempotency_key).toBeTruthy();

    const bad = validateArenda({ ...baseInput('not-a-uuid') });
    expect(bad.ok).toBe(false);
    expect(bad.errors.idempotency_key).toBeTruthy();
  });
});
