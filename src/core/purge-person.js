/**
 * Убирает человека из чата совсем (меняет переданное состояние на месте): состав, тело, одежда, отношения (линии, общие
 * моменты, треугольники, хедканоны), знания (свидетель, «узнал», знакомства, смерть), метки в квестах, владелец вещей.
 * Чистая логика, Таверны не знает.
 */
export function purgePerson(state, id) {
  const name = String(state.cast.find(p => p.id === id)?.name ?? state.relations.people.find(p => p.id === id)?.name ?? '').trim().toLowerCase();
  state.cast = state.cast.filter(p => p.id !== id);
  delete state.bodies[id];
  delete state.outfits?.[id];
  const r = state.relations;
  r.people = r.people.filter(p => p.id !== id);
  r.lines = r.lines.filter(l => l.from !== id && l.to !== id);
  r.shared = r.shared.filter(s => !(s.who ?? []).includes(id));
  r.triangles = r.triangles.filter(t => ![t.centerId, t.firstId, t.secondId].includes(id));
  r.headcanons = r.headcanons.filter(h => !String(h.pair).split('|').includes(id));
  for (const item of state.inventory) if (item.ownerId === id) item.ownerId = '';
  const k = state.knowledge;
  for (const e of k.events) e.witnessIds = (e.witnessIds ?? []).filter(w => w !== id);
  k.learned = k.learned.filter(l => l.entityId !== id).map(l => { if (l.fromId !== id) return l; const { fromId, ...rest } = l; return rest; });
  for (const key of Object.keys(k.acquaintances)) if (key.split('|').includes(id)) delete k.acquaintances[key];
  delete k.deaths[id];
  if (name) for (const q of state.quests) q.who = (q.who ?? []).filter(w => String(w).trim().toLowerCase() !== name);
  delete state.cards.entered[id];
}
