/** Состояние чата: лежит в chat_metadata.sceneJournal. Чистая логика, Таверны не знает. */
import { normalizeRelations, emptyRelations } from './relations.js';
import { normalizeKnowledge, emptyKnowledge } from './secrets.js';
import { normalizeFate, emptyFate } from './fate.js';
import { normalizeChatCards, emptyChatCards } from './cards.js';
import { normalizeInventory } from './inventory.js';
import { normalizeOutfits } from './gear.js';
import { normalizeMap, emptyMap } from './places.js';
import { CALENDARS, yearLength } from './calendars.js';
import { KIND_IDS, CLIMATE_IDS } from './weather.js';
import { clampLevel } from './tension.js';
import { cleanLetter } from './letter.js';
import { normalizeCast, normalizeBodies } from './body.js';
import { normalizeQuests } from './journal.js';

export const STATE_KEY = 'sceneJournal';
export const SCHEMA = 1;
const EVENT_TYPES = new Set(['step', 'skip', 'set', 'weather', 'tension']);

/** Снимки других миров этого чата: { id календаря: состояние }. Нормализуются, когда в мир возвращаются; здесь только отсев мусора. */
function pickWorlds(raw, active) {
  const out = {};
  for (const [id, snap] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (id === active || !CALENDARS[id] || !snap || typeof snap !== 'object' || Array.isArray(snap)) continue;
    const { worlds, ...rest } = snap;
    out[id] = rest;
  }
  return out;
}

/**
 * Смена мира без потерь: всё, что велось в нынешнем мире (время, отношения, тайны, анкеты, раны, вещи, карта, квесты, место),
 * откладывается за ним и вернётся, когда в этот мир вернутся. Новый мир начинается с чистой истории, но игрок остаётся тем же:
 * персона переходит с собой. Возвращает новое состояние, исходное не меняет.
 */
export function switchWorld(state, id) {
  if (!CALENDARS[id] || state.calendar === id) return state;
  const { worlds = {}, ...current } = state;
  const keep = { ...worlds, [state.calendar]: current };
  const saved = keep[id];
  delete keep[id];
  let next;
  if (saved && typeof saved === 'object') next = normalizeState({ ...saved, calendar: id }, id);
  else {
    next = defaultState(id);
    const persona = (state.cast ?? []).find(p => p.persona);
    if (persona) { next.cast = normalizeCast([{ ...persona, present: true }]); next.personaManual = state.personaManual === true; }
  }
  return { ...next, calendar: id, worlds: pickWorlds(keep, id) };
}

export function defaultState(calendarId = 'harptos') {
  const cal = CALENDARS[calendarId] ?? CALENDARS.harptos;
  const first = typeof cal.start === 'function' ? cal.start() : { year: cal.defaultYear, doy: 1 };       // обычный мир начинается сегодня
  return { v: SCHEMA, calendar: cal.id, start: { year: first.year, doy: first.doy, minutes: 8 * 60 }, timeline: [], place: '', climate: 'temperate', letter: '', dayOne: { year: first.year, doy: first.doy }, cast: [], bodies: {}, quests: [], relations: emptyRelations(), knowledge: emptyKnowledge(), fate: emptyFate(), cards: emptyChatCards(), inventory: [], outfits: {}, map: emptyMap(), personaManual: false, worlds: {} };
}

const int = (value, fallback) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);

