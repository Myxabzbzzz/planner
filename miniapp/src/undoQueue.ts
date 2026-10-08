export type Undo = () => Promise<unknown>;
export type Offer = { id: number; text: string; undos: Undo[] };

/**
 * Новое удаление, пока висит «Отменить», не вытесняет прошлое: иначе первая запись
 * осталась бы удалённой без возможности вернуть (корзины нет, через 30 дней — насовсем).
 */
export function nextOffer(prev: Offer | null, id: number, text: string, undo: Undo): Offer {
  if (prev === null) return { id, text, undos: [undo] };
  const undos = [...prev.undos, undo];
  return { id, text: `Удалено записей: ${undos.length}`, undos };
}

/** Возвращает всё; в ответе — только то, что вернуть не вышло (для повторной попытки). */
export async function runUndos(undos: Undo[]): Promise<Undo[]> {
  const res = await Promise.allSettled(undos.map((u) => u()));
  return undos.filter((_, i) => res[i].status === "rejected");
}
