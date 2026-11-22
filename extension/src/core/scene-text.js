/** Тексты сцены: подпись даты и блок для рассказчика. Чистая логика. */
import { RULE as RELATION_RULE } from './relations.js';
import { RULE as KNOWLEDGE_RULE } from './secrets.js';
import { FATE_RULE } from './fate.js';
import { RULE as INVENTORY_RULE } from './inventory.js';
import { GEAR_RULE } from './gear.js';
import { RULE as PLACE_RULE } from './places.js';
import { CALENDARS, locate, seasonOf, yearLength, holidaysOf, defaultLayers } from './calendars.js';
import { moonHolidaysOn } from './moon.js';
import { formatTime, partOfDay, dayNumber } from './clock.js';
import { describeWeather } from './weather.js';
import { describeTension } from './tension.js';
import { QUEST_RULE } from './journal.js';

/** Включённые слои праздников: из настроек, иначе по умолчанию календаря. */
export function enabledLayers(settings, calendarId) {
  const cal = CALENDARS[calendarId];
  const saved = settings?.layers?.[calendarId];
  const known = new Set((cal?.layers ?? []).map(l => l.id));
  return Array.isArray(saved) ? new Set(saved.filter(id => known.has(id))) : defaultLayers(cal);
}

/** Праздники этого дня из включённых слоёв: с датой и «по луне» с фазой, выпавшие на этот день (полнолуние, новолуние). */
export function holidaysToday(calendarId, time, layers) {
  const cal = CALENDARS[calendarId];
  const loc = locate(cal, time.year, time.doy);
  if (!loc) return [];
  return [...holidaysOf(loc.period, layers).filter(h => !h.moon && h.d <= loc.day && loc.day <= (h.to ?? h.d)), ...moonHolidaysOn(calendarId, layers, time.year, time.doy, loc.day, loc.period)];
}

/** Описание даты для окна и строки: название дня, год с эрой, сезон, номер дня в году, праздники. */
export function describeDate(calendarId, time, layers, dayOne = null) {
  const cal = CALENDARS[calendarId];
  const loc = locate(cal, time.year, time.doy);
  const storyDay = dayOne ? dayNumber(calendarId, dayOne, time) : null;   // «Д3»: день истории
  if (!loc) return { name: '?', year: time.year, era: cal.era.ru, season: '', doy: time.doy, yearDays: yearLength(cal, time.year), festival: false, holidays: [], storyDay };
  const festival = loc.period.type === 'festival';
  return {
    name: festival ? loc.period.ru : `${loc.period.ru}, ${loc.day}`,
    year: time.year,
    era: cal.era.ru,
    season: seasonOf(cal, time.year, time.doy),
    doy: time.doy,
    yearDays: yearLength(cal, time.year),
    festival,
    storyDay,
    holidays: holidaysToday(calendarId, time, layers),
  };
}

/**
 * Блок для рассказчика. Ключи английские, значения русские: так короче по токенам и понятно любой модели.
 * Возвращает '' если рассказчику нечего сообщить.
 */
/** Краткие правила: смысл тот же, но втрое короче. Они уходят с каждым запросом, поэтому длинные формулировки заметно утяжеляют промпт. */
export const SHORT_RULES = Object.freeze({
  place: 'the place card describes the current location: stay consistent with it; listed changes still hold, never reset them; never expose it',
  quest: 'quests are threads the story may pick up, never tasks handed to the player: never write the player\'s actions or choices; let open leads surface through events, do not rush or announce them; never mark anything done yourself',
  relation: 'feelings colour behaviour only when the character is present and it fits, not in every reply; strong >=65, noticeable 30-64, slight 10-29; negative feelings matter as much as warm ones; never advance, resolve or jump relationship stages on your own; grow[] explains reactions and endpoint is a distant direction, never rush it; headcanon lines are true background, never recite them; never expose numbers',
  knowledge: 'unknown[X]: X must not mention, hint at or act on it until told on page; heard[X] is second-hand, a rumour may be wrong; strangers[A & B] have never met, no names or history until they get acquainted in the story; seen[A & B] know faces, not names; dead[X] never appears alive; secret[X] is private to X, never said in front of others; never expose labels',
  fate: 'scene mode colours pacing and detail; a fate event is a one-time complication: weave it in naturally, never announce or repeat it; harm is only a possibility; dice details direct an intimate scene, write only your own characters; companions\' suggestions come from them, never force the user\'s character',
  inventory: 'inventory[X] is what X carries now: X may use only these; items change hands only when the story does it; party = shared gear; never expose the lists',
});

