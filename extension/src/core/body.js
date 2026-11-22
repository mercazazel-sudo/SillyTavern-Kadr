/**
 * «Кто в кадре» и состояние тела. Без хитпоинтов: общая ступень из пяти, раны с тяжестью и частью тела,
 * прочие состояния (отравлена, истощена). Давность ран и срок состояний считаются по календарю мира
 * (дата записи хранится, сколько прошло дней считается каждый раз), поэтому ничего не нужно «тикать».
 * Модели уходят только те, кто сейчас в кадре и у кого что-то есть.
 */
import { daysBetween } from './clock.js';

export const TIERS = Object.freeze([
  { id: 'healthy', ru: 'здоров', color: '#6faa72' },
  { id: 'bruised', ru: 'потрёпан', color: '#d6b04c' },
  { id: 'wounded', ru: 'ранен', color: '#d98a4a' },
  { id: 'badly wounded', ru: 'тяжело ранен', color: '#c9534f' },
  { id: 'near death', ru: 'при смерти', color: '#8a4a6a' },
]);
export const MAX_TIER = TIERS.length - 1;
export const clampTier = value => Math.min(Math.max(Math.round(Number(value) || 0), 0), MAX_TIER);

/** Тяжесть раны и сколько дней она примерно заживает (с перевязкой; без неё на половину дольше). Мои допущения, не правила игры. */
export const SEVERITY = Object.freeze([
  null,
  { ru: 'лёгкая', color: '#d6b04c', days: 3 },
  { ru: 'заметная', color: '#d98a4a', days: 7 },
  { ru: 'тяжёлая', color: '#c9534f', days: 14 },
]);

/** Части тела: подпись и положение метки на силуэте (картинка 1240 x 1754). Лево и право по персонажу. */
export const ZONES = Object.freeze({
  head: { ru: 'голова', x: 620, y: 160 },
  neck: { ru: 'шея', x: 620, y: 312 },
  chest: { ru: 'грудь', x: 620, y: 470 },
  belly: { ru: 'живот', x: 620, y: 745 },
  armL: { ru: 'левая рука', x: 850, y: 647 },
  armR: { ru: 'правая рука', x: 390, y: 647 },
  legL: { ru: 'левая нога', x: 718, y: 1180 },
  legR: { ru: 'правая нога', x: 522, y: 1180 },
});
export const ZONE_IDS = Object.freeze(Object.keys(ZONES));

const LIMITS = Object.freeze({ cast: 40, wounds: 20, conds: 20, name: 60, text: 120 });
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (value, fallback) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);
const cleanDate = raw => {
  const year = int(raw?.year, NaN), doy = int(raw?.doy, NaN);
  return Number.isFinite(year) && Number.isFinite(doy) && doy >= 1 ? { year, doy } : null;
};

// ---------- кто в кадре ----------
/** Список участников сцены: [{ id, name, persona, present }]. */
export function normalizeCast(raw) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const name = clip(item?.name, LIMITS.name);
    const id = clip(item?.id, 64);
    if (!name || !id || seen.has(id) || out.length >= LIMITS.cast) continue;
    seen.add(id);
    out.push({ id, name, persona: item.persona === true, present: item.present !== false });
  }
  return out;
}
export const presentCast = cast => cast.filter(person => person.present);

/**
 * Настроение: семь состояний и сила 1..3. Форма и скорость пульса, цвет и подпись для окна «Состояние»; en и note идут рассказчику.
 * bpm, amp, jit, spike, irr управляют линией пульса (удары в минуту, высота, дрожь, острые пики, неровность ритма).
 */
export const MOODS = Object.freeze([
  { id: 'calm', ru: 'Спокойный', en: 'calm', color: '#6faa72', bpm: 62, amp: 0.8, jit: 0, spike: 0, irr: 0, note: 'Ровное дыхание, неторопливые движения, внимание свободно.' },
  { id: 'happy', ru: 'Радость', en: 'happy', color: '#d6c24c', bpm: 82, amp: 0.95, jit: 0.02, spike: 0, irr: 0, note: 'Лёгкость, быстрые улыбки, голос звонче обычного.' },
  { id: 'nervous', ru: 'Нервный', en: 'nervous', color: '#d6b04c', bpm: 96, amp: 1.0, jit: 0.1, spike: 0.1, irr: 0.12, note: 'Беспокойные руки, частые взгляды по сторонам, фразы короче.' },
  { id: 'anger', ru: 'Злость', en: 'angry', color: '#d98a4a', bpm: 118, amp: 1.3, jit: 0.06, spike: 0.35, irr: 0.04, note: 'Сжатые челюсти, резкие жесты, голос ниже и жёстче.' },
  { id: 'rage', ru: 'Ярость', en: 'furious', color: '#c9534f', bpm: 150, amp: 1.7, jit: 0.14, spike: 0.7, irr: 0.06, note: 'Дрожь в руках, кровь в висках; слова рубленые, самоконтроль на пределе.' },
  { id: 'fear', ru: 'Страх', en: 'afraid', color: '#5fa8d6', bpm: 132, amp: 1.0, jit: 0.16, spike: 0.2, irr: 0.35, note: 'Рваное дыхание, зрачки широкие, тело готово бежать или замереть.' },
  { id: 'sad', ru: 'Печаль', en: 'sad', color: '#9a7bd0', bpm: 54, amp: 0.55, jit: 0.02, spike: 0, irr: 0, note: 'Тяжёлые плечи, долгие паузы, взгляд мимо собеседника.' },
]);
export const MOOD_IDS = Object.freeze(MOODS.map(m => m.id));
export const MOOD_LEVEL_RU = Object.freeze(['', 'едва', 'заметно', 'сильно']);
const MOOD_LEVEL_EN = ['', 'slightly', 'noticeably', 'strongly'];
export const moodOf = id => MOODS.find(m => m.id === id) ?? MOODS[0];
export const cleanMood = raw => (raw && MOOD_IDS.includes(raw.id) ? { id: raw.id, lvl: Math.min(Math.max(Math.trunc(Number(raw.lvl)) || 2, 1), 3) } : null);

