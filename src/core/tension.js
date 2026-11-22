/**
 * Напряжение сцены: пять ступеней от «спокойно» (зелёный) до «опасно» (красный).
 * Считается из ленты событий: ручные правки и сдвиги по тексту рассказчика (type 'tension'),
 * а без поддержки напряжение остывает на ступень каждые несколько ответов. Всё выводится заново из ленты,
 * поэтому откатывается вместе с удалением сообщения.
 */
import { narrationOnly } from './weather-detect.js';

export const LEVELS = Object.freeze([
  { id: 'calm', ru: 'спокойно', color: '#6faa72', hint: 'nothing threatens the scene' },
  { id: 'wary', ru: 'настороженно', color: '#a9b84d', hint: 'small signs of unease, people are watchful' },
  { id: 'uneasy', ru: 'неспокойно', color: '#d6b04c', hint: 'something is off, people are on edge' },
  { id: 'alarmed', ru: 'тревожно', color: '#d98a4a', hint: 'danger is close, nerves are raw' },
  { id: 'dangerous', ru: 'опасно', color: '#c9534f', hint: 'immediate threat: fight or flight' },
]);
export const MAX_LEVEL = LEVELS.length - 1;
export const clampLevel = value => Math.min(Math.max(Math.round(Number(value) || 0), 0), MAX_LEVEL);

/** Текущее напряжение: { level, source: 'none'|'manual'|'text'|'decay' }. Остывает на ступень за decayEvery ответов без новых событий. */
export function resolveTension(state, chatLength, { decayEvery = 3 } = {}) {
  const limit = Math.max(Number(chatLength) || 0, 1);
  const events = state.timeline
    .map((event, order) => ({ event, order }))
    .filter(({ event }) => event.at < limit && (event.type === 'tension' || event.type === 'step'))
    .sort((a, b) => a.event.at - b.event.at || a.order - b.order);
  let level = 0, source = 'none', since = 0;
  for (const { event } of events) {
    if (event.type === 'tension') { level = clampLevel(event.level); source = event.source === 'text' ? 'text' : 'manual'; since = 0; continue; }
    if (decayEvery > 0 && level > 0 && ++since >= decayEvery) { level -= 1; since = 0; source = 'decay'; }
  }
  return { level, source, ...LEVELS[level] };
}

/** Строка для блока рассказчика; на «спокойно» молчим, чтобы не тратить токены. */
export function describeTension(tension) {
  if (!tension || tension.level <= 0) return '';
  const l = LEVELS[clampLevel(tension.level)];
  return `${tension.level}/${MAX_LEVEL} ${l.id} — ${l.hint}`;
}

// ---------- сдвиг по тексту ответа ----------
const P = '[\\p{L}]*';
const UP = [
  { level: 4, re: [
    `обнажил${P}\\s+(?:\\p{L}+\\s+)?(?:меч|клинок|кинжал|сабл${P}|оружие|нож)`,
    `выхватил${P}\\s+(?:\\p{L}+\\s+)?(?:меч|клинок|кинжал|оружие|топор|лук|пистолет|нож)`,
    `(?:напал${P}|атаковал${P}|выстрелил${P}|бросил${P}\\s+в\\s+атаку)`,
    `кровь\\s+(?:хлынул${P}|брызнул${P}|потекл${P})`,
    `начал(?:ся|ась|ось|ись)\\s+(?:бой|схватк${P}|драк${P}|резня|побоище)`,
    `(?:убил${P}|смертельн${P}|засад${P})`,
  ] },
  { level: 3, re: [
    `(?:закричал${P}|крик${P}|вопл${P})`, `погон${P}`, `(?:побежал${P}|бросил${P}\\s+бежать|бегом)`,
    `(?:опасност${P}|угроз${P}|паник${P}|тревог${P}|обвал|пожар)`, `(?:зарычал${P}|рычан${P})`,
    `звон\\s+(?:оружия|стали|клинк${P})`,
  ] },
  { level: 2, re: [
    `(?:шорох|насторожил${P}|подозрит${P}|ссор${P}|напряж${P})`, `повысил${P}\\s+голос`,
    `что-то\\s+(?:не\\s+так|неладно)`, `тень\\s+(?:мелькнул${P}|скользнул${P})`,
  ] },
  { level: 1, re: [`(?:осторожн${P}|прислушал${P}|огляну${P}|насторож${P})`] },
];
const CALM = [`успокоил${P}`, `рассмеял${P}`, `улыбнул${P}`, `уютн${P}`, `расслабил${P}`, `выдохнул${P}`, `костёр\\s+(?:потрескива${P}|тихо)`, `тихо\\s+и\\s+(?:спокойно|уютно)`];
const NEGATION = /(?:^|[^\p{L}])(?:не|без|ни|если|когда|будто|словно|чтобы|пока\s+не)\s*$/u;

