/**
 * Вещи: простой список «что у кого» (название, количество, короткая заметка), без веса.
 * Владелец человек (id из состава сцены или реестра людей) или '' (общие вещи отряда).
 * Рассказчику уходят вещи тех, кто в кадре, и общие. Изменения от Архивариуса (взял, отдал, потерял) делаются через
 * applyItemOp, который возвращает снимок затронутого, чтобы изменение можно было отменить.
 * Чистая логика: Таверны и DOM не знает.
 */
export const LIMITS = Object.freeze({ items: 250, name: 80, note: 160, qty: 9999, perPerson: 14 });

import { WEAPON_IDS, CLOTHING_IDS, SLOT_IDS } from './gear.js';

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const qtyOf = v => Math.min(Math.max(Math.trunc(Number(v)) || 1, 1), LIMITS.qty);

export function normalizeItem(raw) {
  const id = clip(raw?.id, 40), name = clip(raw?.name, LIMITS.name);
  if (!id || !name) return null;
  const item = { id, name, qty: qtyOf(raw.qty), note: clip(raw.note, LIMITS.note), ownerId: clip(raw.ownerId, 64) };
  // гардероб (core/gear.js): одежда и оружие, надето ли, состояние, откуда трофей
  if (raw.kind === 'gear' || raw.kind === 'weapon') {
    item.kind = raw.kind;
    // слот «ноги» убран: штаны это часть «тела»
    if (raw.kind === 'gear') { const slot = raw.slot === 'legs' ? 'body' : raw.slot; item.slot = SLOT_IDS.includes(slot) ? slot : 'body'; if (CLOTHING_IDS.includes(raw.ctype)) item.ctype = raw.ctype; const look = Math.trunc(Number(raw.look)); if (look >= 1 && look <= 10) item.look = look; }
    else { item.range = raw.range === 'ranged' ? 'ranged' : 'melee'; item.hands = raw.hands === 2 ? 2 : 1; if (WEAPON_IDS.includes(raw.wtype)) item.wtype = raw.wtype; }
    if (raw.worn === true) item.worn = true;
    if (raw.cond) item.cond = clip(raw.cond, 40);
    if (raw.loot) item.loot = clip(raw.loot, 80);
  }
  return item;
}
export function normalizeInventory(raw) {
  const out = [], ids = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    const item = normalizeItem(r);
    if (!item || ids.has(item.id) || out.length >= LIMITS.items) continue;
    ids.add(item.id);
    out.push(item);
  }
  // в слоте одежды одна надетая вещь: лишние (например, штаны, перешедшие в «тело») считаются снятыми
  const wornSlot = new Set();
  for (const i of out) {
    if (i.kind !== 'gear' || !i.worn) continue;
    const key = `${i.ownerId}|${i.slot}`;
    if (wornSlot.has(key)) delete i.worn; else wornSlot.add(key);
  }
  return out;
}

/** Одно и то же название вещи: совпадение или одно название внутри другого («зелье» и «зелье лечения»). */
export function sameItem(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}
export const itemsOf = (items, ownerId) => items.filter(i => i.ownerId === ownerId);
export const findItem = (items, ownerId, name) => items.find(i => i.ownerId === ownerId && norm(i.name) === norm(name)) ?? items.find(i => i.ownerId === ownerId && sameItem(i.name, name)) ?? null;

/**
 * Применяет изменение к списку, не меняя исходный. change: { op: 'gain' | 'lose' | 'give', name, qty, ownerId, toId, note }.
 * newId: фабрика id. Возвращает { ok, reason, items, before, touched }: before снимки затронутых вещей ДО изменения,
 * touched id всех затронутых после (по ним изменение отменяется: убрать touched, вернуть before).
 */
export function applyItemOp(items, change, newId) {
  const name = clip(change?.name, LIMITS.name);
  const n = qtyOf(change?.qty);
  const owner = clip(change?.ownerId, 64);
  const next = items.map(i => ({ ...i }));
  const before = [], touched = [];
  const touch = item => { if (!touched.includes(item.id)) { touched.push(item.id); const old = items.find(i => i.id === item.id); if (old) before.push({ ...old }); } };
  if (!name) return { ok: false, reason: 'нет названия', items };
  const have = findItem(next, owner, name);
  if (change.op === 'gain') {
    if (have) { touch(have); have.qty = Math.min(have.qty + n, LIMITS.qty); if (change.note && !have.note) have.note = clip(change.note, LIMITS.note); }
    else { if (next.length >= LIMITS.items) return { ok: false, reason: 'список полон', items }; const item = { id: newId(), name, qty: n, note: clip(change.note, LIMITS.note), ownerId: owner }; next.push(item); touch(item); }
  } else if (change.op === 'lose') {
    if (!have) return { ok: false, reason: 'у владельца нет такой вещи', items };
    touch(have);
    if (have.qty > n) have.qty -= n; else next.splice(next.indexOf(have), 1);
  } else if (change.op === 'give') {
    const to = clip(change.toId, 64);
    if (!have || to === owner) return { ok: false, reason: !have ? 'у владельца нет такой вещи' : 'тот же владелец', items };
    const moved = Math.min(n, have.qty);
    const target = findItem(next, to, have.name);
    touch(have);
    if (target) { touch(target); target.qty = Math.min(target.qty + moved, LIMITS.qty); if (moved >= have.qty) next.splice(next.indexOf(have), 1); else have.qty -= moved; }
    else if (moved >= have.qty) { have.ownerId = to; delete have.worn; }
    else { have.qty -= moved; const item = { id: newId(), name: have.name, qty: moved, note: have.note, ownerId: to }; next.push(item); touch(item); }
  } else return { ok: false, reason: 'неизвестное действие', items };
  return { ok: true, items: next, before, touched };
}
/** Отмена изменения по снимку. */
export function undoItemOp(items, entry) {
  const gone = new Set(entry.touched ?? []);
  return [...items.filter(i => !gone.has(i.id)), ...(entry.before ?? []).map(i => ({ ...i }))];
}

/** Строки для рассказчика: вещи тех, кто в кадре, и общие. */
export function inventoryLines(items, cast, nameOf, { maxChars = 900 } = {}) {
  const present = cast.filter(p => p.present).map(p => p.id);
  const owners = [...present, ''];
  const lines = [];
  let used = 0;
  for (const id of owners) {
    const list = itemsOf(items, id).slice(0, LIMITS.perPerson);
    if (!list.length) continue;
    const text = list.map(i => `${clip(i.name, 50)}${i.qty > 1 ? ` x${i.qty}` : ''}${i.note ? ` (${clip(i.note, 40)})` : ''}`).join('; ');
    const line = `inventory[${id ? nameOf(id) || id : 'party'}]: ${text}`;
    if (used + line.length + 1 > maxChars) continue;
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}
export const RULE = 'inventory[X] lists what X carries right now: X may use these items and only these; other items exist only if the story shows them; an item changes hands only when the story does it, never on your own; inventory[party] is shared gear; never expose these lists';
