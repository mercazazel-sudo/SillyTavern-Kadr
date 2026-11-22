/**
 * Погода сцены. Считается сама, без модели: по сезону мира и климату, детерминированно
 * (одна и та же дата и климат всегда дают одну и ту же погоду). Вручную её можно перебить на текущий день.
 * Ручные правки лежат в ленте событий (type 'weather') с привязкой к сообщению, поэтому откатываются вместе с ним.
 */
import { CALENDARS, seasonOf, yearLength } from './calendars.js';

export const KINDS = Object.freeze({
  clear: { ru: 'ясно', icon: '☀' },
  cloudy: { ru: 'пасмурно', icon: '☁' },
  rain: { ru: 'дождь', icon: '☂' },
  storm: { ru: 'гроза', icon: 'ϟ' },
  snow: { ru: 'снег', icon: '❄' },
  fog: { ru: 'туман', icon: '≋' },
  wind: { ru: 'ветрено', icon: '≈' },
  heat: { ru: 'жара', icon: '♨' },
});
export const KIND_IDS = Object.freeze(Object.keys(KINDS));

// вес каждой погоды по сезонам для умеренного климата
const BASE = {
  зима:  { clear: 20, cloudy: 30, rain: 5, storm: 0, snow: 30, fog: 10, wind: 10, heat: 0 },
  весна: { clear: 30, cloudy: 25, rain: 30, storm: 5, snow: 2, fog: 5, wind: 10, heat: 0 },
  лето:  { clear: 45, cloudy: 15, rain: 15, storm: 10, snow: 0, fog: 3, wind: 5, heat: 12 },
  осень: { clear: 12, cloudy: 30, rain: 30, storm: 4, snow: 3, fog: 15, wind: 15, heat: 0 },
};
// температура днём: [от, до] по сезонам для умеренного климата
const TEMP = { зима: [-8, 2], весна: [3, 14], лето: [16, 28], осень: [2, 12] };

/** Климаты: множители весов и сдвиг температуры. */
export const CLIMATES = Object.freeze({
  temperate: { ru: 'умеренный', shift: 0, mult: {} },
  north: { ru: 'северный, холодный', shift: -10, mult: { snow: 2, heat: 0, storm: 0.5, wind: 1.3 } },
  coast: { ru: 'побережье', shift: 1, mult: { rain: 1.5, fog: 2, wind: 1.8, clear: 0.8, snow: 0.4 } },
  desert: { ru: 'пустыня, сухо', shift: 10, mult: { rain: 0.1, storm: 0.1, snow: 0, fog: 0.1, clear: 2, heat: 3, wind: 1.5, cloudy: 0.4 } },
  tropics: { ru: 'тропики, влажно', shift: 12, mult: { rain: 2, storm: 1.8, snow: 0, fog: 0.6, heat: 1.6, wind: 0.8 } },
});
export const CLIMATE_IDS = Object.freeze(Object.keys(CLIMATES));

const mod = (a, b) => ((a % b) + b) % b;

/** Сезон по календарю мира; если у мира сезонов нет (Экзандрия), берём приблизительно по доле года. */
export function seasonFor(calendarId, year, doy) {
  const cal = CALENDARS[calendarId];
  const own = cal ? seasonOf(cal, year, doy) : '';
  if (BASE[own]) return own;
  const f = (doy - 1) / Math.max(cal ? yearLength(cal, year) : 365, 1);
  return f < 0.2 ? 'зима' : f < 0.45 ? 'весна' : f < 0.7 ? 'лето' : f < 0.9 ? 'осень' : 'зима';
}

// небольшой детерминированный генератор: хеш строки (FNV-1a) -> xorshift32
function rng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let x = (h >>> 0) || 0x9E3779B9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

function pick(weights, random) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return 'clear';
  let roll = random() * total;
  for (const [kind, w] of entries) { roll -= w; if (roll <= 0) return kind; }
  return entries[entries.length - 1][0];
}

/** Погода этого дня: { kind, tempC } — дневная температура. Детерминированно по миру, дате, климату и соли. */
export function generateWeather(calendarId, year, doy, climateId = 'temperate', salt = '') {
  const climate = CLIMATES[climateId] ?? CLIMATES.temperate;
  const season = seasonFor(calendarId, year, doy);
  const random = rng(`${calendarId}|${year}|${doy}|${climateId}|${salt}`);
  const weights = {};
  for (const [kind, w] of Object.entries(BASE[season])) weights[kind] = w * (climate.mult[kind] ?? 1);
  const kind = pick(weights, random);
  const [lo, hi] = TEMP[season];
  let tempC = Math.round(lo + random() * (hi - lo) + climate.shift);
  if (kind === 'snow') tempC = Math.min(tempC, 0);
  if (kind === 'heat') tempC = Math.max(tempC, 27);
  if (kind === 'rain' || kind === 'storm') tempC = Math.min(tempC, Math.max(tempC - 2, lo + climate.shift));
  return { kind, tempC };
}

/** Температура в течение суток: ночью холоднее, днём теплее. */
export function tempAt(tempC, minutes) {
  const hour = Math.floor(mod(minutes, 1440) / 60);
  const offset = hour >= 22 || hour < 5 ? -3 : hour < 11 ? -1 : hour < 17 ? 2 : 0;
  return Math.round(tempC + offset);
}

export const dayKey = (year, doy) => `${year}:${doy}`;

/**
 * Погода сейчас: ручная правка этого дня (последняя по ленте, пока её сообщение существует) или рассчитанная.
 * Возвращает { kind, tempC, text, manual } или null, если погода выключена.
 */
export function resolveWeather(state, time, chatLength, enabled = true) {
  if (!enabled) return null;
  const limit = Math.max(Number(chatLength) || 0, 1);
  const key = dayKey(time.year, time.doy);
  let manual = null;
  for (const event of state.timeline) if (event.type === 'weather' && event.at < limit && event.day === key) manual = event;
  const base = manual ?? { ...generateWeather(state.calendar, time.year, time.doy, state.climate), text: '' };
  // ручную температуру не двигаем (человек ввёл итоговое число), рассчитанную меняем по времени суток
  const tempC = manual ? manual.tempC : tempAt(base.tempC, time.minutes);
  return { kind: base.kind, tempC, text: base.text || '', manual: Boolean(manual), source: manual ? (manual.source === 'text' ? 'text' : 'manual') : 'auto' };
}

/** Подгоняет температуру под новый вид погоды: снег не бывает тёплым, жара не бывает прохладной. */
export function adjustTemp(kind, tempC) {
  if (!Number.isFinite(tempC)) return tempC;
  if (kind === 'snow') return Math.min(tempC, 0);
  if (kind === 'heat') return Math.max(tempC, 27);
  return tempC;
}

export function describeWeather(weather) {
  if (!weather) return '';
  const k = KINDS[weather.kind] ?? KINDS.clear;
  const t = Number.isFinite(weather.tempC) ? `, ${weather.tempC > 0 ? '+' : ''}${weather.tempC}°C` : '';
  return `${weather.text ? weather.text : k.ru}${t}`;
}
