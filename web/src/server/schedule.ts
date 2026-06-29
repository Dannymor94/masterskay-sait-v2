/**
 * schedule.ts — логика расписания и конфликтов O1 (DECISIONS O1, docs/m2-contract.md).
 *
 * O1 — РЕШЕНО (Антон): приоритет у АРЕНДЫ. При пересечении в одном зале, тот же
 * weekday, перекрывающееся время [time_start, time_end) — между слотом kind='arenda'
 * и слотом kind='own' выигрывает аренда. Конфликтующий own-слот получает
 * conflict_flag=1 и is_published=0 и НЕ публикуется автоматически.
 *
 * Публикация конфликтного слота — только ручным действием в админке
 * (confirmPublishConflict с явным флагом подтверждения). АВТО-публикации нет.
 *
 * /raspisanie рендерит только publishedSlots() (is_published=1).
 *
 * Пересечение времени: интервалы [aStart, aEnd) и [bStart, bEnd) пересекаются ⟺
 *   aStart < bEnd && bStart < aEnd  (полуинтервал: смежные «впритык» НЕ конфликтуют).
 * Время — строки 'HH:MM', сравниваются лексикографически (корректно при ведущем нуле).
 */
import { getDb } from './db.ts';
import { getSlot, listSlots, type SlotRow } from './slots.ts';

/** Пересекаются ли два слота: один зал + тот же weekday + перекрытие [start,end). */
export function slotsOverlap(a: SlotRow, b: SlotRow): boolean {
  if (a.id === b.id) return false;
  if (a.hall_id !== b.hall_id) return false;
  if (a.weekday !== b.weekday) return false;
  return a.time_start < b.time_end && b.time_start < a.time_end;
}

export type DetectResult = {
  conflictedOwnIds: string[]; // own-слоты, помеченные конфликтом в этом прогоне
};

/**
 * Прогоняет все слоты, находит пересечения arenda↔own и помечает own-слот:
 *   conflict_flag=1, is_published=0 (приоритет у аренды).
 * Идемпотентно: повторный прогон не меняет уже помеченные. Не трогает пары
 * own↔own и arenda↔arenda (для них нет правила приоритета — не наша забота O1).
 * Возвращает список id own-слотов, которые сейчас находятся в конфликте.
 */
export function detectConflicts(): DetectResult {
  const db = getDb();
  const slots = listSlots();
  const conflictedOwnIds = new Set<string>();

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (!slotsOverlap(a, b)) continue;

      // Правило O1 срабатывает только для пары arenda↔own.
      const pair = [a.kind, b.kind];
      if (pair.includes('arenda') && pair.includes('own')) {
        const own = a.kind === 'own' ? a : b;
        conflictedOwnIds.add(own.id);
      }
    }
  }

  // Помечаем конфликтные own-слоты (не публикуем) — КРОМЕ тех, что админ вручную
  // подтвердил (conflict_confirmed=1): их is_published НЕ трогаем (O1, M2-QA-1).
  // Снимаем флаг с тех, кто более не конфликтует (например, аренду удалили): тогда
  // конфликта нет, conflict_flag=0 И conflict_confirmed=0 (подтверждать нечего);
  // is_published при этом не меняем (остаётся как был).
  const mark = db.prepare(
    'UPDATE slot SET conflict_flag = 1, is_published = 0 WHERE id = ?',
  );
  // Конфликт сохраняется, но подтверждён вручную — держим conflict_flag=1 как
  // пометку, is_published НЕ трогаем (уважаем ручное решение админа).
  const markConfirmed = db.prepare('UPDATE slot SET conflict_flag = 1 WHERE id = ?');
  const clear = db.prepare(
    'UPDATE slot SET conflict_flag = 0, conflict_confirmed = 0 WHERE id = ?',
  );

  const txn = db.transaction(() => {
    for (const slot of slots) {
      if (slot.kind !== 'own') continue;
      if (conflictedOwnIds.has(slot.id)) {
        if (slot.conflict_confirmed === 1) {
          // Ручное решение принято: не снимаем публикацию. Только держим пометку.
          if (slot.conflict_flag !== 1) markConfirmed.run(slot.id);
        } else if (slot.conflict_flag !== 1 || slot.is_published !== 0) {
          mark.run(slot.id);
        }
      } else if (slot.conflict_flag === 1 || slot.conflict_confirmed === 1) {
        // Пересечение исчезло — сбрасываем флаг и подтверждение (подтверждать нечего).
        clear.run(slot.id);
      }
    }
  });
  txn();

  return { conflictedOwnIds: [...conflictedOwnIds] };
}

/** Слоты, готовые к показу на /raspisanie: только is_published=1. */
export function publishedSlots(): SlotRow[] {
  return listSlots().filter((s) => s.is_published === 1);
}

/** Слоты с conflict_flag=1 — для экрана разрешения конфликтов в админке. */
export function conflictSlots(): SlotRow[] {
  return listSlots().filter((s) => s.conflict_flag === 1);
}

/**
 * Ручное решение по публикации конфликтного слота (вызывает админка).
 *
 *  confirm===true  → conflict_confirmed=1 и is_published=1. Единственный путь
 *                    публикации конфликта. conflict_confirmed переживает повторные
 *                    detectConflicts(): следующий рендер НЕ снимет публикацию (M2-QA-1).
 *  confirm===false → conflict_confirmed=0 и is_published=0. Снимает подтверждение,
 *                    слот снова скрыт; повторный detectConflicts() оставит его скрытым.
 *
 * Возвращает обновлённый слот или undefined (нет такого слота).
 */
export function confirmPublishConflict(slotId: string, confirm: boolean): SlotRow | undefined {
  const slot = getSlot(slotId);
  if (!slot) return undefined;
  if (confirm) {
    getDb()
      .prepare('UPDATE slot SET conflict_confirmed = 1, is_published = 1 WHERE id = ?')
      .run(slotId);
  } else {
    getDb()
      .prepare('UPDATE slot SET conflict_confirmed = 0, is_published = 0 WHERE id = ?')
      .run(slotId);
  }
  return getSlot(slotId);
}

/**
 * Снять публикацию со слота (админка). Также сбрасывает conflict_confirmed=0:
 * иначе подтверждённый конфликт остался бы «подтверждён, но скрыт» — рассинхрон.
 * Снятие публикации = отмена ручного решения (как confirmPublishConflict(id,false)).
 */
export function unpublishSlot(slotId: string): SlotRow | undefined {
  const slot = getSlot(slotId);
  if (!slot) return undefined;
  getDb()
    .prepare('UPDATE slot SET is_published = 0, conflict_confirmed = 0 WHERE id = ?')
    .run(slotId);
  return getSlot(slotId);
}

/**
 * Опубликовать неконфликтный слот (админка). Если у слота conflict_flag=1 —
 * откажет (нужен confirmPublishConflict с явным подтверждением).
 */
export function publishSlot(slotId: string): SlotRow | undefined {
  const slot = getSlot(slotId);
  if (!slot) return undefined;
  if (slot.conflict_flag === 1) return slot; // конфликт — только через confirm
  getDb().prepare('UPDATE slot SET is_published = 1 WHERE id = ?').run(slotId);
  return getSlot(slotId);
}