function cleanEvent(raw, calendarId) {
  if (!raw || typeof raw !== 'object' || !EVENT_TYPES.has(raw.type)) return null;
  const at = int(raw.at, -1);
  if (at < 0) return null;
  if (raw.type === 'set') {
    const cal = CALENDARS[calendarId];
    const year = int(raw.year, NaN), doy = int(raw.doy, NaN), minutes = int(raw.minutes, NaN);
    if (!cal || !Number.isFinite(year) || !Number.isFinite(doy) || !Number.isFinite(minutes)) return null;
    if (doy < 1 || doy > yearLength(cal, year) || minutes < 0 || minutes >= 1440) return null;
    return { type: 'set', at, year, doy, minutes };
  }
  if (raw.type === 'weather') {
    // ручная погода на конкретный день: day = 'год:день', температура итоговая, текст необязательный
    const kind = KIND_IDS.includes(raw.kind) ? raw.kind : null;
    const day = /^-?\d+:\d+$/.test(String(raw.day)) ? String(raw.day) : null;
    if (!kind || !day) return null;
    const tempC = Number.isFinite(Number(raw.tempC)) && raw.tempC !== null && raw.tempC !== '' ? Math.min(Math.max(Math.round(Number(raw.tempC)), -70), 70) : null;
    return { type: 'weather', at, day, kind, tempC, text: typeof raw.text === 'string' ? raw.text.slice(0, 60) : '', source: raw.source === 'text' ? 'text' : 'manual' };
  }
  if (raw.type === 'tension') {
    if (!Number.isFinite(Number(raw.level))) return null;
    return { type: 'tension', at, level: clampLevel(raw.level), source: raw.source === 'text' ? 'text' : 'manual' };
  }
  const minutes = int(raw.minutes, NaN);
  if (!Number.isFinite(minutes)) return null;
  return { type: raw.type, at, minutes };
}

/** Приводит то, что лежит в метаданных чата, к рабочему виду; всё лишнее и кривое отбрасывается. */
export function normalizeState(raw, fallbackCalendar = 'harptos') {
  const base = defaultState(CALENDARS[raw?.calendar] ? raw.calendar : fallbackCalendar);
  if (!raw || typeof raw !== 'object') return base;
  const cal = CALENDARS[base.calendar];
  const startYear = int(raw.start?.year, base.start.year);
  const startDoy = int(raw.start?.doy, 1);
  const startMin = int(raw.start?.minutes, base.start.minutes);
  const startOk = startDoy >= 1 && startDoy <= yearLength(cal, startYear) && startMin >= 0 && startMin < 1440;
  const start = startOk ? { year: startYear, doy: startDoy, minutes: startMin } : base.start;
  const cast = normalizeCast(raw.cast);
  const inventory = normalizeInventory(raw.inventory);
  // день, который считается первым днём истории (счётчик «Д1, Д2, Д3…»); по умолчанию это дата начала чата
  const d1Year = int(raw.dayOne?.year, NaN), d1Doy = int(raw.dayOne?.doy, NaN);
  const dayOneOk = Number.isFinite(d1Year) && Number.isFinite(d1Doy) && d1Doy >= 1 && d1Doy <= yearLength(cal, d1Year);
  return {
    v: SCHEMA,
    calendar: base.calendar,
    start,
    dayOne: dayOneOk ? { year: d1Year, doy: d1Doy } : { year: start.year, doy: start.doy },
    timeline: (Array.isArray(raw.timeline) ? raw.timeline : []).map(e => cleanEvent(e, base.calendar)).filter(Boolean).slice(-2000),
    place: typeof raw.place === 'string' ? raw.place.slice(0, 400) : '',
    climate: CLIMATE_IDS.includes(raw.climate) ? raw.climate : 'temperate',
    letter: cleanLetter(raw.letter),
    cast,
    bodies: normalizeBodies(raw.bodies, new Set(cast.map(person => person.id))),
    quests: normalizeQuests(raw.quests),
    relations: normalizeRelations(raw.relations),
    knowledge: normalizeKnowledge(raw.knowledge),
    fate: normalizeFate(raw.fate),
    cards: normalizeChatCards(raw.cards),
    inventory,
    outfits: normalizeOutfits(raw.outfits, inventory),
    map: normalizeMap(raw.map),
    personaManual: raw.personaManual === true,
    worlds: pickWorlds(raw.worlds, base.calendar),
  };
}

/** Убирает события сообщений, которых больше нет (удалили ответ). Возвращает true, если что-то убрано. */
export function trimTimeline(state, chatLength) {
  const limit = Math.max(Number(chatLength) || 0, 1);
  const before = state.timeline.length;
  state.timeline = state.timeline.filter(e => e.at < limit);
  return state.timeline.length !== before;
}

export const hasStep = (state, at) => state.timeline.some(e => e.type === 'step' && e.at === at);

/** Событие привязывается к последнему сообщению, чтобы откатываться вместе с ним. */
export const lastIndex = chatLength => Math.max((Number(chatLength) || 0) - 1, 0);

export function addEvent(state, event) {
  state.timeline.push(event);
  return state;
}
