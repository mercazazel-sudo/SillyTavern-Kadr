/**
 * Время сцены: считается детерминированно, без модели.
 *
 * Состояние хранит опорную точку (start) и ленту событий времени (timeline). Каждое событие привязано
 * к номеру сообщения (at). Текущее время = опорная точка + все события, чьё сообщение ещё существует.
 * Поэтому удаление ответа откатывает и время; свайп не удваивает шаг (на сообщение один «шаг»).
 *
 * События: step (авто-шаг на ход), skip (прыжок), set (точная установка даты и времени).
 */
import { CALENDARS, addDays, yearLength } from './calendars.js';

const DAY = 1440;
const mod = (a, b) => ((a % b) + b) % b;

export const PARTS = Object.freeze(['ночь', 'утро', 'день', 'вечер']);

/** Прибавляет минуты (можно отрицательные) с переходом через сутки по календарю. */
export function addMinutes(calendarId, time, minutes) {
  const cal = CALENDARS[calendarId];
  const total = time.minutes + Math.round(minutes);
  const days = Math.floor(total / DAY);
  const rest = mod(total, DAY);
  const date = days && cal ? addDays(cal, { year: time.year, doy: time.doy }, days) : { year: time.year, doy: time.doy };
  return { year: date.year, doy: date.doy, minutes: rest };
}

/** Время к текущему моменту чата: chatLength это число сообщений в чате. */
export function resolveTime(state, chatLength) {
  const limit = Math.max(Number(chatLength) || 0, 1);
  let time = { ...state.start };
  for (const event of state.timeline) {
    if (event.at >= limit) continue;
    if (event.type === 'set') time = { year: event.year, doy: event.doy, minutes: event.minutes };
    else if (event.type === 'step' || event.type === 'skip') time = addMinutes(state.calendar, time, event.minutes);
    // события 'weather' времени не двигают
  }
  return time;
}

export function formatTime(minutes) {
  const m = mod(Math.round(minutes), DAY);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** «ночь / утро / день / вечер» по часам: ночь 22–5, утро 5–11, день 11–17, вечер 17–22. */
export function partOfDay(minutes) {
  const hour = Math.floor(mod(minutes, DAY) / 60);
  if (hour >= 22 || hour < 5) return 'ночь';
  if (hour < 11) return 'утро';
  if (hour < 17) return 'день';
  return 'вечер';
}

/** Сколько минут прибавить для быстрых кнопок: +час, до утра (06:00), до вечера (17:00), +день и т.п. */
export function skipMinutes(kind, time) {
  const m = time.minutes;
  switch (kind) {
    case 'h1': return 60;
    case 'h3': return 180;
    case 'morning': return m >= 360 ? DAY - m + 360 : 360 - m;
    case 'evening': return m >= 1020 ? DAY - m + 1020 : 1020 - m;
    case 'd1': return DAY;
    case 'd3': return 3 * DAY;
    default: return 0;
  }
}

/** Разбор «2 дня 4 часа», «90 мин», «3д», «+5ч»: возвращает минуты или null, если не поняли. */
export function parseDuration(text) {
  const source = String(text ?? '').toLowerCase().replace(',', '.').trim();
  if (!source) return null;
  // \b в JavaScript не видит кириллицу, поэтому граница слова задана через \p{L} (флаг u)
  const units = [[/(\d+(?:\.\d+)?)\s*(?:д|дн|дней|день|дня|d|day|days)(?!\p{L})/gu, DAY], [/(\d+(?:\.\d+)?)\s*(?:ч|час|часа|часов|h|hr|hour|hours)(?!\p{L})/gu, 60], [/(\d+(?:\.\d+)?)\s*(?:м|мин|минут|минуты|минуту|min|m)(?!\p{L})/gu, 1]];
  let total = 0, found = false;
  for (const [re, factor] of units) {
    for (const match of source.matchAll(re)) { total += parseFloat(match[1]) * factor; found = true; }
  }
  if (!found) { const bare = /^\+?(\d+(?:\.\d+)?)$/.exec(source); if (bare) return Math.round(parseFloat(bare[1])); return null; }
  return Math.round(total);
}

/** Сколько суток от даты from до даты to по календарю мира (отрицательно, если to раньше). Даты: { year, doy }. */
export function daysBetween(calendarId, from, to) {
  const cal = CALENDARS[calendarId];
  if (!cal) return 0;
  if (from.year === to.year) return to.doy - from.doy;
  const forward = from.year < to.year;
  const a = forward ? from : to, b = forward ? to : from;
  let days = yearLength(cal, a.year) - a.doy;
  for (let y = a.year + 1; y < b.year; y++) days += yearLength(cal, y);
  days += b.doy;
  return forward ? days : -days;
}

/** Номер дня истории: день, который считается первым (dayOne), это день 1; до него 0, −1 и так далее. */
export const dayNumber = (calendarId, dayOne, time) => daysBetween(calendarId, dayOne, time) + 1;

/** Дата, отстоящая от date на n суток (n может быть отрицательным). */
export function shiftDate(calendarId, date, n) {
  const cal = CALENDARS[calendarId];
  const moved = cal ? addDays(cal, { year: date.year, doy: date.doy }, n) : date;
  return { year: moved.year, doy: moved.doy };
}

/** Проверка даты для «set»: год целый, день в пределах года календаря, минуты 0..1439. */
export function validDate(calendarId, year, doy, minutes) {
  const cal = CALENDARS[calendarId];
  if (!cal || !Number.isInteger(year) || !Number.isInteger(doy) || !Number.isInteger(minutes)) return false;
  return doy >= 1 && doy <= yearLength(cal, year) && minutes >= 0 && minutes < DAY;
}