// ---------- возбуждение ----------
// Отдельная шкала рядом с настроением (может быть вместе с любым настроением): 0 нет, 1 лёгкое, 2 заметное, 3 сильное, 4 на пределе.
export const AROUSAL_RU = Object.freeze(['нет', 'лёгкое', 'заметное', 'сильное', 'на пределе']);
const AROUSAL_EN = ['', 'slight', 'noticeable', 'strong', 'overwhelming'];
export const AROUSAL_COLOR = '#c06aa0';
export const AROUSAL_MAX = 4;
export const cleanArousal = v => Math.min(Math.max(Math.trunc(Number(v)) || 0, 0), AROUSAL_MAX);

// ---------- тела ----------
export const emptyBody = () => ({ tier: 0, wounds: [], conds: [], mood: null, arousal: 0 });

export function normalizeBodies(raw, castIds = null) {
  const out = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  for (const [id, body] of Object.entries(source)) {
    if (castIds && !castIds.has(id)) continue;
    const wounds = (Array.isArray(body?.wounds) ? body.wounds : []).map(w => {
      const since = cleanDate(w?.since);
      const sev = int(w?.sev, 0);
      const wid = clip(w?.id, 24);
      const text = clip(w?.t, LIMITS.text);
      if (!since || !wid || !text || sev < 1 || sev > 3) return null;
      return { id: wid, zone: ZONE_IDS.includes(w.zone) ? w.zone : 'chest', t: text, sev, bnd: w.bnd === true, since };
    }).filter(Boolean).slice(0, LIMITS.wounds);
    const conds = (Array.isArray(body?.conds) ? body.conds : []).map(c => {
      const cid = clip(c?.id, 24);
      const text = clip(c?.t, LIMITS.text);
      if (!cid || !text) return null;
      return { id: cid, t: text, until: cleanDate(c?.until) };
    }).filter(Boolean).slice(0, LIMITS.conds);
    out[id] = { tier: clampTier(body?.tier), wounds, conds, mood: cleanMood(body?.mood), arousal: cleanArousal(body?.arousal) };
  }
  return out;
}

/** Сколько дней прошло с записи раны (не меньше нуля). */
export const woundAge = (calendarId, wound, today) => Math.max(0, daysBetween(calendarId, wound.since, today));
/** Сколько дней примерно до заживления; 0 значит «срок вышел, можно снимать». */
export const healLeft = (wound, age) => Math.max(0, Math.round(SEVERITY[wound.sev].days * (wound.bnd ? 1 : 1.5)) - age);
/** Сколько дней осталось у состояния (null, если срок не задан; 0, если вышел). */
export const condLeft = (calendarId, cond, today) => (cond.until ? Math.max(0, daysBetween(calendarId, today, cond.until)) : null);
/** Ступень по ранам: самая тяжёлая рана (1..3), без ран 0. «При смерти» только вручную. */
export const suggestTier = wounds => (wounds.length ? Math.max(...wounds.map(w => w.sev)) : 0);

/** Строка о теле для блока рассказчика; '' если у человека всё в порядке. */
export function bodyLine(name, body, calendarId, today) {
  if (!body) return '';
  const wounds = body.wounds.map(w => {
    const age = woundAge(calendarId, w, today);
    return `${ZONES[w.zone].ru}: ${w.t} (${SEVERITY[w.sev].ru}, ${w.bnd ? 'перевязана' : 'не перевязана'}${age ? `, ${age} дн.` : ', сегодня'})`;
  });
  const conds = body.conds.map(c => {
    const left = condLeft(calendarId, c, today);
    return `${c.t}${left === null ? '' : left > 0 ? `, ещё ${left} дн.` : ', должно пройти'}`;
  });
  const mood = body.mood && body.mood.id !== 'calm' ? `mood: ${moodOf(body.mood.id).en}${body.mood.lvl > 1 ? ` (${MOOD_LEVEL_EN[body.mood.lvl]})` : ''}` : '';
  const arousal = cleanArousal(body.arousal) ? `arousal: ${AROUSAL_EN[cleanArousal(body.arousal)]}` : '';
  if (!body.tier && !wounds.length && !conds.length && !mood && !arousal) return '';
  return `body[${name}]: ${TIERS[clampTier(body.tier)].ru}${wounds.length ? `; ${wounds.join('; ')}` : ''}${conds.length ? `; ${conds.join('; ')}` : ''}${mood ? `; ${mood}` : ''}${arousal ? `; ${arousal}` : ''}`;
}

/** Строки для рассказчика: кто в кадре и тела тех, кто в кадре. */
export function buildCastLines(cast, bodies, calendarId, today, { sendBody = true } = {}) {
  const here = presentCast(cast);
  const lines = [];
  if (here.length) lines.push(`present: ${here.map(p => (p.persona ? `${p.name} (player character, never write their actions or thoughts)` : p.name)).join(', ')}`);
  if (sendBody) for (const person of here) { const line = bodyLine(person.name, bodies[person.id], calendarId, today); if (line) lines.push(line); }
  return lines;
}
