/**
 * Луны миров и их фазы. Фаза считается от даты календаря, поэтому идёт параллельно ему сама, без отдельных данных в чате:
 * номер дня от опорного года календаря плюс длина цикла. Чистая логика: Таверны и DOM не знает.
 *
 * ВНИМАНИЕ: длины циклов взяты по памяти из пересказов лора и не сверены с источниками, а точка отсчёта (новолуние в первый день
 * опорного года) выбрана произвольно. Поэтому в окне фазы помечены как условные. Эберрон: у каждого месяца своя луна с циклом в месяц.
 */
import { CALENDARS, daysFromAnchor, moonHolidays } from './calendars.js';

/** Луны по календарям: cycle в сутках (может быть дробным). */
const MOON_SETS = Object.freeze({
  harptos: [{ id: 'selune', ru: 'Селуне', en: 'Selûne', cycle: 30.4375 }],
  exandria: [{ id: 'catha', ru: 'Катха', en: 'Catha', cycle: 33 }],
  golarion: [{ id: 'golarion', ru: 'Луна Голариона', en: 'Golarion’s moon', cycle: 29.5 }],
  greyhawk: [{ id: 'luna', ru: 'Луна', en: 'Luna', cycle: 28 }, { id: 'celene', ru: 'Селена', en: 'Celene', cycle: 91 }],
  // обычный мир: средний синодический месяц, возраст Луны на начало опорного дня (1 января 2026) 12,0 суток: так полнолуние 3 января и новолуния 18 января и 17 февраля 2026 встают на настоящие даты
  earth: [{ id: 'moon', ru: 'Луна', en: 'Moon', cycle: 29.530588, offset: 12, note: 'по среднему циклу 29,53 дня, до суток от настоящей' }],
});

/** Восемь фаз. Порядок по циклу: новолуние, молодая луна (серп), первая четверть, прибывающая, полнолуние, убывающая, последняя четверть, старая луна (серп). */
export const PHASES = Object.freeze([
  { id: 'new', ru: 'Новолуние' }, { id: 'waxing-crescent', ru: 'Молодая луна' }, { id: 'first-quarter', ru: 'Первая четверть' }, { id: 'waxing-gibbous', ru: 'Прибывающая' },
  { id: 'full', ru: 'Полнолуние' }, { id: 'waning-gibbous', ru: 'Убывающая' }, { id: 'last-quarter', ru: 'Последняя четверть' }, { id: 'waning-crescent', ru: 'Старая луна' },
]);
const mod = (a, n) => ((a % n) + n) % n;
export const phaseOf = f => PHASES[Math.floor(mod(f + 1 / 16, 1) * 8) % 8];

/** Луны, которые показывать для периода: у Эберрона это луна месяца, у остальных постоянный набор мира. */
export function moonsOf(calendarId, period) {
  if (calendarId === 'eberron') return period?.type === 'month' ? [{ id: `eberron-${period.id ?? period.ru}`, ru: period.ru, en: period.en ?? '', cycle: 28, monthMoon: true }] : [];
  return MOON_SETS[calendarId] ?? [];
}

/**
 * Фаза луны в конкретный день: { f, illum, phase, event } (event: 'new' | 'full' | '' для суток, в которые приходится новолуние или полнолуние).
 * day нужен только лунам-месяцам (Эберрон), у остальных фаза считается по номеру дня от опорного года.
 */
