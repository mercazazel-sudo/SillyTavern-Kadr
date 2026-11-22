/**
 * Объединение двух записей об одном человеке («Arvenn Velúrin» из анкеты и «Арвенн» из текста): всё, что связано
 * с лишним (dropId), переходит к основному (keepId), имя лишнего становится «другим именем» основного.
 * Чистая функция над состоянием чата: правит его на месте, Таверны и DOM не знает.
 */
import { pairKey } from './secrets.js';

const swapPair = (key, dropId, keepId) => {
  const [a, b] = String(key).split('|');
  if (a !== dropId && b !== dropId) return key;
  const x = a === dropId ? keepId : a, y = b === dropId ? keepId : b;
  return x === y ? null : pairKey(x, y);
};
const swap = (id, dropId, keepId) => (id === dropId ? keepId : id);

/** Возвращает { ok, moved } или { ok: false, reason }. */
export function mergePeople(state, keepId, dropId) {
  if (!keepId || !dropId || keepId === dropId) return { ok: false, reason: 'same' };
  const reg = state.relations.people;
  const nameOf = id => state.cast.find(p => p.id === id)?.name ?? reg.find(p => p.id === id)?.name ?? '';
  const keepName = nameOf(keepId), dropName = nameOf(dropId);
  if (!keepName || !dropName) return { ok: false, reason: 'unknown' };
  const lower = s => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  let moved = 0;

  // имена: у основного в «других именах» появляются имя лишнего и его прежние имена
  let keepReg = reg.find(p => p.id === keepId);
  if (!keepReg) { keepReg = { id: keepId, name: keepName, aliases: [] }; reg.push(keepReg); }
  const dropReg = reg.find(p => p.id === dropId);
  for (const a of [dropName, ...(dropReg?.aliases ?? [])]) {
    if (a && lower(a) !== lower(keepName) && !keepReg.aliases.some(x => lower(x) === lower(a)) && keepReg.aliases.length < 10) keepReg.aliases.push(a);
  }
  state.relations.people = reg.filter(p => p.id !== dropId);

  // состав сцены
  const dropCast = state.cast.find(p => p.id === dropId);
  const keepCast = state.cast.find(p => p.id === keepId);
  if (dropCast && !keepCast) { dropCast.id = keepId; dropCast.name = keepName; }
  else if (dropCast) {
    if (dropCast.present && !keepCast.present) keepCast.present = true;
    if (dropCast.persona && !keepCast.persona) keepCast.persona = true;
    state.cast = state.cast.filter(p => p.id !== dropId);
  }

  // чувства: линии лишнего переходят к основному, повторы и «сам к себе» отбрасываются
  const seen = new Set();
  const lines = [];
  for (const l of state.relations.lines.filter(x => x.from !== dropId && x.to !== dropId)) { seen.add(`${l.from}>${l.to}`); lines.push(l); }
  for (const l of state.relations.lines.filter(x => x.from === dropId || x.to === dropId)) {
    const from = swap(l.from, dropId, keepId), to = swap(l.to, dropId, keepId);
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key); lines.push({ ...l, from, to }); moved += 1;
  }
  state.relations.lines = lines;
  const hcSeen = new Set();
  state.relations.headcanons = state.relations.headcanons.map(h => ({ ...h, pair: swapPair(h.pair, dropId, keepId) })).filter(h => {
    if (!h.pair) return false;
    const k = `${h.pair}|${h.text}`; if (hcSeen.has(k)) return false; hcSeen.add(k); return true;
  });
  state.relations.triangles = state.relations.triangles.map(t => ({ ...t, centerId: swap(t.centerId, dropId, keepId), firstId: swap(t.firstId, dropId, keepId), secondId: swap(t.secondId, dropId, keepId) }))
    .filter(t => new Set([t.centerId, t.firstId, t.secondId]).size === 3);
  for (const e of state.relations.log) { if (e.personId === dropId) e.personId = keepId; }

  // тело, вещи
  if (state.bodies[dropId]) { if (!state.bodies[keepId]) state.bodies[keepId] = state.bodies[dropId]; delete state.bodies[dropId]; }
  for (const item of state.inventory) if (item.ownerId === dropId) item.ownerId = keepId;
  if (state.outfits?.[dropId]) { state.outfits[keepId] = { ...state.outfits[dropId], ...(state.outfits[keepId] ?? {}) }; delete state.outfits[dropId]; }   // комплекты лишнего достаются основному

  // знания: кто что знает, знакомства, гибель
  const k = state.knowledge;
  for (const e of k.events) e.witnessIds = [...new Set((e.witnessIds ?? []).map(id => swap(id, dropId, keepId)))];
  const lSeen = new Set();
  k.learned = k.learned.map(l => { const n = { ...l, entityId: swap(l.entityId, dropId, keepId) }; if (l.fromId) { n.fromId = swap(l.fromId, dropId, keepId); if (n.fromId === n.entityId) delete n.fromId; } return n; })
    .filter(l => { const key = `${l.eventId}|${l.entityId}`; if (lSeen.has(key)) return false; lSeen.add(key); return true; });
  const acq = {};
  for (const [key, status] of Object.entries(k.acquaintances ?? {})) { const nk = swapPair(key, dropId, keepId); if (nk && !(nk in acq)) acq[nk] = status; }
  k.acquaintances = acq;
  if (k.deaths[dropId]) { if (!k.deaths[keepId]) k.deaths[keepId] = k.deaths[dropId]; delete k.deaths[dropId]; }

  // анкеты и режим
  if (state.cards?.entered?.[dropId] !== undefined) { if (state.cards.entered[keepId] === undefined) state.cards.entered[keepId] = state.cards.entered[dropId]; delete state.cards.entered[dropId]; }
  if (state.fate?.event?.target?.id === dropId) state.fate.event.target = { ...state.fate.event.target, id: keepId, name: keepName };
  return { ok: true, moved };
}