export function buildSceneBlock({ state, time, layers, sendHolidays = true, weather = null, tension = null, castLines = [], questLines = [], relationLines = [], knowledgeLines = [], fateLines = [], inventoryLines = [], placeLines = [], shortRules = true }) {
  const R = (key, long) => (shortRules ? SHORT_RULES[key] : long);
  const d = describeDate(state.calendar, time, layers, state.dayOne);
  const lines = ['[SCENE STATE — keep the narration consistent with it; never mention this block]'];
  lines.push(`time: ${d.storyDay != null ? `story day ${d.storyDay}, ` : ''}${formatTime(time.minutes)}, ${partOfDay(time.minutes)}`);
  lines.push(`date: ${d.name}${d.festival ? ' (festival day, outside the months)' : ''}, ${d.year} ${d.era}${d.season ? `, ${d.season}` : ''}`);
  if (sendHolidays && d.holidays.length) lines.push(`holiday today: ${d.holidays.map(h => h.ru).join('; ')}`);
  if (state.place) lines.push(`place: ${state.place}`);
  for (const line of placeLines) lines.push(line);
  if (placeLines.length) lines.push(`place rules: ${R('place', PLACE_RULE)}`);
  if (weather) lines.push(`weather outdoors: ${describeWeather(weather)}`);
  const tens = describeTension(tension);
  if (tens) lines.push(`tension: ${tens}`);
  for (const line of castLines) lines.push(line);
  for (const line of questLines) lines.push(line);
  if (questLines.length) lines.push(`quest rules: ${R('quest', QUEST_RULE)}`);
  for (const line of relationLines) lines.push(`relation: ${line}`);
  if (relationLines.length) lines.push(`relation rules: ${R('relation', RELATION_RULE)}`);
  for (const line of knowledgeLines) lines.push(`knowledge: ${line}`);
  if (knowledgeLines.length) lines.push(`knowledge rules: ${R('knowledge', KNOWLEDGE_RULE)}`);
  for (const line of fateLines) lines.push(line);
  if (fateLines.length) lines.push(`fate rules: ${R('fate', FATE_RULE)}`);
  for (const line of inventoryLines) lines.push(line);
  if (inventoryLines.some(l => l.startsWith('inventory['))) lines.push(`inventory rules: ${R('inventory', INVENTORY_RULE)}`);
  if (inventoryLines.some(l => l.startsWith('outfit['))) lines.push(`outfit rules: ${GEAR_RULE}`);
  return lines.join('\n');
}


/** Вес блока по смыслу: сколько знаков занимает каждая часть того, что уходит основной модели (по начальным словам строк). */
export function blockStats(block) {
  const groups = [
    ['правила (служебное)', /^(quest rules|relation rules|knowledge rules|fate rules|inventory rules|outfit rules|place rules|\[SCENE STATE)/],
    ['время, место, погода', /^(time|date|holiday today|place:|weather outdoors|tension)/],
    ['состав и тело', /^(present|body\[)/],
    ['квесты', /^quest\[/],
    ['отношения', /^relation:/],
    ['тайны и знания', /^knowledge:/],
    ['вещи', /^(inventory|outfit)\[/],
    ['карточка места', /^place card/],
    ['режим и кости судьбы', /^(scene mode|intimacy stage|fate event|companions|dice direction)/],
  ];
  const sums = new Map();
  for (const line of String(block ?? '').split('\n')) {
    const hit = groups.find(([, re]) => re.test(line));
    const label = hit ? hit[0] : 'прочее';
    sums.set(label, (sums.get(label) ?? 0) + line.length + 1);
  }
  return [...sums.entries()].map(([label, chars]) => ({ label, chars })).sort((a, b) => b.chars - a.chars);
}