export function moonPhase(calendarId, moon, year, doy, day = 1) {
  const cal = CALENDARS[calendarId];
  const abs = cal ? daysFromAnchor(cal, year) + (doy - 1) : doy - 1;
  const pos = moon.monthMoon ? day - 1 : mod(abs + (moon.offset ?? 0), moon.cycle);        // сколько суток прошло от новолуния к началу этих суток
  const f = pos / moon.cycle;
  // как в настоящих календарях: новолуние, первая четверть, полнолуние и последняя четверть это мгновения, и каждое отмечено одними сутками,
  // в которые оно попало ([pos, pos + 1) содержит мгновение). Остальные дни называются по отрезку между мгновениями.
  const q = moon.cycle / 4;
  const holds = instant => pos <= instant && instant < pos + 1;
  const nearNew = pos === 0 || pos > moon.cycle - 1;
  const nearFull = holds(2 * q);
  const mark = nearNew ? 0 : holds(q) ? 2 : nearFull ? 4 : holds(3 * q) ? 6 : [1, 3, 5, 7][Math.min(3, Math.floor(pos / q))];
  return { f, illum: (1 - Math.cos(2 * Math.PI * f)) / 2, phase: PHASES[mark], event: nearNew ? 'new' : nearFull ? 'full' : '' };
}

/**
 * Значок фазы (svg-строка): круг, освещённая часть закрашена цветом текста, остальное тёмное; растущая луна освещена справа, убывающая слева.
 * event ('new' | 'full' | '') это день самого новолуния или полнолуния: он рисуется чистым тёмным или полным кругом. У соседних дней
 * форма сжата, чтобы они оставались «надкушенными» (тонкий светлый серп у новолуния, тонкая тёмная долька у полнолуния), а не сливались с пиком.
 */
export function moonSvg(f, size = 24, event = '') {
  const r = 9.5, c = 12;
  let k = Math.cos(2 * Math.PI * f);
  if (event === 'full') k = -1;
  else if (event === 'new') k = 1;
  else if (Math.abs(k) > 0.6) k = Math.sign(k) * (0.6 + (Math.abs(k) - 0.6) * 0.5);      // |k| ≤ 0.8: у соседей пика остаётся видимый «укус»
  const illum = (1 - k) / 2;
  const base = `<circle class="dk" cx="${c}" cy="${c}" r="${r}"/>`;
  let lit = '';
  if (illum > 0.995) lit = `<circle class="lt" cx="${c}" cy="${c}" r="${r}"/>`;
  else if (illum > 0.005) {
    const waxing = f < 0.5, rx = (r * Math.abs(k)).toFixed(2);
    const sweep = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
    lit = `<path class="lt" d="M${c} ${c - r}A${r} ${r} 0 0 ${waxing ? 1 : 0} ${c} ${c + r}A${rx} ${r} 0 0 ${sweep} ${c} ${c - r}z"/>`;
  }
  return `<svg class="moon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${base}${lit}<circle class="ol" cx="${c}" cy="${c}" r="${r}"/></svg>`;
}

// ---------- праздники «по луне» на конкретных днях ----------
export const PHASE_HOLIDAY_RU = Object.freeze({ full: 'полнолуние', new: 'новолуние', young: 'молодая луна' });

/** Какие лунные события приходятся на этот день: 'full', 'new', 'young' (сутки после новолуния). */
export function moonDayKinds(calendarId, moon, year, doy, day = 1) {
  const now = moonPhase(calendarId, moon, year, doy, day);
  const before = moon.monthMoon ? (day > 1 ? moonPhase(calendarId, moon, year, doy - 1, day - 1) : null) : moonPhase(calendarId, moon, year, doy - 1);
  const kinds = [];
  if (now.event === 'full') kinds.push('full');
  if (now.event === 'new') kinds.push('new');
  if (before?.event === 'new') kinds.push('young');
  return kinds;
}

/**
 * Праздники «по луне» с заданной фазой, которые выпадают на этот день: из включённых слоёв (layers: Set id или null для всех).
 * Возвращает записи с днём d, как обычные праздники (moon: false), чтобы окна показывали их так же.
 */
export function moonHolidaysOn(calendarId, layers, year, doy, day, period) {
  const cal = CALENDARS[calendarId];
  const list = moonHolidays(cal, layers).filter(h => h.phase);
  if (!list.length) return [];
  const moon = moonsOf(calendarId, period)[0];
  if (!moon) return [];
  const kinds = moonDayKinds(calendarId, moon, year, doy, day);
  return list.filter(h => kinds.includes(h.phase)).map(h => ({ ...h, moon: false, linked: true, d: day }));
}
