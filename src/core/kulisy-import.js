/**
 * Перенос состояния Кулис (chat_metadata['kulisy.v1']) в «Кадр». Чистая логика: на вход состояние Кулис
 * (то, что отдаёт Kulisy.getState(), или содержимое экспорта), на выход предложение: что и куда перенести.
 *
 * Переносится: дата и время, место (цепочка карточек), погода, накал как стартовое напряжение, кто в кадре
 * и квесты (questsFromKulisy: в записи журнала с игровыми датами).
 */
import { CALENDARS, locate } from './calendars.js';
import { KIND_IDS } from './weather.js';
import { clampLevel } from './tension.js';
import { shiftDate } from './clock.js';

const HARPTOS = 'harptos';
// В Кулисах праздничный день склеен с месяцем: 31 Хаммера это Середина зимы и т.д.; Щитовой сход идёт как 32 Флеймрула
const FESTIVAL_AFTER = { hammer: 'midwinter', tarsakh: 'greengrass', flamerule: 'midsummer', eleint: 'highharvestide', uktar: 'feastofthemoon' };

const norm = value => String(value ?? '').toLowerCase().replace(/ё/g, 'е').trim();

/** Номер дня и название месяца из подписи Кулис: «22 Элесиаса» → { day: 22, token: 'элесиаса' }. */
export function parseKulisyLabel(label) {
  const match = /^\s*(\d{1,2})\s+([\p{L}'’-]+)/u.exec(String(label ?? ''));
  return match ? { day: Number(match[1]), token: norm(match[2]) } : null;
}

/** Дата Харптоса (наш календарь) по подписи и году: { year, doy } или null. */
export function harptosDoyFromLabel(label, year) {
  const cal = CALENDARS[HARPTOS];
  const periods = cal.periods(year);
  const start = new Map();
  let at = 1;
  for (const p of periods) { start.set(p.id, at); at += p.days; }
  const text = norm(label);
  // праздник по названию, без числа: «Середина лета»
  for (const p of periods) if (p.type === 'festival' && text.includes(norm(p.ru))) return { year, doy: start.get(p.id) };
  const parsed = parseKulisyLabel(label);
  if (!parsed) return null;
  const month = periods.find(p => p.type === 'month' && parsed.token.startsWith(norm(p.ru)));
  if (!month) return null;
  if (parsed.day >= 1 && parsed.day <= month.days) return { year, doy: start.get(month.id) + parsed.day - 1 };
  const index = periods.indexOf(month);
  if (parsed.day === month.days + 1 && FESTIVAL_AFTER[month.id]) {
    const festival = periods[index + 1];
    if (festival?.id === FESTIVAL_AFTER[month.id]) return { year, doy: start.get(festival.id) };
  }
  if (parsed.day === month.days + 2 && month.id === 'flamerule') {
    const shieldmeet = periods.find(p => p.id === 'shieldmeet');
    if (shieldmeet) return { year, doy: start.get('shieldmeet') };
  }
  return null;
}

const parseMinutes = value => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : null;
};

/** Цепочка карточек места от внешней к текущей: «Побережье Мечей › Лагерь». */
export function placeChain(ku) {
  const raw = ku?.world?.locations;
  const cards = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const byId = new Map(cards.map(card => [card.id, card]));
  const names = [];
  let card = byId.get(ku?.knowledge?.scene?.locationId);
  for (let i = 0; card && i < 12; i++) { if (card.name) names.unshift(card.name); card = byId.get(card.parentId); }
  if (names.length) return names.join(' › ');
  return String(ku?.knowledge?.scene?.location ?? '').trim();
}

/** Накал Кулис 0..100 → ступень напряжения 0..4. */
export const heatToLevel = value => clampLevel(Math.floor((Number(value) || 0) / 20));

/**
 * Что можно перенести из состояния Кулис. Ничего не меняет.
 * @returns {{ ok, date, dateText, minutes, place, weather, tension, cast, quests, warnings }}
 */
export function convertKulisy(ku, calendarId = HARPTOS) {
  const warnings = [];
  if (!ku || typeof ku !== 'object' || !ku.world) return { ok: false, warnings: ['в этом чате нет данных Кулис'] };
  const clock = ku.world.clock ?? {};
  // номер дня истории у Кулис («Д3»): по нему выставляется наш счётчик дней
  const kuDay = Math.trunc(Number(clock.day));
  const out = { ok: true, date: null, dateText: '', minutes: null, dayNumber: Number.isFinite(kuDay) && kuDay >= 1 ? kuDay : null, place: '', weather: null, tension: null, cast: [], quests: [], warnings };

  const systemId = ku.ui?.calendar?.system?.id;
  const anchorYear = /^(\d{4})-/.exec(String(ku.ui?.calendar?.anchor ?? ''))?.[1];
  if (calendarId !== HARPTOS) warnings.push('дата не перенесена: календарь чата не Харптос');
  else if (systemId && systemId !== 'harptos-dr') warnings.push(`дата не перенесена: у Кулис в чате календарь «${ku.ui.calendar.system.name ?? systemId}», а не Харптос`);
  else if (clock.label) {
    const year = anchorYear ? Number(anchorYear) : CALENDARS[HARPTOS].defaultYear;
    const found = harptosDoyFromLabel(clock.label, year);
    if (found) {
      out.date = found;
      const loc = locate(CALENDARS[HARPTOS], found.year, found.doy);
      out.dateText = `${loc.period.type === 'festival' ? loc.period.ru : `${loc.period.ru}, ${loc.day}`}, ${year}`;
    } else warnings.push(`дата не перенесена: не понял подпись «${clock.label}»`);
  } else warnings.push('у Кулис не задана дата (нет подписи дня)');

  out.minutes = parseMinutes(clock.time);
  if (out.minutes === null) warnings.push('время суток у Кулис не задано');
  if (out.date && out.minutes !== null) out.date = { ...out.date, minutes: out.minutes };

  out.place = placeChain(ku);
  if (!out.place) warnings.push('место у Кулис не задано');

  const w = ku.world.weather;
  if (w && KIND_IDS.includes(w.kind)) {
    out.weather = { kind: w.kind, text: String(w.text ?? '').trim().slice(0, 60), tempC: Number.isFinite(Number(w.temp)) && w.temp !== null ? Math.round(Number(w.temp)) : null };
  }

  const heat = ku.world.heat;
  if (heat && Number.isFinite(Number(heat.value)) && Number(heat.value) > 0) out.tension = { level: heatToLevel(heat.value), heat: Number(heat.value), why: String(heat.why ?? '') };

  // кто в кадре у Кулис: имена и отметка «это персона» (ui.personaId)
  const entities = ku.entities ?? {};
  const personaId = ku.ui?.personaId ?? '';
  out.castFull = (ku.knowledge?.scene?.presentIds ?? []).filter(id => entities[id]?.name).map(id => ({ name: String(entities[id].name), persona: id === personaId }));
  out.cast = out.castFull.map(person => person.name);

  const rawQuests = ku.world.quests;
  const list = Array.isArray(rawQuests) ? rawQuests : rawQuests && typeof rawQuests === 'object' ? Object.values(rawQuests) : [];
  out.quests = list.map(q => ({
    name: String(q.name ?? q.title ?? ''), status: String(q.status ?? ''), text: String(q.text ?? ''),
    steps: (q.steps ?? []).map(s => ({ text: String(s.text ?? ''), done: Boolean(s.done) })),
  })).filter(q => q.name);
  return out;
}

const clipText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Квесты Кулис → квесты журнала (без id: их выдаёт сервис). Шаги становятся зацепками (сделан = отработана; у закрытого
 * квеста несделанный шаг = тупик), суть становится целью и первой записью, итог и награда записями на день закрытия.
 * День истории N у Кулис переводится в дату через dayOne (день 1).
 */
export function questsFromKulisy(ku, calendarId, dayOne) {
  const raw = ku?.world?.quests;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const entities = ku?.entities ?? {};
  const dateFor = day => {
    const n = Math.trunc(Number(day));
    return Number.isFinite(n) && n >= 1 && dayOne ? shiftDate(calendarId, dayOne, n - 1) : null;
  };
  const statusMap = { active: 'active', paused: 'paused', done: 'done', failed: 'failed' };
  return list.map(q => {
    const status = statusMap[q.status] ?? 'active';
    const closed = status === 'done' || status === 'failed';
    const entries = [];
    if (q.text) entries.push({ date: dateFor(q.startedDay), minutes: null, t: clipText(q.text, 400) });
    if (q.outcome) entries.push({ date: dateFor(q.closedDay ?? q.startedDay), minutes: null, t: `Итог: ${clipText(q.outcome, 360)}` });
    if (q.reward?.text) entries.push({ date: dateFor(q.closedDay ?? q.startedDay), minutes: null, t: `Награда: ${clipText(q.reward.text, 360)}` });
    return {
      title: clipText(q.name ?? q.title, 120), status, goal: clipText(q.text, 400), place: '',
      who: (q.participantIds ?? []).map(id => entities[id]?.name).filter(Boolean).slice(0, 8),
      leads: (q.steps ?? []).map(step => ({ t: clipText(step.text ?? step.t, 200), state: step.done ? 'done' : closed ? 'dead' : 'open', note: '' })).filter(l => l.t),
      entries,
    };
  }).filter(q => q.title);
}

/**
 * Отношения Кулис → отношения «Кадра». Люди сопоставляются с участниками сцены по имени или псевдониму
 * (так линии цепляются к тем же id, что в «Состоянии»); остальные попадают в реестр отношений под своим id Кулис.
 * Возвращает куски для слияния: { people, lines, shared, triangles, mapped, total }.
 */
export function relationsFromKulisy(ku, cast = []) {
  const entities = ku?.entities && typeof ku.entities === 'object' ? ku.entities : {};
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  const byName = new Map();
  for (const p of cast) byName.set(norm(p.name), p.id);
  const people = [];
  const map = {};
  let mapped = 0;
  for (const [eid, e] of Object.entries(entities)) {
    const names = [e?.name, ...(Array.isArray(e?.aliases) ? e.aliases : [])].map(norm).filter(Boolean);
    const hit = names.map(n => byName.get(n)).find(Boolean);
    if (hit) { map[eid] = hit; mapped += 1; continue; }
    map[eid] = eid;
    people.push({ id: eid, name: String(e?.name ?? eid), aliases: Array.isArray(e?.aliases) ? e.aliases : [] });
  }
  const rec = list => (Array.isArray(list) ? list : []).map(r => ({ id: r.id, text: r.text ?? r.label, intensity: r.intensity, pinned: r.pinned, disabled: r.disabled }));
  const lines = Object.values(ku?.relationships ?? {}).filter(l => map[l?.from] && map[l?.to]).map(l => ({
    id: l.id, from: map[l.from], to: map[l.to], scales: l.scales ?? {}, hidden: l.hiddenScales ?? [], stage: l.stage ?? '', goal: l.goal ?? '',
    memories: rec(l.memories), tensions: rec(l.tensions), factors: Array.isArray(l.factors) ? l.factors.map(f => ({ scaleId: f.scaleId, direction: f.direction, text: f.text })) : [],
  }));
  const shared = [];
  for (const [kind, list] of [['memory', ku?.records?.memories], ['tension', ku?.records?.tensions]]) {
    for (const r of Array.isArray(list) ? list : []) {
      const who = (r.participantIds ?? []).map(id => map[id]).filter(Boolean);
      if (r.relationshipId || who.length < 2) continue;
      shared.push({ id: r.id, kind, text: r.text, intensity: r.intensity, pinned: r.pinned, disabled: r.disabled, who, at: Date.parse(r.createdAt ?? '') || 0 });
    }
  }
  shared.sort((a, b) => a.at - b.at);
  shared.splice(0, Math.max(0, shared.length - 60));            // лимит хранения: остаются самые свежие
  shared.forEach(r => { delete r.at; });
  const triangles = (Array.isArray(ku?.ui?.triangles) ? ku.ui.triangles : []).filter(t => map[t?.centerId] && map[t?.firstId] && map[t?.secondId])
    .map(t => ({ id: t.id, name: t.name, centerId: map[t.centerId], firstId: map[t.firstId], secondId: map[t.secondId], goal: t.goal ?? '', resolved: t.resolved === true }));
  const used = new Set([...lines.flatMap(l => [l.from, l.to]), ...shared.flatMap(r => r.who), ...triangles.flatMap(t => [t.centerId, t.firstId, t.secondId])]);
  const headcanons = [];
  for (const [key, entry] of Object.entries(ku?.ui?.headcanons ?? {})) {
    const [a, b] = key.split('|').map(id => map[id]);
    if (!a || !b || a === b) continue;
    for (const item of Array.isArray(entry?.items) ? entry.items : []) headcanons.push({ id: item.id, pair: [a, b].sort().join('|'), text: item.text, enabled: item.enabled !== false });
  }
  const used2 = new Set([...used, ...headcanons.flatMap(h => h.pair.split('|'))]);
  return { people: people.filter(p => used2.has(p.id)), lines, shared, triangles, headcanons, mapped, total: Object.keys(entities).length };
}

/**
 * Знания Кулис → тайны «Кадра»: события (с текстом тайны), кто что узнал, знакомства, смерти.
 * Люди сопоставляются так же, как в отношениях: с участниками сцены по имени или псевдониму, остальные в реестр.
 * Возвращает куски для слияния: { people, events, learned, acquaintances, deaths, mapped }.
 */
export function knowledgeFromKulisy(ku, cast = []) {
  const entities = ku?.entities && typeof ku.entities === 'object' ? ku.entities : {};
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  const byName = new Map(cast.map(p => [norm(p.name), p.id]));
  const map = {};
  const registry = {};
  let mapped = 0;
  for (const [eid, e] of Object.entries(entities)) {
    const hit = [e?.name, ...(Array.isArray(e?.aliases) ? e.aliases : [])].map(norm).filter(Boolean).map(n => byName.get(n)).find(Boolean);
    if (hit) { map[eid] = hit; mapped += 1; } else { map[eid] = eid; registry[eid] = { id: eid, name: String(e?.name ?? eid), aliases: Array.isArray(e?.aliases) ? e.aliases : [] }; }
  }
  const k = ku?.knowledge ?? {};
  const ids = ids => (Array.isArray(ids) ? ids : []).map(id => map[id]).filter(Boolean);
  const events = (Array.isArray(k.events) ? k.events : []).map(e => ({
    id: e.id, text: e.text, witnessIds: ids(e.witnessIds), location: e.location, secret: e.secret, own: e.own, lore: e.lore, detail: e.detail, disabled: e.disabled,
  }));
  const learned = (Array.isArray(k.learned) ? k.learned : []).filter(l => map[l?.entityId]).map(l => ({ id: l.id, eventId: l.eventId, entityId: map[l.entityId], source: l.source, fromId: map[l.fromId], disabled: l.disabled }));
  const acquaintances = {};
  for (const [key, status] of Object.entries(k.acquaintances ?? {})) {
    const [a, b] = key.split('|').map(id => map[id]);
    if (a && b && a !== b) acquaintances[[a, b].sort().join('|')] = status;
  }
  for (const key of ku?.ui?.strangerPairs ?? []) {                         // старый ручной флаг «не знакомы»
    const [a, b] = String(key).split('|').map(id => map[id]);
    const joined = a && b && a !== b ? [a, b].sort().join('|') : '';
    if (joined && !acquaintances[joined]) acquaintances[joined] = 'strangers';
  }
  const deaths = {};
  for (const [id, d] of Object.entries(k.deaths ?? {})) if (map[id]) deaths[map[id]] = { note: d?.note ?? '' };
  const used = new Set([...events.flatMap(e => e.witnessIds), ...learned.flatMap(l => [l.entityId, l.fromId]), ...Object.keys(acquaintances).flatMap(key => key.split('|')), ...Object.keys(deaths)].filter(Boolean));
  return { people: Object.values(registry).filter(p => used.has(p.id)), events, learned, acquaintances, deaths, mapped };
}