function findLast(source, patterns) {
  let best = null;
  for (const pattern of patterns) {
    const re = new RegExp(pattern.replace(/ё/g, 'е'), 'giu');
    for (const match of source.matchAll(re)) {
      const before = source.slice(Math.max(0, match.index - 16), match.index);
      if (NEGATION.test(before)) continue;
      if (!best || match.index > best.index) best = { index: match.index, phrase: match[0] };
    }
  }
  return best;
}

// ---------- настоящий бой: только конкретные действия ----------
/**
 * Режим «Бой» включается не по настроению сцены (крики, пожар, тревога, «смертельно»), а по действиям, которые ведут к бою:
 * оружие обнажено или выхвачено, напали, атаковали, началась схватка, попали в засаду. Реплики героев и слова с отрицанием
 * («не обнажил») не считаются. Напряжение по тем же словам растёт отдельно и бой не включает.
 */
const COMBAT = [
  `(?:обнажил${P}|выхватил${P})\\s+(?:\\p{L}+\\s+)?(?:меч${P}|клинк${P}|клинок|кинжал${P}|сабл${P}|оружи${P}|топор${P}|лук|арбалет${P}|нож|ножи|пистолет${P}|посох${P}|булав${P}|молот${P})`,
  `(?:напал(?:и|а|о)?|атаковал${P}|выстрелил${P}|вступил${P}\\s+в\\s+бой|вступили\\s+в\\s+бой)(?![\\p{L}])`,
  `(?:накинул(?:ся|ась|ись)|ринул(?:ся|ась|ись)|бросил(?:ся|ась|ись))\\s+(?:в\\s+(?:атаку|бой)|на\\s+(?:него|неё|нее|нас|вас|них|врага|противника|стражн${P}|охранник${P}))`,
  `(?:выпустил${P}|метнул${P})\\s+(?:\\p{L}+\\s+)?(?:стрел${P}|кинжал${P}|топор${P}|копь${P}|копьё)`,
  `начал(?:ся|ась|ось|ись)\\s+(?:бой|схватк${P}|драк${P}|резня|побоище|сражени${P}|перестрелк${P})`,
  `(?:завязал(?:ся|ась)|разгорел(?:ся|ась))\\s+(?:бой|схватк${P}|драк${P})`,
  `(?:нанес|нанёс|нанесла)\\s+(?:\\p{L}+\\s+)?удар${P}\\s+(?:мечом|клинком|кинжалом|топором|булавой|молотом)`,
  `(?:рубанул${P}|пронзил${P}\\s+(?:\\p{L}+\\s+)?(?:мечом|клинком|кинжалом))`,
  `(?:попал${P}|угодил${P}|угодили|попали)\\s+в\\s+засад${P}|из\\s+засады`,
];
/** Есть ли в тексте ответа конкретное боевое действие. */
export function detectCombat(text) {
  const source = narrationOnly(text).toLowerCase().replace(/ё/g, 'е');
  return Boolean(findLast(source, COMBAT));
}

/**
 * Что говорит текст ответа о напряжении: { kind: 'up', level } для самой высокой ступени из найденных,
 * { kind: 'down' } если есть только спокойные слова, иначе null. Реплики героев не считаются.
 */
export function detectTension(text) {
  const source = narrationOnly(text).toLowerCase().replace(/ё/g, 'е');
  for (const group of UP) {
    const hit = findLast(source, group.re);
    if (hit) return { kind: 'up', level: group.level, phrase: hit.phrase };
  }
  const calm = findLast(source, CALM);
  return calm ? { kind: 'down', phrase: calm.phrase } : null;
}
