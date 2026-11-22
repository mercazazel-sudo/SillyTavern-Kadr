/**
 * Ручной ввод даты для любого календаря мира: «1 Хаммер 1492», «Хаммер 1, 1492 ЛД», «21.11.2026», «21 ноября» (год тогда прежний).
 * Месяц можно назвать по имени (в любой форме падежа: «ноября», «хаммера») или номером (месяцы по порядку, праздничные дни не считаются).
 * Чистая логика: Таверны и DOM не знает.
 */
import { locate } from './calendars.js';

const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();
const prefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const startOfPeriod = (periods, index) => periods.slice(0, index).reduce((s, p) => s + p.days, 1);

/** Дата словами: «21 Ноябрь 2026» (у праздничного дня без числа: «Середина зимы 1492»). */
export function formatDateText(cal, year, doy) {
  const loc = locate(cal, year, doy);
  if (!loc) return String(year);
  return loc.period.type === 'month' ? `${loc.day} ${loc.period.ru} ${year}` : `${loc.period.ru} ${year}`;
}

/** Какой период назван словом: точное имя, псевдоним (падеж), начало имени, общее начало. Неоднозначное и неизвестное дают null. */
function periodByWord(periods, word) {
  const w = norm(word);
  if (w.length < 2) return null;
  const names = p => [p.ru, ...(p.alias ?? [])].map(norm);
  const exact = periods.filter(p => names(p).includes(w));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const starts = periods.filter(p => names(p).some(n => n.startsWith(w)));
  if (starts.length === 1) return starts[0];
  if (starts.length > 1) return null;
  const score = p => Math.max(...names(p).map(n => (prefix(n, w) >= Math.max(3, Math.min(n.length, w.length) - 2) ? prefix(n, w) : 0)));
  const ranked = periods.map(p => [p, score(p)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return null;
  return ranked[0][0];
}

/**
 * Разбирает текст в { year, doy } или { error }. defaultYear берётся, когда год не указан.
 * Правила: число рядом с названием месяца до него это день, после него год; два числа без названия: день и месяц номером;
 * три числа: день, месяц, год; число больше длины месяца считается годом.
 */
export function parseDateText(cal, text, defaultYear) {
  const eraWords = new Set(['н', 'э', 'н.э', 'ce', 'ad', 'dr', ...[cal.era?.ru, cal.era?.abbr].filter(Boolean).map(norm)]);
  // названия из нескольких слов («Середина зимы», «Щитовой сход») находим целиком до разбиения на слова и прячем за значком §
  const years = [defaultYear, defaultYear + 1, defaultYear + 2, defaultYear + 3, ...(String(text).match(/\d{3,}/g) ?? []).map(Number)].filter(Number.isFinite);
  const multi = new Map();
  for (const y of years) for (const p of cal.periods(y)) for (const n of [p.ru, ...(p.alias ?? [])].map(norm)) if (n.includes(' ')) multi.set(n, p.ru);
  let phrase = '';
  let rest = norm(text);
  for (const n of [...multi.keys()].sort((x, y) => y.length - x.length)) {
    const i = rest.indexOf(n);
    if (i < 0 || (i > 0 && /\p{L}/u.test(rest[i - 1])) || /\p{L}/u.test(rest[i + n.length] ?? '')) continue;
    phrase = multi.get(n); rest = `${rest.slice(0, i)} § ${rest.slice(i + n.length)}`;
    break;
  }
  const tokens0 = rest.split(/[\s.,/\\\-]+/).map(x => x.trim()).filter(Boolean).filter(x => !eraWords.has(norm(x)));
  const tokens = tokens0.map(x => (x === '§' ? phrase : x));
  if (!tokens.length) return { error: 'Введите дату, например «1 Хаммер 1492».' };
  const isNum = x => /^\d+$/.test(x);
  const words = tokens.filter(x => !isNum(x)), nums = tokens.filter(isNum).map(Number);
  if (words.length > 1) return { error: 'Не понял: в дате два названия.' };
  let year = defaultYear, period = null, day = 1, periods;
  if (words.length === 1) {
    const w = words[0], at = tokens.indexOf(w);
    // год нужен, чтобы знать состав года (високосный день, праздники), поэтому сначала определяем его
    const before = tokens.slice(0, at).filter(isNum).map(Number), after = tokens.slice(at + 1).filter(isNum).map(Number);
    if (before.length && after.length) { day = before[0]; year = after[0]; }
    else if (before.length) { if (before.length >= 2) { day = before[0]; year = before[1]; } else day = before[0]; }
    else if (after.length) { if (after.length >= 2) { day = after[0]; year = after[1]; } else { day = after[0]; } }
    periods = cal.periods(year);
    period = periodByWord(periods, w);
    if (!period) return { error: `Не нашёл месяц «${w}» в этом календаре.` };
    // одно число после названия бывает и днём, и годом: если оно больше длины месяца, это год
    if (!before.length && after.length === 1 && day > period.days) { year = day; day = 1; periods = cal.periods(year); period = periods.find(p => p.id === period.id) ?? period; }
  } else {
    if (nums.length < 2) return { error: 'Нужны хотя бы день и месяц, например «21.11» или «1 Хаммер».' };
    day = nums[0]; year = nums.length >= 3 ? nums[2] : defaultYear;
    periods = cal.periods(year);
    const months = periods.filter(p => p.type === 'month');
    period = months[nums[1] - 1];
    if (!period) return { error: `В этом календаре нет месяца номер ${nums[1]}.` };
  }
  if (!Number.isFinite(year) || year < -9999 || year > 99999) return { error: 'Год выглядит неверно.' };
  periods = cal.periods(year);
  const idx = periods.findIndex(p => p.id === period.id);
  if (idx < 0) return { error: `В ${year} году нет «${period.ru}».` };
  const p = periods[idx];
  if (p.type !== 'month') day = 1;
  if (day < 1 || day > p.days) return { error: `В «${p.ru}» ${p.days} дн., а указан ${day}-й.` };
  return { year, doy: startOfPeriod(periods, idx) + day - 1 };
}
