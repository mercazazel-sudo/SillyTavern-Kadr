/**
 * Сервис сцены: связывает чистую логику ядра с Таверной.
 * Хранит состояние в chat_metadata, слушает события чата, ставит блок для рассказчика.
 * Окна только читают get() и вызывают действия; сами в Таверну не лезут.
 */
import { report } from './guard.js';
import { STATE_KEY, normalizeState, defaultState, trimTimeline, hasStep, addEvent, lastIndex, switchWorld } from './core/state.js';
import { resolveTime, skipMinutes, validDate, shiftDate } from './core/clock.js';
import { buildSceneBlock, describeDate, enabledLayers } from './core/scene-text.js';
import { resolveWeather, generateWeather, dayKey, adjustTemp, KIND_IDS, CLIMATE_IDS } from './core/weather.js';
import { detectWeatherChange } from './core/weather-detect.js';
import { resolveTension, detectTension, clampLevel, detectCombat } from './core/tension.js';
import { buildLetterBlock, cleanLetter } from './core/letter.js';
import { convertKulisy, questsFromKulisy, relationsFromKulisy, knowledgeFromKulisy } from './core/kulisy-import.js';
import { knowledgeLines as buildKnowledgeLines, normalizeKnowledge, ACQUAINTANCE, pairKey, findLoreEvent, appendWatchLog } from './core/secrets.js';
import { relationLines as buildRelationLines, normalizeRelations, SCALE_IDS, allPeople, lineKey, ensurePersonaLines, nameOf as personName } from './core/relations.js';
import { questLines as buildQuestLines, STATUSES, STATUS_RU, NEXT_LEAD, LEAD_STATES, isOpenStatus } from './core/journal.js';
import { fateLines as buildFateLines, normalizeFate, detectAutoMode, parseCheck, rollCheck as rollCheckCore, checkDirective, CHECK_MODE_RU, OUTCOME_RU, CHECK_MODES, CHECK_KINDS, MODE_IDS, MODE_SETS, SET_IDS, modesOf, detectDailyMode, NUDGES, rollEvent, moveHeat, HEAT_NOTE_KINDS, heatPending, tagRu } from './core/fate.js';
import { inventoryLines as buildInventoryLines, normalizeInventory, applyItemOp, undoItemOp, itemsOf } from './core/inventory.js';
import { mergePeople } from './core/merge-people.js';
import { purgePerson } from './core/purge-person.js';
import { findAcrossScripts } from './core/names.js';
import { normalizeLibrary as normalizePlaceLib, allNodes, cardOf, placeLines as buildPlaceLines, pathOf, canMove, libraryFromKulisy, nestingFromKulisy, mergePlaceFile, mapFromKulisy, normalizeMap, findNode, descendantsOf, normalizeLinks, placeLoreLines, loreKey, LORE_WHEN } from './core/places.js';
import { storyText } from './core/story.js';
import { buildCastLines, emptyBody, clampTier, suggestTier, ZONE_IDS, MOOD_IDS, cleanMood, cleanArousal } from './core/body.js';
import { isGear, wear as gearWear, unwear as gearUnwear, findGear, gearLine, outfitSet, outfitSaveWorn, wearOutfit as gearWearOutfit } from './core/gear.js';
import { CALENDARS } from './core/calendars.js';

const PROMPT_KEY = 'sceneJournal-scene';
const LETTER_KEY = 'sceneJournal-letter';
const IN_CHAT = 1;      // extension_prompt_types.IN_CHAT
const ROLE_SYSTEM = 0;  // extension_prompt_roles.SYSTEM

export function startScene(deps) {
  const { settings, save } = deps;
  const listeners = new Set();
  const ctx = () => globalThis.SillyTavern.getContext();
  const chatLength = () => ctx().chat?.length ?? 0;
  // Без открытого чата chatMetadata у Таверны пустой объект, а не отсутствие: ориентируемся на chatId
  const chatOpen = c => Boolean(c.chatId && c.chatMetadata);
  const hasChat = () => chatOpen(ctx());

  function readState() {
    const c = ctx();
    if (!chatOpen(c)) return null;
    return normalizeState(c.chatMetadata[STATE_KEY], settings.calendar);
  }

  /** Всё, что нужно окнам: состояние, время, дата, включённые слои, блок для рассказчика. */
  function get() {
    const state = readState();
    if (!state) return { hasChat: false };
    const time = resolveTime(state, chatLength());
    const layers = enabledLayers(settings, state.calendar);
    const date = describeDate(state.calendar, time, layers, state.dayOne);
    const weather = resolveWeather(state, time, chatLength(), settings.weather);
    const tension = settings.tension ? resolveTension(state, chatLength(), { decayEvery: settings.tensionDecay }) : null;
    const today = { year: time.year, doy: time.doy };
    const castLines = settings.sendCast ? buildCastLines(state.cast, state.bodies, state.calendar, today, { sendBody: settings.sendBody }) : [];
    const questLines = settings.sendQuests ? buildQuestLines(state.quests) : [];
    const relationLines = settings.sendRelations ? buildRelationLines(state.relations, state.cast, { maxChars: settings.relationsBudget, dead: Object.keys(state.knowledge.deaths) }) : [];
    const knowledgeLines = settings.sendKnowledge ? buildKnowledgeLines(state.knowledge, state.cast, id => personName(id, state.cast, state.relations), { maxChars: settings.knowledgeBudget }) : [];
    const fateLines = settings.sendFate ? buildFateLines(state.fate, { diceCheck: settings.fate?.diceCheck !== false && !intimateNow(state), names: Object.fromEntries(state.cast.map(p => [p.id, p.name])) }) : [];
    const nameOfId = id => personName(id, state.cast, state.relations);
    const inventoryLines = settings.sendInventory !== false ? [
      ...state.cast.filter(p => p.present && !p.persona).map(p => gearLine(p.name, state.inventory, p.id)).filter(Boolean),    // что надето и в руках
      ...buildInventoryLines(state.inventory.filter(i => !isGear(i)), state.cast, nameOfId),                                      // рюкзак: без одежды и оружия
    ] : [];
    const placeLib = normalizePlaceLib(settings.places);
    const placeLinks = normalizeLinks(settings.placeLinks);
    // карточка текущего места плюс привязанные к местам записи лорбука, сработавшие по месту сцены (тексты читает служба placelore)
    const placeLines = settings.sendPlaces !== false ? [...buildPlaceLines(placeLib, state.map), ...placeLoreLines(placeLinks, allNodes(placeLib, state.map), state.map, (b, e) => deps.shared.placeLore?.textOf(b, e))] : [];
    const block = buildSceneBlock({ state, time, layers, sendHolidays: settings.sendHolidays, weather: settings.sendWeather ? weather : null, tension: settings.sendTension ? tension : null, castLines, questLines, relationLines, knowledgeLines, fateLines, inventoryLines, placeLines, shortRules: settings.shortRules !== false });
    return { hasChat: true, state, time, today, layers, date, weather, tension, letter: state.letter, cast: state.cast, bodies: state.bodies, quests: state.quests, questLines, relations: state.relations, relationLines, knowledge: state.knowledge, knowledgeLines, fate: state.fate, fateLines, inventory: state.inventory, outfits: state.outfits ?? {}, inventoryLines, personaMismatch: personaMismatch({ cast: state.cast, relations: state.relations }), map: state.map, placeLib, placeNodes: allNodes(placeLib, state.map), placeCard: state.map.current ? cardOf(placeLib, state.map, state.map.current) : null, placeLines, placeLinks, people: allPeople(state.cast, state.relations), tavernPersona: String(ctx().name1 ?? '').trim(), block, calendar: CALENDARS[state.calendar], initialized: Boolean(ctx().chatMetadata[STATE_KEY]) };
  }

  function persist(state) {
    const c = ctx();
    if (!chatOpen(c)) return;
    c.chatMetadata[STATE_KEY] = state;
    if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
    else c.saveMetadata?.();
  }

  function notify() {
    for (const fn of [...listeners]) { try { fn(get()); } catch (error) { report('подписчик', error); } }
  }

  function refreshPrompt() {
    try {
      const c = ctx();
      const info = get();
      const text = settings.enabled && settings.sendBlock && info.hasChat && info.initialized ? info.block : '';
      c.setExtensionPrompt(PROMPT_KEY, text, IN_CHAT, settings.depth, false, ROLE_SYSTEM);
      // секретное письмо: на глубине 0, сразу после последнего сообщения; уходит, пока не придёт ответ, потом убирается
      const letter = settings.enabled && info.hasChat ? buildLetterBlock(info.letter) : '';
      c.setExtensionPrompt(LETTER_KEY, letter, IN_CHAT, 0, false, ROLE_SYSTEM);
    } catch (error) { report('блок для рассказчика', error); }
  }

  /** Любое изменение: правим копию, сохраняем, обновляем блок и окна. */
  function mutate(fn) {
    const state = readState();
    if (!state) return false;
    fn(state);
    ensurePersonaLines(state, newId);       // у каждого героя есть линия чувств к персоне по умолчанию
    persist(state);
    refreshPrompt();
    notify();
    return true;
  }

  // ---------- действия ----------
  const skip = kindOrMinutes => {
    const info = get();
    if (!info.hasChat) return false;
    const minutes = typeof kindOrMinutes === 'number' ? kindOrMinutes : skipMinutes(kindOrMinutes, info.time);
    if (!minutes) return false;
    return mutate(state => addEvent(state, { type: 'skip', at: lastIndex(chatLength()), minutes: Math.round(minutes) }));
  };
  const setTime = ({ year, doy, minutes }) => {
    const info = get();
    if (!info.hasChat || !validDate(info.state.calendar, year, doy, minutes)) return false;
    return mutate(state => addEvent(state, { type: 'set', at: lastIndex(chatLength()), year, doy, minutes }));
  };
  const setPlace = text => mutate(state => { state.place = String(text ?? '').trim().slice(0, 400); });
  /** «Сегодня день №N»: пересчитывает, какой день считается первым днём истории. Даты и время не трогает. */
  const setDayNumber = n => {
    const info = get();
    const value = Math.trunc(Number(n));
    if (!info.hasChat || !Number.isFinite(value) || Math.abs(value) > 100000) return false;
    return mutate(state => { state.dayOne = shiftDate(state.calendar, { year: info.time.year, doy: info.time.doy }, -(value - 1)); });
  };
  const setCalendar = id => {
    if (!CALENDARS[id]) return false;
    // отношения, тайны, анкеты и прочее остаются за тем миром, где велись (core/state.js: switchWorld)
    return mutate(state => { const next = switchWorld(state, id); for (const k of Object.keys(state)) delete state[k]; Object.assign(state, next); });
  };
  /** Ручная погода на текущий день: kind из списка, температура числом или null, текст необязательный. */
  const setWeather = ({ kind, tempC = null, text = '' }) => {
    const info = get();
    if (!info.hasChat || !KIND_IDS.includes(kind)) return false;
    return mutate(state => addEvent(state, { type: 'weather', at: lastIndex(chatLength()), day: dayKey(info.time.year, info.time.doy), kind, tempC: tempC === null || tempC === '' ? null : Number(tempC), text: String(text ?? '').slice(0, 60) }));
  };
  /** «Бросить кубик заново»: новая случайная погода на сегодня по тому же климату (ручная правка, откатывается с сообщением). */
  const rerollWeather = () => {
    const info = get();
    if (!info.hasChat) return false;
    const salt = `${Date.now()}`;
    const fresh = generateWeather(info.state.calendar, info.time.year, info.time.doy, info.state.climate, salt);
    return setWeather({ kind: fresh.kind, tempC: fresh.tempC });
  };
  const setClimate = id => (CLIMATE_IDS.includes(id) ? mutate(state => { state.climate = id; }) : false);
  /** Напряжение вручную: ступень 0..4 (событие привязано к последнему сообщению, откатывается с ним). */
  const setTension = level => mutate(state => addEvent(state, { type: 'tension', at: lastIndex(chatLength()), level: clampLevel(level), source: 'manual' }));
  // ---------- кто в кадре и состояние тела ----------
  const newId = prefix => `${prefix}${Math.random().toString(36).slice(2, 8)}`;
  /** Имена, с которых начинается список: персона и персонажи открытого чата (в группе все участники). */
  function chatNames() {
    const c = ctx();
    const out = [];
    if (c.name1) out.push({ name: String(c.name1), persona: true });
    const group = c.groupId ? c.groups?.find(g => String(g.id) === String(c.groupId)) : null;
    if (group) for (const avatar of group.members ?? []) { const ch = c.characters?.find(x => x.avatar === avatar); if (ch?.name) out.push({ name: ch.name, persona: false }); }
    else if (c.characterId !== undefined && c.characters?.[c.characterId]?.name) out.push({ name: c.characters[c.characterId].name, persona: false });
    return out;
  }
  /**
   * Заполняет пустой список участников: сначала теми, кто в кадре у Кулис (если они есть и знают состав), иначе
   * персонажами чата. Персону не заводит: она привязывается к чату только вручную (кнопка «Привязать персону»).
   * Ничего не делает, если список уже есть.
   */
  const seedCast = () => {
    const info = get();
    if (!info.hasChat || info.cast.length) return false;
    const fromKulisy = globalThis.Kulisy?.getState ? (convertKulisy(kulisyState(), info.state.calendar).castFull ?? []) : [];
    const names = (fromKulisy.length ? fromKulisy : chatNames()).filter(n => !n.persona);
    if (!names.length) return false;
    return mutate(state => { state.cast = names.map(n => ({ id: newId('c'), name: n.name.slice(0, 60), persona: n.persona, present: true })); });
  };
  const withPerson = (id, fn) => mutate(state => {
    if (!state.cast.some(p => p.id === id)) return;
    state.bodies[id] ??= emptyBody();
    fn(state.bodies[id], state);
  });
  const addCast = name => {
    const text = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!text || get().cast.some(p => p.name.toLowerCase() === text.toLowerCase())) return false;
    return mutate(state => { state.cast.push({ id: newId('c'), name: text, persona: false, present: true }); });
  };
  const removeCast = id => mutate(state => { state.cast = state.cast.filter(p => p.id !== id); delete state.bodies[id]; delete state.outfits?.[id]; });
  /** Убирает человека из чата совсем: из состава, из реестра имён, его раны, чувства к нему и от него; его вещи становятся общими. */
  /** Два человека оказались одним (английское имя из анкеты и русское из текста): всё лишнего переходит к основному. */
  const mergePersons = (keepId, dropId) => {
    let result = { ok: false };
    mutate(state => { result = mergePeople(state, keepId, dropId); });
    return result;
  };
  /** Убирает человека из чата совсем: состав, тело, одежда, отношения (линии, общие моменты, треугольники, хедканоны), знания (свидетель, «узнал», знакомства, смерть), метки в квестах; вещи становятся общими. */
  const removePersonFromChat = id => mutate(state => { purgePerson(state, id); });
  const setPresent = (id, present) => mutate(state => { const person = state.cast.find(p => p.id === id); if (person) person.present = Boolean(present); });
  const setTier = (id, tier) => withPerson(id, body => { body.tier = clampTier(tier); });
  const addWound = (id, { zone, t, sev }) => {
    const text = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const level = Math.trunc(Number(sev));
    if (!text || !ZONE_IDS.includes(zone) || !(level >= 1 && level <= 3)) return false;
    const today = get().today;
    return withPerson(id, body => {
      body.wounds.push({ id: newId('w'), zone, t: text, sev: level, bnd: false, since: { year: today.year, doy: today.doy } });
      if (body.tier < level) body.tier = level;                      // рана поднимает общую ступень; снизить можно вручную
    });
  };
  const toggleBandage = (id, woundId) => withPerson(id, body => { const w = body.wounds.find(x => x.id === woundId); if (w) w.bnd = !w.bnd; });
  const removeWound = (id, woundId) => withPerson(id, body => {
    body.wounds = body.wounds.filter(w => w.id !== woundId);
    if (body.tier < 4) body.tier = Math.min(body.tier, suggestTier(body.wounds));
  });
  const addCondition = (id, { t, days }) => {
    const text = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) return false;
    const info = get();
    const n = Math.trunc(Number(days));
    return withPerson(id, (body, state) => {
      body.conds.push({ id: newId('k'), t: text, until: n > 0 ? shiftDate(state.calendar, info.today, n) : null });
    });
  };
  const removeCondition = (id, condId) => withPerson(id, body => { body.conds = body.conds.filter(c => c.id !== condId); });

  // ---------- журнал квестов ----------
  const clipText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const withQuest = (id, fn) => mutate(state => { const q = state.quests.find(x => x.id === id); if (q) fn(q, state); });
  /** Запись «сейчас»: игровая дата и время суток. */
  const stamp = () => { const info = get(); return { date: { year: info.time.year, doy: info.time.doy }, minutes: info.time.minutes }; };
  const makeQuest = (fields, now) => ({
    id: newId('q'), title: clipText(fields.title, 120), status: fields.status ?? 'active', tracked: false, unseen: false,
    place: clipText(fields.place, 120), goal: clipText(fields.goal, 400), who: (fields.who ?? []).map(w => clipText(w, 60)).filter(Boolean).slice(0, 8),
    leads: (fields.leads ?? []).map(l => ({ id: newId('l'), t: clipText(l.t, 400), state: l.state ?? 'open', note: clipText(l.note, 300) })).filter(l => l.t),
    entries: (fields.entries ?? []).map(e => ({ id: newId('e'), date: e.date ?? null, minutes: e.minutes ?? null, t: clipText(e.t, 400) })).filter(e => e.t),
  });
  /** Новый квест; возвращает его id или '' если не вышло. */
  const addQuest = ({ title, goal = '', place = '', who = [] }) => {
    const text = clipText(title, 120);
    if (!text || !get().hasChat) return '';
    const now = stamp();
    const quest = makeQuest({ title: text, goal, place, who, entries: goal ? [{ date: now.date, minutes: now.minutes, t: goal }] : [] });
    return mutate(state => { state.quests.push(quest); }) ? quest.id : '';
  };
  /** Статус квеста; смена записывается в ленту. Закрытый квест перестаёт отслеживаться. */
  const setQuestStatus = (id, status) => {
    if (!STATUSES.includes(status)) return false;
    const now = stamp();
    const text = { done: 'Квест выполнен.', failed: 'Квест провален.', dropped: 'Квест брошен.', paused: 'Квест отложен.', active: 'Квест снова в работе.' }[status];
    return withQuest(id, q => {
      if (q.status === status) return;
      q.status = status;
      if (!isOpenStatus(status)) q.tracked = false;
      q.entries.push({ id: newId('e'), date: now.date, minutes: now.minutes, t: text });
    });
  };
  const setQuestText = (id, { title, goal }) => withQuest(id, q => {
    if (title !== undefined && clipText(title, 120)) q.title = clipText(title, 120);
    if (goal !== undefined) q.goal = clipText(goal, 400);
  });
  /** Отслеживаемый квест виден в строке сцены; он один, и только идущий. */
  const toggleTrack = id => mutate(state => {
    const q = state.quests.find(x => x.id === id);
    if (!q || !isOpenStatus(q.status)) return;
    const was = q.tracked;
    state.quests.forEach(x => { x.tracked = false; });
    q.tracked = !was;
  });
  const removeQuest = id => mutate(state => { state.quests = state.quests.filter(q => q.id !== id); });
  const addLead = (id, text) => {
    const t = clipText(text, 400);
    return t ? withQuest(id, q => { q.leads.push({ id: newId('l'), t, state: 'open', note: '' }); }) : false;
  };
  /** Состояние зацепки: явное или следующее по кругу (открыта, в работе, отработана, тупик). */
  const setLeadState = (id, leadId, next) => withQuest(id, q => {
    const lead = q.leads.find(l => l.id === leadId);
    if (!lead) return;
    lead.state = LEAD_STATES.includes(next) ? next : NEXT_LEAD[lead.state];
  });
  const setLeadNote = (id, leadId, note) => withQuest(id, q => { const lead = q.leads.find(l => l.id === leadId); if (lead) lead.note = clipText(note, 300); });
  const removeLead = (id, leadId) => withQuest(id, q => { q.leads = q.leads.filter(l => l.id !== leadId); });
  const addEntry = (id, text) => {
    const t = clipText(text, 400);
    if (!t) return false;
    const now = stamp();
    return withQuest(id, q => { q.entries.push({ id: newId('e'), date: now.date, minutes: now.minutes, t }); });
  };
  const removeEntry = (id, entryId) => withQuest(id, q => { q.entries = q.entries.filter(e => e.id !== entryId); });
  const markQuestSeen = id => withQuest(id, q => { q.unseen = false; });

  /** Квесты Кулис, которых ещё нет в журнале (по названию). */
  const previewKulisyQuests = () => {
    const info = get();
    if (!info.hasChat || !globalThis.Kulisy?.getState) return null;
    const list = questsFromKulisy(kulisyState(), info.state.calendar, info.state.dayOne);
    const have = new Set(info.quests.map(q => q.title.toLowerCase()));
    const fresh = list.filter(q => !have.has(q.title.toLowerCase()));
    return { total: list.length, fresh };
  };
  const importQuestsFromKulisy = () => {
    const plan = previewKulisyQuests();
    if (!plan) return { ok: false, imported: 0, skipped: 0 };
    if (!plan.fresh.length) return { ok: true, imported: 0, skipped: plan.total };
    const quests = plan.fresh.map(q => makeQuest(q));
    mutate(state => { state.quests.push(...quests); });
    return { ok: true, imported: quests.length, skipped: plan.total - quests.length };
  };


  // ---------- отношения ----------
  const withLine = (id, fn) => mutate(state => { const l = state.relations.lines.find(x => x.id === id); if (l) fn(l, state); });
  const clampScale = v => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));
  /** Новая линия «from к to»; возвращает id (существующей, если такая уже есть) или ''. */
  const addLine = (from, to) => {
    const info = get();
    if (!info.hasChat || !from || !to || from === to) return '';
    const known = new Set(info.people.map(p => p.id));
    if (!known.has(from) || !known.has(to)) return '';
    if (info.cast.some(p => p.persona && p.id === from)) return '';       // чувствами персоны управляет игрок: исходящих линий у неё нет
    const have = info.relations.lines.find(l => lineKey(l.from, l.to) === lineKey(from, to));
    if (have) return have.id;
    const id = newId('r');
    mutate(state => { state.relations.lines.push({ id, from, to, scales: {}, hidden: [], stage: '', goal: '', memories: [], tensions: [], factors: [] }); });
    return id;
  };
  const removeLine = id => mutate(state => { state.relations.lines = state.relations.lines.filter(l => l.id !== id); });
  const setScale = (id, scaleId, value) => {
    if (!SCALE_IDS.includes(scaleId)) return false;
    return withLine(id, l => { const v = clampScale(value); if (v === 0) delete l.scales[scaleId]; else l.scales[scaleId] = v; });
  };
  const toggleScaleHidden = (id, scaleId) => withLine(id, l => { l.hidden = l.hidden.includes(scaleId) ? l.hidden.filter(s => s !== scaleId) : [...l.hidden, scaleId]; });
  const setStage = (id, text) => withLine(id, l => { l.stage = clipText(text, 40); });
  const setGoal = (id, text) => withLine(id, l => { l.goal = String(text ?? '').trim().slice(0, 600); });
  const addRecord = (id, kind, text, intensity = 3) => {
    const t = clipText(text, 400);
    if (!t || !['memories', 'tensions'].includes(kind)) return false;
    return withLine(id, l => { if (l[kind].length < 30) l[kind].push({ id: newId('m'), text: t, intensity: Math.min(Math.max(Math.round(Number(intensity) || 3), 1), 5), pinned: false, disabled: false }); });
  };
  const removeRecord = (id, kind, recId) => withLine(id, l => { if (l[kind]) l[kind] = l[kind].filter(r => r.id !== recId); });
  const toggleRecord = (id, kind, recId, field) => withLine(id, l => { const r = l[kind]?.find(x => x.id === recId); if (r && (field === 'pinned' || field === 'disabled')) r[field] = !r[field]; });
  const addFactor = (id, scaleId, direction, text) => {
    const t = String(text ?? '').trim().slice(0, 700);
    if (!t || !SCALE_IDS.includes(scaleId)) return false;
    return withLine(id, l => { if (l.factors.length < 20) l.factors.push({ scaleId, direction: direction === 'down' ? 'down' : 'up', text: t }); });
  };
  const removeFactor = (id, index) => withLine(id, l => { l.factors.splice(Number(index), 1); });
  /** Человек вне сцены (для линий к тем, кого нет в списке участников). */
  const addPerson = name => {
    const text = clipText(name, 80);
    const info = get();
    if (!text || !info.hasChat || info.people.some(p => p.name.toLowerCase() === text.toLowerCase())) return '';
    const id = newId('p');
    mutate(state => { state.relations.people.push({ id, name: text, aliases: [] }); });
    return id;
  };
  const addTriangle = (centerId, firstId, secondId, goal = '') => {
    if (new Set([centerId, firstId, secondId]).size !== 3) return false;
    return mutate(state => { state.relations.triangles.push({ id: newId('t'), name: 'Треугольник', centerId, firstId, secondId, goal: String(goal).slice(0, 600), resolved: false }); });
  };
  const toggleTriangle = id => mutate(state => { const t = state.relations.triangles.find(x => x.id === id); if (t) t.resolved = !t.resolved; });
  const removeTriangle = id => mutate(state => { state.relations.triangles = state.relations.triangles.filter(t => t.id !== id); });


  const addHeadcanon = (a, b, text) => {
    const t = clipText(text, 300);
    if (!t || !a || !b || a === b || !knownPerson(a) || !knownPerson(b)) return false;
    return mutate(state => { state.relations.headcanons.push({ id: newId('h'), pair: pairKey(a, b), text: t, enabled: true }); state.relations = normalizeRelations(state.relations); });
  };
  const toggleHeadcanon = id => mutate(state => { const h = state.relations.headcanons.find(x => x.id === id); if (h) h.enabled = !h.enabled; });
  const removeHeadcanon = id => mutate(state => { state.relations.headcanons = state.relations.headcanons.filter(h => h.id !== id); });

  const previewKulisyRelations = () => {
    const info = get();
    if (!info.hasChat || !globalThis.Kulisy?.getState) return null;
    const plan = relationsFromKulisy(kulisyState(), info.state.cast);
    const have = new Set(info.relations.lines.map(l => lineKey(l.from, l.to)));
    const haveH = new Set(info.relations.headcanons.map(h => h.id));
    return { ...plan, freshLines: plan.lines.filter(l => !have.has(lineKey(l.from, l.to))).length, freshHeadcanons: plan.headcanons.filter(h => !haveH.has(h.id)).length };
  };
  /** Сливает отношения Кулис: уже существующие пары не трогает. */
  const importRelationsFromKulisy = () => {
    const plan = previewKulisyRelations();
    if (!plan) return { ok: false, lines: 0, skipped: 0 };
    let added = 0;
    mutate(state => {
      const r = state.relations;
      const haveP = new Set([...state.cast.map(p => p.id), ...r.people.map(p => p.id)]);
      for (const p of plan.people) if (!haveP.has(p.id)) r.people.push(p);
      const pairs = new Set(r.lines.map(l => lineKey(l.from, l.to)));
      for (const l of plan.lines) if (!pairs.has(lineKey(l.from, l.to))) { r.lines.push(l); added += 1; }
      const sharedIds = new Set(r.shared.map(s => s.id));
      for (const s of plan.shared) if (!sharedIds.has(s.id)) r.shared.push(s);
      const triIds = new Set(r.triangles.map(x => x.id));
      for (const x of plan.triangles) if (!triIds.has(x.id)) r.triangles.push(x);
      const hIds = new Set(r.headcanons.map(h => h.id));
      for (const h of plan.headcanons) if (!hIds.has(h.id)) r.headcanons.push(h);
      state.relations = normalizeRelations(r);
    });
    return { ok: true, lines: added, skipped: plan.lines.length - added, headcanons: plan.freshHeadcanons, mapped: plan.mapped };
  };


  // ---------- тайны ----------
  const withEvent = (id, fn) => mutate(state => { const e = state.knowledge.events.find(x => x.id === id); if (e) fn(e, state.knowledge, state); });
  const knownPerson = id => get().people.some(p => p.id === id);
  /** Новое событие знания; detail (полный текст) делает его тайной с текстом, которая уходит только знающим. Возвращает id. */
  const addFact = ({ text, witnessIds = [], secret = false, detail = '', location = '' }) => {
    const t = clipText(text, 500);
    if (!t || !get().hasChat) return '';
    const id = newId('v');
    mutate(state => {
      if (state.knowledge.events.length >= 600) return;
      const det = String(detail ?? '').trim();
      const item = { id, text: t, witnessIds: witnessIds.filter(knownPerson) };
      if (secret || det) item.secret = true;
      if (det) { item.own = true; item.detail = det; }
      if (location) item.location = location;
      state.knowledge.events.push(item);
      state.knowledge = normalizeKnowledge(state.knowledge);
    });
    return id;
  };
  const updateFact = (id, changes) => withEvent(id, (e, k) => {
    if (changes.text != null) { const t = clipText(changes.text, 500); if (t) e.text = t; }
    if (changes.location != null) { const l = clipText(changes.location, 120); if (l) e.location = l; else delete e.location; }
    if (changes.secret != null) { if (changes.secret) e.secret = true; else if (!e.own && !e.lore) delete e.secret; }
    if (changes.detail != null && !e.lore) {
      const det = String(changes.detail).trim().slice(0, e.watch ? 40000 : 1500);
      if (det) { e.own = true; e.secret = true; e.detail = det; } else if (e.watch) e.detail = ''; else { delete e.own; delete e.detail; }   // журнал наблюдений остаётся записью, даже когда пуст
    }
    if (changes.send != null && e.watch) { if (changes.send) e.send = true; else delete e.send; }      // журнал Ока: отправлять рассказчику (вручную)
    if (changes.disabled != null) { if (changes.disabled) e.disabled = true; else delete e.disabled; }
  });
  const removeFact = id => mutate(state => { const k = state.knowledge; k.events = k.events.filter(e => e.id !== id); k.learned = k.learned.filter(l => l.eventId !== id); });
  /** Свидетель: видел сам. Если до этого он только слышал, запись об этом убирается. */
  const toggleWitness = (eventId, personId) => withEvent(eventId, (e, k) => {
    if (!knownPerson(personId)) return;
    if (e.witnessIds.includes(personId)) e.witnessIds = e.witnessIds.filter(x => x !== personId);
    else { e.witnessIds.push(personId); k.learned = k.learned.filter(l => !(l.eventId === eventId && l.entityId === personId)); }
  });
  /** Узнал позже: source 'told' или 'rumor'; null убирает. */
  const setLearned = (eventId, personId, source, fromId = '') => withEvent(eventId, (e, k) => {
    if (!knownPerson(personId)) return;
    k.learned = k.learned.filter(l => !(l.eventId === eventId && l.entityId === personId));
    if (source !== 'told' && source !== 'rumor') return;
    e.witnessIds = e.witnessIds.filter(x => x !== personId);
    k.learned.push({ id: newId('n'), eventId, entityId: personId, source, ...(fromId && knownPerson(fromId) ? { fromId } : {}) });
  });
  const setAcquaintance = (a, b, status) => mutate(state => {
    if (!a || !b || a === b) return;
    const key = pairKey(a, b);
    if (ACQUAINTANCE.includes(status)) state.knowledge.acquaintances[key] = status; else delete state.knowledge.acquaintances[key];
  });
  const setDeath = (id, note = '') => { if (!knownPerson(id)) return false; return mutate(state => { state.knowledge.deaths[id] = { note: clipText(note, 300) }; const who = state.cast.find(p => p.id === id); if (who) who.present = false; }); };
  const clearDeath = id => mutate(state => { delete state.knowledge.deaths[id]; });

  const previewKulisyKnowledge = () => {
    const info = get();
    if (!info.hasChat || !globalThis.Kulisy?.getState) return null;
    const plan = knowledgeFromKulisy(kulisyState(), info.state.cast);
    const have = new Set(info.knowledge.events.map(e => e.id));
    return { ...plan, freshEvents: plan.events.filter(e => !have.has(e.id)).length };
  };
  /** Сливает знания Кулис: события, которые уже есть (по id), не трогает. */
  const importKnowledgeFromKulisy = () => {
    const plan = previewKulisyKnowledge();
    if (!plan) return { ok: false, events: 0 };
    let added = 0;
    mutate(state => {
      const haveP = new Set([...state.cast.map(p => p.id), ...state.relations.people.map(p => p.id)]);
      for (const p of plan.people) if (!haveP.has(p.id)) state.relations.people.push(p);
      state.relations = normalizeRelations(state.relations);
      const k = state.knowledge;
      const ids = new Set(k.events.map(e => e.id));
      for (const e of plan.events) if (!ids.has(e.id)) { k.events.push(e); added += 1; }
      const lids = new Set(k.learned.map(l => l.id));
      for (const l of plan.learned) if (!lids.has(l.id)) k.learned.push(l);
      for (const [key, v] of Object.entries(plan.acquaintances)) if (!k.acquaintances[key]) k.acquaintances[key] = v;
      for (const [id, d] of Object.entries(plan.deaths)) if (!k.deaths[id]) k.deaths[id] = d;
      state.knowledge = normalizeKnowledge(k);
    });
    return { ok: true, events: added, skipped: plan.events.length - added, deaths: Object.keys(plan.deaths).length, mapped: plan.mapped };
  };


  // ---------- кости судьбы ----------
  const withFate = fn => mutate(state => fn(state.fate, state));
  const aliveNpcs = info => info.cast.filter(p => p.present && !p.persona && !info.knowledge.deaths[p.id]).map(p => ({ id: p.id, name: p.name }));
  const setMode = id => withFate(f => { f.mode = modesOf(f.set).some(m => m.id === id) ? id : ''; f.auto = false; f.back = null; });
  /** Набор режимов: приключение или обычная жизнь. Режим, которого нет в новом наборе, снимается (Интим и накал остаются). */
  const setModeSet = id => withFate(f => {
    if (!SET_IDS.includes(id) || f.set === id) return;
    f.set = id;
    if (f.mode && !modesOf(id).some(m => m.id === f.mode)) { f.mode = ''; f.auto = false; f.back = null; }
    if (f.back && !modesOf(id).some(m => m.id === f.back.mode)) f.back = null;
  });
  /** Кнопка Привал / Лагерь / В путь: одноразовая подсказка «компаньоны сами предлагают»; Лагерь и В путь ещё и ставят режим. */
  const pressNudge = kind => {
    const n = NUDGES[kind];
    if (!n || !MODE_SETS[get().fate.set].nudges.includes(kind)) return false;
    return withFate(f => { f.event = { kind: 'nudge', label: n.ru, text: n.text, sent: false }; if (n.mode) f.mode = n.mode; });
  };
  const rollFate = () => {
    const info = get();
    if (!info.hasChat) return null;
    const present = info.cast.filter(p => p.present && !info.knowledge.deaths[p.id]).map(p => ({ id: p.id, name: p.name, persona: p.persona }));
    const hit = rollEvent({ modeId: info.fate.set === 'daily' && info.fate.mode === 'fight' ? 'brawl' : info.fate.mode, tension: info.tension?.level ?? 0, present, includePersona: settings.fate.includePersona, lethal: settings.fate.lethal, zones: ZONE_IDS });
    if (!hit) return null;
    withFate(f => { f.event = { kind: 'roll', label: `${tagRu(hit.tag)}: ${hit.ru}`, text: hit.en, sent: false, ...(hit.target ? { target: hit.target } : {}), ...(hit.harm ? { harm: hit.harm } : {}) }; });
    return hit;
  };
  const clearEvent = () => withFate(f => { f.event = null; });
  /** «Записать рану?»: вносит предложенную рану тому, кого задело. */
  const applyHarm = () => {
    const e = get().fate.event;
    if (!e?.harm || !e.target || e.harm.done) return false;
    const ok = addWound(e.target.id, { zone: ZONE_IDS.includes(e.harm.zone) ? e.harm.zone : 'chest', t: e.harm.t, sev: e.harm.sev });
    if (ok) withFate(f => { if (f.event?.harm) f.event.harm.done = true; });
    return ok;
  };
  /** Близость главнее лагеря, города и приключения: она переключает режим на себя и запоминает прежний; бой остаётся боем. */
  const takeIntimacy = f => {
    if (f.mode === 'fight' || f.mode === 'intimacy') return;
    if (f.mode) f.back = { mode: f.mode, auto: f.auto };
    f.mode = 'intimacy'; f.auto = false;
  };
  /** Накал близости: поставить зону, сдвинуть ({ delta }), сменить ведущего или подсказку на ход, снять ({ clear }). Первый шаг включает режим «Интим». */
  const setHeat = payload => withFate(f => {
    f.heat = moveHeat(f.heat, payload);
    if (f.heat) takeIntimacy(f);
    else if (f.mode === 'intimacy') { f.mode = f.back ? f.back.mode : ''; f.auto = f.back ? f.back.auto : false; f.back = null; }   // накал снят: возвращается прежний режим
  });
  const endIntimacy = () => setHeat({ clear: true });
  /** Своя запись к сцене: kind 'scene' (вся сцена), 'once' (один ход) или 'limit' (граница, уходит всегда). */
  const addHeatNote = (text, kind = 'scene') => withFate(f => {
    const clean = clipText(text, 200);
    if (!clean) return;
    if (!f.heat) { f.heat = moveHeat(null, { zone: 'warm' }); takeIntimacy(f); }            // запись без накала начинает его с зоны «Тепло»
    f.heat.notes = [...f.heat.notes, { id: newId('n'), text: clean, kind: HEAT_NOTE_KINDS.includes(kind) ? kind : 'scene', on: true, sent: false }].slice(-14);
  });
  const toggleHeatNote = id => withFate(f => { const n = f.heat?.notes.find(x => x.id === id); if (n) { n.on = !n.on; if (n.on) n.sent = false; } });
  const removeHeatNote = id => withFate(f => { if (f.heat) f.heat.notes = f.heat.notes.filter(x => x.id !== id); });


  // ---------- автоматические изменения (Архивариус): с журналом, чтобы их можно было отменить и откатить вместе с ответом ----------
  const logId = () => newId('g');
  /** Применяет сдвиг шкалы от Архивариуса. Возвращает id записи журнала или ''. at: индекс ответа, из-за которого это произошло. */
  const applyRelChange = ({ fromId, toId, scale, delta, memory = '', label = '', at }) => {
    if (!SCALE_IDS.includes(scale) || !fromId || !toId || fromId === toId || !get().hasChat) return '';
    let made = '';
    mutate(state => {
      const r = state.relations;
      let line = r.lines.find(l => l.from === fromId && l.to === toId);
      let created = false;
      if (!line) { line = { id: newId('r'), from: fromId, to: toId, scales: {}, hidden: [], stage: '', goal: '', memories: [], tensions: [], factors: [] }; r.lines.push(line); created = true; }
      const cur = line.scales[scale] ?? 0;
      const next = Math.max(-100, Math.min(100, cur + Math.round(Number(delta) || 0)));
      const actual = next - cur;
      const text = clipText(memory, 300);
      if (actual === 0 && !text) { if (created) r.lines.pop(); return; }
      if (next === 0) delete line.scales[scale]; else line.scales[scale] = next;
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'rel', label: clipText(label, 300), fromId, toId, scale, delta: actual };
      if (text && line.memories.length < 30) { const mid = newId('m'); line.memories.push({ id: mid, text, intensity: 3, pinned: false, disabled: false }); entry.memoryId = mid; }
      if (created) entry.lineCreated = true;
      r.log.push(entry);
      made = entry.id;
      state.relations = normalizeRelations(r);
    });
    return made;
  };
  /** Кто-то пришёл в сцену или ушёл. Человек из реестра отношений при приходе становится участником с тем же id (линии не теряются). */
  const applyCastChange = ({ personId, present, at, label = '' }) => {
    if (!get().hasChat) return '';
    let made = '';
    mutate(state => {
      let person = state.cast.find(p => p.id === personId);
      let added = false;
      if (!person) {
        const reg = state.relations.people.find(p => p.id === personId);
        if (!reg || !present) return;
        person = { id: reg.id, name: reg.name, persona: false, present: false };
        state.cast.push(person); added = true;
      }
      if (person.persona || person.present === Boolean(present)) { if (added) state.cast.pop(); return; }
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'cast', label: clipText(label, 300), personId, wasPresent: person.present, joined: Boolean(present) };
      if (added) entry.addedToCast = true;
      person.present = Boolean(present);
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };

  /**
   * Подтягивает в «Отношения» всех основных героев из анкет этого чата: каждый основной, кого ещё нет среди людей (ни по имени,
   * ни по псевдониму, ни по другому алфавиту), заносится в реестр людей. В сцену и в журнал изменений они не попадают:
   * это просто список, между которыми можно вести линии. Повторный вызов ничего не меняет. Возвращает число добавленных.
   */
  const syncMainPeople = () => {
    const cardsInfo = deps.shared.cards?.get?.();
    const info = get();
    if (!cardsInfo?.hasChat || !info.hasChat) return 0;
    const attached = new Set(cardsInfo.attached ?? []);
    const wanted = (cardsInfo.cards ?? []).filter(c => c.tier === 'main' && attached.has(c.id) && !c.idle && String(c.name ?? '').trim());
    if (!wanted.length) return 0;
    const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    const registry = () => get().people.map(p => ({ ...p, aliases: get().relations.people.find(x => x.id === p.id)?.aliases ?? [] }));
    const fresh = [];
    for (const c of wanted) {
      const names = [c.name, ...(c.aliases ?? [])].filter(Boolean);
      const people = [...registry(), ...fresh.map(f => ({ name: f.name, aliases: f.aliases }))];
      const known = names.some(n => people.some(p => [p.name, ...(p.aliases ?? [])].some(a => norm(a) === norm(n))) || findAcrossScripts(people, n));
      if (!known) fresh.push({ name: clipText(c.name, 80), aliases: (c.aliases ?? []).map(a => clipText(a, 60)).filter(a => a && norm(a) !== norm(c.name)).slice(0, 6) });
    }
    if (!fresh.length) return 0;
    mutate(state => { for (const f of fresh) state.relations.people.push({ id: newId('p'), name: f.name, aliases: f.aliases }); });
    return fresh.length;
  };
  /** Новый герой, которого не было в списке: создаётся в реестре людей и, если он в кадре, становится участником. */
  const applyNewPerson = ({ name, aliases = [], present = true, at, label = '' }) => {
    const text = clipText(name, 60);
    if (!text || !get().hasChat) return '';
    const info = get();
    const dup = info.people.find(p => p.name.toLowerCase() === text.toLowerCase());
    if (dup) return '';
    // то же имя на другом алфавите («Арвенн» при «Arvenn Velúrin»): двойника не заводим, имя запоминается как «другое имя»
    const same = findAcrossScripts(info.people.map(p => ({ ...p, aliases: info.relations.people.find(x => x.id === p.id)?.aliases ?? [] })), text);
    if (same) { setAliases(same.id, [...(info.relations.people.find(x => x.id === same.id)?.aliases ?? []), text].join(', ')); return ''; }
    let made = '';
    mutate(state => {
      const id = newId('p');
      state.relations.people.push({ id, name: text, aliases: aliases.map(a => clipText(a, 60)).filter(Boolean).slice(0, 6) });
      state.cast.push({ id, name: text, persona: false, present: Boolean(present) });
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'cast', label: clipText(label || `Новый герой: ${text}`, 300), personId: id, wasPresent: false, joined: true, addedToCast: true, createdPerson: true };
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };
  /** Слова, которые Архивариус проверил и не признал героями: после двух раз их больше не проверяют. */
  const bumpSeen = words => mutate(state => { for (const w of words) state.relations.seen[w] = Math.min((state.relations.seen[w] ?? 0) + 1, 9); state.relations = normalizeRelations(state.relations); });

  const undoEntry = (state, entry) => {
    const r = state.relations;
    if (entry.kind === 'rel') {
      const line = r.lines.find(l => l.from === entry.fromId && l.to === entry.toId);
      if (line) {
        const next = Math.max(-100, Math.min(100, (line.scales[entry.scale] ?? 0) - entry.delta));
        if (next === 0) delete line.scales[entry.scale]; else line.scales[entry.scale] = next;
        if (entry.memoryId) line.memories = line.memories.filter(m => m.id !== entry.memoryId);
        const empty = !Object.keys(line.scales).length && !line.memories.length && !line.tensions.length && !line.factors.length && !line.stage && !line.goal;
        if (entry.lineCreated && empty) r.lines = r.lines.filter(l => l.id !== line.id);
      }
    } else if (entry.kind === 'moment') {
      r.shared = r.shared.filter(x => x.id !== entry.sharedId);
      if (entry.removed) r.shared.unshift(entry.removed);
    } else if (entry.kind === 'quest') {
      const q = state.quests.find(x => x.id === entry.questId);
      if (q) {
        if (entry.entryId) q.entries = q.entries.filter(e => e.id !== entry.entryId);
        if (entry.leadId) { const lead = q.leads.find(l => l.id === entry.leadId); if (lead) { if (entry.prevState) lead.state = entry.prevState; lead.note = entry.prevNote ?? ''; } }
      }
    } else if (entry.kind === 'know') {
      const k = state.knowledge;
      const gone = new Set(entry.events ?? []);
      if (entry.watch) {
        if (entry.watch.created) gone.add(entry.watch.eventId);
        else {
          const log = k.events.find(e => e.id === entry.watch.eventId);
          if (log && entry.watch.added !== undefined) {           // убираем только дописанную этим ответом строку, остальной журнал не трогаем
            const rows = String(log.detail ?? '').split('\n');
            const at = entry.watch.added ? rows.lastIndexOf(entry.watch.added) : -1;
            if (at >= 0) rows.splice(at, 1);
            log.detail = rows.join('\n');
          } else if (log) log.detail = entry.watch.prev ?? '';    // старые записи отката хранили прежний текст целиком
        }
      }
      k.events = k.events.filter(e => !gone.has(e.id));
      k.learned = k.learned.filter(l => !(entry.learned ?? []).includes(l.id) && !gone.has(l.eventId));
      for (const id of entry.deaths ?? []) delete k.deaths[id];
      for (const [key, prev] of Object.entries(entry.meet ?? {})) { if (prev) k.acquaintances[key] = prev; else delete k.acquaintances[key]; }
      state.knowledge = normalizeKnowledge(k);
    } else if (entry.kind === 'place') {
      const b = entry.before ?? {};
      state.map.nodes = state.map.nodes.filter(n => !(entry.addedNodeIds ?? []).includes(n.id));
      for (const [id, o] of Object.entries(b.over ?? {})) { if (o) state.map.over[id] = o; else delete state.map.over[id]; }
      state.map.current = b.current ?? '';
      if (b.place !== undefined) state.place = b.place;
      state.map = normalizeMap(state.map);
    } else if (entry.kind === 'body') {
      const body = state.bodies[entry.personId];
      if (body) {
        body.conds = body.conds.filter(c => !entry.add.conds.includes(c.id));
        body.wounds = body.wounds.filter(w => !entry.add.wounds.includes(w.id));
        for (const c of entry.removed) if (!body.conds.some(x => x.id === c.id)) body.conds.push({ id: c.id, t: c.t, until: c.until });
        if (entry.prevTier !== undefined && entry.add.wounds.length) body.tier = entry.prevTier;
        if (entry.moodSet) body.mood = cleanMood(entry.prevMood);
        if (entry.arousalSet) body.arousal = cleanArousal(entry.prevArousal);
      }
    } else if (entry.kind === 'item') {
      state.inventory = normalizeInventory(undoItemOp(state.inventory, entry));
    } else {
      const person = state.cast.find(p => p.id === entry.personId);
      if (person) { if (entry.addedToCast) { state.cast = state.cast.filter(p => p.id !== entry.personId); delete state.bodies[entry.personId]; } else person.present = entry.wasPresent; }
      if (entry.createdPerson) {
        // созданного Архивариусом человека убираем и из реестра, если на него больше ничего не завязано (линии, знания, хедканоны)
        const id = entry.personId;
        const used = r.lines.some(l => l.from === id || l.to === id) || r.headcanons.some(h => h.pair.split('|').includes(id)) || state.knowledge.events.some(e => e.witnessIds.includes(id)) || state.knowledge.learned.some(l => l.entityId === id);
        if (!used) r.people = r.people.filter(p => p.id !== id);
      }
    }
  };
  /** Отменяет записи журнала по условию (в обратном порядке) и убирает их из журнала. */
  const revertWhere = test => {
    const has = get().relations.log.some(test);
    if (!has) return 0;
    let n = 0;
    mutate(state => {
      for (const entry of [...state.relations.log].reverse()) if (test(entry)) { undoEntry(state, entry); n += 1; }
      state.relations.log = state.relations.log.filter(e => !test(e));
      state.relations = normalizeRelations(state.relations);
    });
    return n;
  };
  const revertLog = id => revertWhere(e => e.id === id);
  /** Свайп или правка ответа: изменения, сделанные из-за него, снимаются. */
  const revertAt = (index, kind = '') => revertWhere(e => e.at === index && (!kind || e.kind === kind));
  /** Удалили ответы: снимается всё, что сделано из-за сообщений с номером от length и дальше. */
  const revertFrom = length => revertWhere(e => e.at >= length);


  // ---------- набор анкет чата ----------
  const attachCards = ids => {
    const have = new Set(get().state?.cards.ids ?? []);
    const fresh = [...new Set(ids)].filter(id => id && !have.has(id));
    if (!fresh.length) return 0;
    mutate(state => { state.cards.ids = [...state.cards.ids, ...fresh].slice(0, 80); });
    return fresh.length;
  };
  const attachCard = id => attachCards([id]) > 0;
  const detachCard = id => mutate(state => { state.cards.ids = state.cards.ids.filter(x => x !== id); });
  /** Кто вышел на сцену (add: запомнить номер сообщения) и кто ушёл (remove): от этого зависит правило «при выходе на сцену». */
  const updateEntered = ({ add = [], remove = [], at = 0 }) => mutate(state => {
    for (const id of add) state.cards.entered[id] = at;
    for (const id of remove) delete state.cards.entered[id];
  });


  // ---------- вещи ----------
  const addItem = ({ name, qty = 1, note = '', ownerId = '' }) => {
    const text = clipText(name, 80);
    if (!text || !get().hasChat) return '';
    const id = newId('i');
    mutate(state => {
      const r = applyItemOp(state.inventory, { op: 'gain', name: text, qty, note, ownerId }, () => id);
      if (r.ok) state.inventory = normalizeInventory(r.items);
    });
    return id;
  };
  const updateItem = (id, patch) => mutate(state => {
    const i = state.inventory.find(x => x.id === id);
    if (!i) return;
    if (patch.name != null) { const n = clipText(patch.name, 80); if (n) i.name = n; }
    if (patch.qty != null) i.qty = Math.min(Math.max(Math.trunc(Number(patch.qty)) || 1, 1), 9999);
    if (patch.note != null) i.note = clipText(patch.note, 160);
  });
  const removeItem = id => mutate(state => { state.inventory = state.inventory.filter(i => i.id !== id); });
  // ---------- гардероб, экипировка, настроение ----------
  /** Новая вещь гардероба (одежда или оружие) у человека; trophy: откуда добыта. */
  const addGear = ({ ownerId, name, kind = 'gear', slot = 'body', range = 'melee', hands = 1, wtype = '', ctype = '', look = 0, cond = '', loot = '', note = '' }) => {
    const text = clipText(name, 80);
    if (!text || !get().hasChat) return '';
    const id = newId('i');
    mutate(state => { state.inventory = normalizeInventory([...state.inventory, { id, name: text, qty: 1, note, ownerId: ownerId ?? '', kind, slot, range, hands, wtype, ctype, look, cond, loot }]); });
    return id;
  };
  /** Правка свойств вещи гардероба: слот, вид оружия, руки, состояние. */
  const updateGear = (id, patch) => mutate(state => {
    const i = state.inventory.find(x => x.id === id);
    if (!i || !isGear(i)) return;
    if (patch.name != null) { const n = clipText(patch.name, 80); if (n) i.name = n; }
    if (patch.slot != null) i.slot = patch.slot;
    if (patch.range != null) i.range = patch.range;
    if (patch.hands != null) i.hands = patch.hands;
    if (patch.wtype != null) { if (patch.wtype) i.wtype = patch.wtype; else delete i.wtype; }
    if (patch.ctype != null) { if (patch.ctype) i.ctype = patch.ctype; else delete i.ctype; }
    if (patch.look != null) { if (patch.look) i.look = Math.trunc(Number(patch.look)); else delete i.look; }
    if (patch.cond != null) i.cond = clipText(patch.cond, 40);
    state.inventory = normalizeInventory(state.inventory);
  });
  /** Вещь рюкзака становится вещью гардероба (одеждой или оружием) и обратно. */
  const setItemKind = (id, kind, props = {}) => mutate(state => {
    const i = state.inventory.find(x => x.id === id);
    if (!i) return;
    if (!kind) { delete i.kind; delete i.slot; delete i.range; delete i.hands; delete i.wtype; delete i.ctype; delete i.look; delete i.worn; delete i.cond; delete i.loot; }
    else Object.assign(i, { kind }, props);
    state.inventory = normalizeInventory(state.inventory);
  });
  const wearItem = id => { let ok = false; mutate(state => { const r = gearWear(state.inventory, id); if (r.ok) { state.inventory = normalizeInventory(r.items); ok = true; } }); return ok; };
  const unwearItem = id => { let ok = false; mutate(state => { const r = gearUnwear(state.inventory, id); if (r.ok) { state.inventory = normalizeInventory(r.items); ok = true; } }); return ok; };
  // ---------- комплекты одежды ----------
  /** Вещь входит в комплект или выходит из него (одна вещь на слот: новая заменяет прежнюю). */
  const toggleOutfitItem = (personId, outfitId, itemId) => mutate(state => {
    const item = state.inventory.find(i => i.id === itemId && i.ownerId === personId && i.kind === 'gear');
    if (!item) return;
    const cur = state.outfits?.[personId]?.[outfitId]?.[item.slot];
    state.outfits = outfitSet(state.outfits, personId, outfitId, item.slot, cur === itemId ? '' : itemId);
  });
  /** Комплект = то, что надето сейчас. */
  const saveOutfit = (personId, outfitId) => mutate(state => { state.outfits = outfitSaveWorn(state.inventory, state.outfits, personId, outfitId); });
  /** Надевает комплект целиком: занятые слоты, остальное не трогает. Возвращает true, если что-то поменялось. */
  const wearOutfit = (personId, outfitId) => { let ok = false; mutate(state => { const r = gearWearOutfit(state.inventory, state.outfits, personId, outfitId); if (r.ok) { state.inventory = normalizeInventory(r.items); ok = true; } }); return ok; };
  /** Возбуждение вручную: 0..4 (0 снимает). */
  const setArousal = (personId, lvl) => mutate(state => {
    if (!state.cast.some(p => p.id === personId)) return;
    (state.bodies[personId] ??= emptyBody()).arousal = cleanArousal(lvl);
  });
  /** Настроение вручную: id из MOODS и сила 1..3 (calm без силы снимает отметку). */
  const setMood = (personId, moodId, lvl = 2) => mutate(state => {
    if (!state.cast.some(p => p.id === personId)) return;
    const body = (state.bodies[personId] ??= emptyBody());
    body.mood = MOOD_IDS.includes(moodId) ? cleanMood({ id: moodId, lvl }) : null;
  });
  /** Надел или снял одежду, взял или убрал оружие по словам рассказчика: только вещи из гардероба, с записью в журнал для отмены. */
  const applyWearChange = ({ ownerId, name, on = true, label = '', at }) => {
    if (!get().hasChat) return '';
    let made = '';
    mutate(state => {
      const it = findGear(state.inventory, ownerId, name);
      if (!it) return;
      const r = on ? gearWear(state.inventory, it.id) : gearUnwear(state.inventory, it.id);
      if (!r.ok) return;
      state.inventory = normalizeInventory(r.items);
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'item', op: 'wear', label: clipText(label || `${on ? 'Надел' : 'Снял'}: ${it.name}`, 300), touched: r.touched, before: r.before };
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };
  /** Передаёт вещь (всю или часть) другому владельцу вручную. */
  const giveItem = (id, toId, qty) => {
    const i = get().state?.inventory.find(x => x.id === id);
    if (!i) return false;
    let ok = false;
    mutate(state => { const r = applyItemOp(state.inventory, { op: 'give', name: i.name, qty: qty ?? i.qty, ownerId: i.ownerId, toId }, () => newId('i')); if (r.ok) { state.inventory = normalizeInventory(r.items); ok = true; } });
    return ok;
  };
  /** Изменение вещей от Архивариуса с записью в журнал (для отмены и отката вместе с ответом). */
  const applyItemChange = ({ op, name, qty = 1, ownerId = '', toId = '', note = '', label = '', at }) => {
    if (!get().hasChat) return '';
    let made = '';
    mutate(state => {
      const r = applyItemOp(state.inventory, { op, name, qty, ownerId, toId, note }, () => newId('i'));
      if (!r.ok) return;
      state.inventory = normalizeInventory(r.items);
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'item', op, label: clipText(label, 300), touched: r.touched, before: r.before };
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };


  /** Применяет изменение тела от Архивариуса (след, рана, снятие следа) с записью в журнал для отмены. */
  const applyBodyChange = ({ op, personId, text, days = 2, zone = 'chest', sev = 1, condId = '', label = '', at, on = true }) => {
    if (!get().hasChat) return '';
    if (op === 'wear') return applyWearChange({ ownerId: personId, name: text, on, label, at });
    let made = '';
    const info = get();
    mutate(state => {
      if (!state.cast.some(p => p.id === personId)) return;
      const body = (state.bodies[personId] ??= emptyBody());
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'body', label: clipText(label, 300), personId, add: { conds: [], wounds: [] }, removed: [], prevTier: body.tier };
      if (op === 'mark') {
        const t = clipText(text, 120);
        if (!t) return;
        const id = newId('k');
        const n = Math.trunc(Number(days));
        body.conds.push({ id, t, until: n > 0 ? shiftDate(state.calendar, info.today, n) : null });
        entry.add.conds.push(id);
      } else if (op === 'wound') {
        const t = clipText(text, 120), level = Math.trunc(Number(sev));
        if (!t || !ZONE_IDS.includes(zone) || !(level >= 1 && level <= 3)) return;
        const id = newId('w');
        body.wounds.push({ id, zone, t, sev: level, bnd: false, since: { year: info.today.year, doy: info.today.doy } });
        if (body.tier < level) body.tier = level;
        entry.add.wounds.push(id);
      } else if (op === 'mood') {
        if (!MOOD_IDS.includes(text)) return;
        const next = cleanMood({ id: text, lvl: sev });
        if (body.mood && body.mood.id === next.id && body.mood.lvl === next.lvl) return;
        entry.moodSet = true; entry.prevMood = body.mood ?? null;
        body.mood = next;
      } else if (op === 'arousal') {
        const next = cleanArousal(sev);
        if (cleanArousal(body.arousal) === next) return;
        entry.arousalSet = true; entry.prevArousal = cleanArousal(body.arousal);
        body.arousal = next;
      } else if (op === 'clear') {
        const hit = body.conds.find(c => c.id === condId);
        if (!hit) return;
        entry.removed.push({ id: hit.id, t: hit.t, until: hit.until });
        body.conds = body.conds.filter(c => c.id !== condId);
      } else return;
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };


  // ---------- карта ----------
  const putPlaceLib = lib => { settings.places = lib; save(); };
  const placeLib = () => normalizePlaceLib(settings.places);
  const sameNode = (nodes, name, parentId) => nodes.find(n => n.parentId === (parentId || '') && n.name.toLowerCase() === String(name).trim().toLowerCase());
  /** Новое место: в библиотеку (scope 'library', можно папку) или только в этот чат (scope 'chat'). Возвращает id. */
  const addPlace = ({ name, parentId = '', scope = 'library', kind = 'place', description = '' }) => {
    const text = clipText(name, 80);
    if (!text || !get().hasChat && scope === 'chat') return '';
    const id = newId('m');
    const node = { id, name: text, kind: scope === 'library' && kind === 'folder' ? 'folder' : 'place', parentId, aliases: [], description, traits: [], notes: [] };
    if (scope === 'library') { const lib = placeLib(); if (sameNode(lib.nodes, text, parentId)) return ''; lib.nodes.push(node); putPlaceLib(normalizePlaceLib(lib)); notify(); return id; }
    mutate(state => { state.map.nodes.push(node); state.map = normalizeMap(state.map); });
    return id;
  };
  /** «Герои бывали» и «Закреплено»: отметки места в этом чате. */
  const togglePlaceFlag = (id, flag) => {
    if (flag !== 'seen' && flag !== 'pin') return false;
    return mutate(state => {
      const set = new Set(state.map[flag] ?? []);
      if (set.has(id)) set.delete(id); else set.add(id);
      state.map = normalizeMap({ ...state.map, [flag]: [...set] });
    });
  };
  const updatePlace = (id, patch) => {
    const lib = placeLib();
    const n = lib.nodes.find(x => x.id === id);
    if (n) {
      if (patch.danger != null) n.danger = Boolean(patch.danger);
      if (patch.name != null) { const t = clipText(patch.name, 80); if (t) n.name = t; }
      if (patch.description != null) n.description = String(patch.description).slice(0, 2500);
      if (patch.aliases != null) n.aliases = String(patch.aliases).split(/[,;\n]/).map(a => a.trim()).filter(Boolean);
      if (patch.parentId != null && canMove(allNodes(lib, get().state?.map ?? { nodes: [] }), id, patch.parentId)) n.parentId = patch.parentId;
      if (patch.image != null) n.image = String(patch.image).slice(0, 300);
      putPlaceLib(normalizePlaceLib(lib)); notify(); return true;
    }
    return mutate(state => {
      const c = state.map.nodes.find(x => x.id === id);
      if (!c) return;
      if (patch.danger != null) c.danger = Boolean(patch.danger);
      if (patch.name != null) { const t = clipText(patch.name, 80); if (t) c.name = t; }
      if (patch.description != null) c.description = String(patch.description).slice(0, 2500);
      if (patch.aliases != null) c.aliases = String(patch.aliases).split(/[,;\n]/).map(a => a.trim()).filter(Boolean);
      if (patch.parentId != null && canMove(allNodes(lib, state.map), id, patch.parentId)) c.parentId = patch.parentId;
      if (patch.image != null) c.image = String(patch.image).slice(0, 300);
      state.map = normalizeMap(state.map);
    });
  };
  /**
   * Восстанавливает вложенность мест и их картинки из библиотеки Кулис: при первом переносе места лежали плоско под папкой акта,
   * а у Кулис «Палатка Мирена» внутри «Лагеря», «Бастионы рощи» внутри «Изумрудной рощи». Родитель меняется только у мест, чей
   * родитель сейчас папка (то, что человек вложил сам, не трогается). Картинки Кулис без расширения: оно подбирается пробой.
   */
  const restoreMapNesting = async ({ force = false } = {}) => {
    if (settings.mapNestingDone === 2 && !force) return { nested: 0, images: 0 };
    const kl = globalThis.SillyTavern.getContext().extensionSettings?.kulisy?.locationLibrary;
    if (!kl) return { nested: 0, images: 0 };
    const lib = placeLib();
    const byId = new Map(lib.nodes.map(n => [n.id, n]));
    let nested = 0, images = 0;
    const probe = async path => {
      if (/\.(png|webp|jpe?g|gif|avif)$/i.test(path)) return path;
      for (const ext of ['webp', 'png', 'jpg', 'jpeg']) {
        try { const r = await fetch(`${path}.${ext}`, { method: 'HEAD' }); if (r.ok) return `${path}.${ext}`; } catch { /* пробуем следующее расширение */ }
      }
      return '';
    };
    for (const k of nestingFromKulisy(kl)) {
      const n = byId.get(k.id);
      if (!n || n.kind === 'folder') continue;
      // «Лагерь» в папке «Лагерь» остаётся в своей папке (а палатки вложены в него)
      const own = k.ownFolder ? byId.get(k.ownFolder) : null;
      if (own && own.kind === 'folder') {
        if (n.parentId !== own.id) { n.parentId = own.id; nested += 1; }
        if (!n.image && k.image) { const found = await probe(k.image); if (found) { n.image = found; images += 1; } }
        continue;
      }
      const parent = k.parentId ? byId.get(k.parentId) : null;
      if (parent && parent.kind !== 'folder' && n.parentId !== k.parentId && (!n.parentId || byId.get(n.parentId)?.kind === 'folder') && canMove(lib.nodes, n.id, k.parentId)) { n.parentId = k.parentId; nested += 1; }
      if (!n.image && k.image) { const found = await probe(k.image); if (found) { n.image = found; images += 1; } }
    }
    putPlaceLib(normalizePlaceLib(lib));
    settings.mapNestingDone = 2; save();
    notify();
    return { nested, images };
  };
  const removePlace = id => {
    const lib = placeLib();
    if (lib.nodes.some(n => n.id === id)) {
      const gone = new Set([id]);
      for (let i = 0; i < 6; i++) for (const n of lib.nodes) if (gone.has(n.parentId)) gone.add(n.id);   // потомки уходят вместе
      lib.nodes = lib.nodes.filter(n => !gone.has(n.id));
      putPlaceLib(normalizePlaceLib(lib));
      if (get().hasChat) mutate(state => { if (gone.has(state.map.current)) state.map.current = ''; for (const g of gone) delete state.map.over[g]; });
      else notify();
      return true;
    }
    return mutate(state => { state.map.nodes = state.map.nodes.filter(n => n.id !== id && n.parentId !== id); if (state.map.current === id) state.map.current = ''; delete state.map.over[id]; });
  };
  /** Приметы и перемены: scope 'library' правит основу места, 'chat' только слой этого чата. */
  const placeText = (id, field, text, scope, remove = false) => {
    const t = clipText(text, 160);
    if (!t) return false;
    const key = field === 'notes' ? 'notes' : 'traits';
    if (scope === 'library') {
      const lib = placeLib(); const n = lib.nodes.find(x => x.id === id);
      if (!n) return false;
      n[key] = remove ? n[key].filter(x => x !== t) : [...n[key], t];
      putPlaceLib(normalizePlaceLib(lib)); notify(); return true;
    }
    return mutate(state => {
      const c = state.map.nodes.find(x => x.id === id);
      if (c) c[key] = remove ? c[key].filter(x => x !== t) : [...c[key], t];
      else { const o = (state.map.over[id] ??= { traits: [], notes: [] }); o[key] = remove ? o[key].filter(x => x !== t) : [...o[key], t]; }
      state.map = normalizeMap(state.map);
    });
  };
  /** Включает и выключает карточку места в этом чате: выключенная рассказчику не уходит. */
  const togglePlaceCard = id => mutate(state => {
    // переключатель родителя (места или группы) включает и выключает сразу всё, что внутри него
    const nodes = allNodes(normalizePlaceLib(settings.places), state.map);
    const self = nodes.find(n => n.id === id);
    const targets = [self, ...descendantsOf(nodes, id)].filter(n => n && n.kind !== 'folder').map(n => n.id);
    const off = new Set(state.map.off ?? []);
    const isOn = self?.kind === 'folder' ? targets.some(x => !off.has(x)) : !off.has(id);   // у группы «включено», если включено хоть что-то внутри
    for (const x of targets) { if (isOn) off.add(x); else off.delete(x); }
    state.map.off = [...off];
  });
  /** Включает все карточки мест этого чата разом. */
  const enableAllPlaceCards = () => mutate(state => { state.map.off = []; });
  const setCurrentPlace = id => mutate(state => {
    state.map.current = id || '';
    if (id && !(state.map.seen ?? []).includes(id)) state.map.seen = [...(state.map.seen ?? []), id];      // где побывали, отмечается само
    if (id) { const nodes = allNodes(normalizePlaceLib(settings.places), state.map); const p = pathOf(nodes, id); if (p) state.place = p; }
  });
  /** Изменение места от Архивариуса: сцена, новое место, находки, перемены. С записью в журнал для отмены. */
  const applyPlaceChange = ({ current, traits = [], notes = [], label = '', at }) => {
    if (!get().hasChat) return '';
    let made = '';
    mutate(state => {
      const lib = normalizePlaceLib(settings.places);
      const before = { current: state.map.current, place: state.place, over: {} };
      const added = [];
      const keep = id => { if (!(id in before.over)) before.over[id] = state.map.over[id] ? { traits: [...state.map.over[id].traits], notes: [...state.map.over[id].notes] } : null; };
      let curId = null;
      if (current) {
        if (current.id) curId = current.id;
        else {
          const id = newId('m');
          state.map.nodes.push({ id, name: current.name, kind: 'place', parentId: current.parentId ?? '', aliases: [], description: '', traits: [], notes: [] });
          added.push(id); curId = id;
        }
      }
      const idOf = t => t.placeId || (current && !current.id && t.placeName === current.name ? curId : '');
      for (const [list, key] of [[traits, 'traits'], [notes, 'notes']]) for (const t of list) {
        const id = idOf(t);
        if (!id) continue;
        const local = state.map.nodes.find(x => x.id === id);
        if (local) { if (!added.includes(id)) keep(id); local[key] = [...local[key], t.text]; }
        else { keep(id); const o = (state.map.over[id] ??= { traits: [], notes: [] }); o[key] = [...o[key], t.text]; }
      }
      if (curId) { state.map.current = curId; const p = pathOf(allNodes(lib, state.map), curId); if (p) state.place = p; }
      if (curId && settings.fate?.autoMode !== false) { const r = detectAutoMode({ text: '', place: state.place, level: 0, mode: state.fate.mode, auto: state.fate.auto, back: state.fate.back }); if (r) { state.fate.mode = r.mode; state.fate.auto = r.auto; state.fate.back = r.back ?? null; } }
      state.map = normalizeMap(state.map);
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'place', label: clipText(label, 300), before, addedNodeIds: added };
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };
  /** Что даст файл сборщика мест (tools/places): сколько новых, обновлённых и привязанных записей лорбука. Ничего не меняет. */
  const previewPlaceFile = file => {
    if (!file || !Array.isArray(file.nodes)) return { ok: false, error: 'В файле нет списка мест. Нужен places.json от сборщика.' };
    const r = mergePlaceFile(placeLib(), file);
    return { ok: true, added: r.added, updated: r.updated, same: r.same, links: r.links.length, imagesSkipped: r.imagesSkipped, world: String(file.world ?? '') };
  };
  const importPlaceFile = file => {
    const pre = previewPlaceFile(file);
    if (!pre.ok) return pre;
    const r = mergePlaceFile(placeLib(), file);
    putPlaceLib(normalizePlaceLib({ nodes: r.nodes }));
    // связи: записи, пришедшие в файле, заменяют прежние с тем же названием; остальные остаются
    const incoming = new Set(r.links.map(l => l.entry));
    settings.placeLinks = [...(Array.isArray(settings.placeLinks) ? settings.placeLinks : []).filter(l => !incoming.has(l.entry)), ...r.links];
    save(); notify();
    return pre;
  };
  /** Привязывает запись лорбука к месту вручную (правило по умолчанию «здесь или по ключам»). */
  const addPlaceLink = (placeId, { entry, book = '', when = 'here_or_keys' } = {}) => {
    const text = clipText(entry, 120);
    if (!text || !placeId || !allNodes(placeLib(), get().state?.map ?? { nodes: [] }).some(n => n.id === placeId)) return false;
    const links = normalizeLinks(settings.placeLinks);
    if (links.some(l => l.placeId === placeId && loreKey(l) === loreKey({ placeId, entry: text }))) return false;
    links.push({ placeId, entry: text, book: clipText(book, 120), file: '', when, how: 'вручную' });
    settings.placeLinks = normalizeLinks(links); save(); notify();
    deps.shared.placeLore?.refresh?.();
    return true;
  };
  /** Отвязывает запись от места (сама запись в лорбуке остаётся). */
  const removePlaceLink = (placeId, entry) => {
    const key = loreKey({ placeId, entry });
    const links = normalizeLinks(settings.placeLinks);
    const rest = links.filter(l => loreKey(l) !== key);
    if (rest.length === links.length) return false;
    settings.placeLinks = rest; save();
    mutate(state => { state.map = normalizeMap({ ...state.map, loreOff: (state.map.loreOff ?? []).filter(k => k !== key) }); });
    deps.shared.placeLore?.refresh?.();
    return true;
  };
  /** Правило «когда слать» для привязанной записи (общее для всех чатов). */
  const setLoreWhen = (placeId, entry, when) => {
    if (!LORE_WHEN.includes(when)) return false;
    const key = loreKey({ placeId, entry });
    const links = normalizeLinks(settings.placeLinks);
    const l = links.find(x => loreKey(x) === key);
    if (!l) return false;
    l.when = when;
    settings.placeLinks = links; save(); notify();
    deps.shared.placeLore?.refresh?.();
    return true;
  };
  /** Включить или выключить привязанную запись в этом чате (выключенная не уходит совсем, как отключённая запись лорбука). */
  const toggleLore = (placeId, entry) => {
    const key = loreKey({ placeId, entry });
    return mutate(state => {
      const off = new Set(state.map.loreOff ?? []);
      if (off.has(key)) off.delete(key); else off.add(key);
      state.map = normalizeMap({ ...state.map, loreOff: [...off] });
    });
  };
  const previewKulisyMap = () => {
    const info = get();
    if (!info.hasChat || !globalThis.Kulisy?.getState) return null;
    const ku = kulisyState();
    const kl = globalThis.SillyTavern.getContext().extensionSettings?.kulisy?.locationLibrary;
    const libNodes = libraryFromKulisy(kl);
    const have = new Set(placeLib().nodes.map(n => n.id));
    const map = mapFromKulisy(ku, libNodes.length ? libNodes : placeLib().nodes);
    return { libNodes, freshLib: libNodes.filter(n => !have.has(n.id)).length, map, chatPlaces: map.nodes.length, overlays: Object.keys(map.over).length };
  };
  /** Библиотека Кулис в общую библиотеку (новые узлы), места чата Кулис в этот чат; текущее место берётся, если оно найдено. */
  const importMapFromKulisy = () => {
    const plan = previewKulisyMap();
    if (!plan) return { ok: false };
    const lib = placeLib();
    const have = new Set(lib.nodes.map(n => n.id));
    for (const n of plan.libNodes) if (!have.has(n.id)) lib.nodes.push(n);
    putPlaceLib(normalizePlaceLib(lib));
    mutate(state => {
      const ids = new Set(state.map.nodes.map(n => n.id));
      for (const n of plan.map.nodes) if (!ids.has(n.id)) state.map.nodes.push(n);
      for (const [id, o] of Object.entries(plan.map.over)) { const cur = state.map.over[id] ?? { traits: [], notes: [] }; state.map.over[id] = { traits: [...new Set([...cur.traits, ...o.traits])], notes: [...new Set([...cur.notes, ...o.notes])] }; }
      if (!state.map.current && state.place) {
        // текущее место: то, что уже записано в строке «Страна › Город › Место» (место Кулис могло устареть)
        const all = allNodes(normalizePlaceLib(settings.places), state.map);
        const last = state.place.split('›').map(s => s.trim()).filter(Boolean).pop() ?? '';
        const hit = findNode(all, last);
        if (hit) state.map.current = hit.id;
      }
      state.map = normalizeMap(state.map);
    });
    return { ok: true, library: plan.freshLib, places: plan.chatPlaces, overlays: plan.overlays };
  };


  /** Секреты из лорбуков: новые события (текст тайны только знающим), у существующих обновляется текст. items: [{ book, uid, title, names, content }]. */
  const syncLoreSecrets = (items, allowedBooks = null) => {
    if (!get().hasChat) return { added: 0, updated: 0, removed: 0 };
    let added = 0, updated = 0, removed = 0;
    // лорбуки, не привязанные к этому чату и персонажу: секреты, когда-то попавшие из них в этот чат, убираются
    if (Array.isArray(allowedBooks)) {
      const gone = get().knowledge.events.filter(e => e.lore && !allowedBooks.includes(e.lore.book)).map(e => e.id);
      if (gone.length) {
        const ids = new Set(gone);
        mutate(state => { state.knowledge.events = state.knowledge.events.filter(e => !ids.has(e.id)); state.knowledge.learned = state.knowledge.learned.filter(l => !ids.has(l.eventId)); });
        removed = gone.length;
      }
    }
    if (!items.length) return { added, updated, removed };
    mutate(state => {
      const k = state.knowledge;
      const people = [...state.cast.map(p => ({ id: p.id, names: [p.name, ...(state.relations.people.find(x => x.id === p.id)?.aliases ?? [])] })), ...state.relations.people.filter(p => !state.cast.some(c => c.id === p.id)).map(p => ({ id: p.id, names: [p.name, ...(p.aliases ?? [])] }))];
      const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();
      const resolve = name => people.find(p => p.names.some(n => norm(n) === norm(name)))?.id ?? people.find(p => p.names.some(n => norm(n).split(' ').some(w => w.length >= 3 && norm(name).split(' ').includes(w))))?.id;
      for (const it of items) {
        const have = findLoreEvent(k, it.book, it.uid);
        const detail = String(it.content).slice(0, 1500);
        if (have) { if (have.detail !== detail || have.text !== clipText(it.title, 500)) { have.detail = detail; have.text = clipText(it.title, 500) || have.text; updated += 1; } continue; }
        if (k.events.length >= 600) break;
        k.events.push({ id: newId('v'), text: clipText(it.title, 500), witnessIds: it.names.map(resolve).filter(Boolean), secret: true, lore: { book: it.book, uid: it.uid }, detail });
        added += 1;
      }
      state.knowledge = normalizeKnowledge(k);
    });
    return { added, updated, removed };
  };


  /** Изменение знаний от Архивариуса: события, кто узнал, знакомства, смерти. С записью в журнал для отмены. */
  const applyKnowledgeChange = ({ events = [], learned = [], met = [], deaths = [], watch = null, label = '', at }) => {
    if (!get().hasChat) return '';
    let made = '';
    mutate(state => {
      const k = state.knowledge;
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'know', label: clipText(label, 300), events: [], learned: [], deaths: [], meet: {} };
      for (const e of events) { if (k.events.length >= 600) break; const id = newId('v'); k.events.push({ id, text: clipText(e.text, 500), witnessIds: e.witnessIds ?? [], ...(e.secret ? { secret: true } : {}) }); entry.events.push(id); }
      for (const l of learned) {
        const ev = k.events.find(x => x.id === l.eventId);
        if (!ev || ev.witnessIds.includes(l.personId) || k.learned.some(x => x.eventId === l.eventId && x.entityId === l.personId)) continue;
        const id = newId('n');
        k.learned.push({ id, eventId: l.eventId, entityId: l.personId, source: l.source === 'rumor' ? 'rumor' : 'told', ...(l.fromId ? { fromId: l.fromId } : {}) });
        entry.learned.push(id);
      }
      for (const m of met) { entry.meet[m.key] = k.acquaintances[m.key] ?? null; k.acquaintances[m.key] = m.status; }
      for (const d of deaths) { if (k.deaths[d.personId]) continue; k.deaths[d.personId] = { note: clipText(d.note, 300) }; entry.deaths.push(d.personId); const gone = state.cast.find(p => p.id === d.personId); if (gone) gone.present = false; }
      // журнал наблюдений удалённого свидетеля (Око): одна накопительная тайна на наблюдателя, строки дописываются, бюджет держится
      if (watch?.text && watch.watcherId) {
        let log = k.events.find(e => e.watch && e.witnessIds.includes(watch.watcherId));
        const created = !log;
        if (!log && k.events.length < 600) { log = { id: newId('v'), text: 'Журнал наблюдений', witnessIds: [watch.watcherId], secret: true, own: true, watch: true, detail: '' }; k.events.push(log); }
        if (log) {
          const prev = log.detail ?? '';
          log.detail = appendWatchLog(prev, watch.text);          // хранится целиком; рассказчику уходит выжимка по бюджету, Вестникам всё
          const added = log.detail !== prev ? (log.detail.split('\n').filter(Boolean).at(-1) ?? '') : '';
          entry.watch = { eventId: log.id, added, created };      // для отката хранится только дописанная строка, а не весь журнал
        }
      }
      if (!entry.events.length && !entry.learned.length && !entry.deaths.length && !Object.keys(entry.meet).length && !entry.watch) return;
      state.knowledge = normalizeKnowledge(k);
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };


  /** Общее воспоминание или напряжение пары от Архивариуса (как у Кулис: запись на каждый заметный момент). С записью в журнал. */
  const applyMoment = ({ who, mkind, text, intensity = 3, label = '', at }) => {
    if (!get().hasChat) return '';
    let made = '';
    mutate(state => {
      const r = state.relations;
      const t = clipText(text, 400);
      if (!t || (who ?? []).length < 2) return;
      let removed = null;
      if (r.shared.length >= 60) { const i = r.shared.findIndex(x => !x.pinned); if (i >= 0) { removed = r.shared.splice(i, 1)[0]; } }
      const rec = { id: newId('s'), kind: mkind === 'tension' ? 'tension' : 'memory', text: t, intensity: Math.min(Math.max(Math.round(Number(intensity) || 3), 1), 5), pinned: false, disabled: false, who: who.slice(0, 12) };
      r.shared.push(rec);
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'moment', label: clipText(label, 300), sharedId: rec.id, removed };
      r.log.push(entry);
      state.relations = normalizeRelations(r);
      made = entry.id;
    });
    return made;
  };
  /** Изменение журнала квестов от Архивариуса (запись в ленту или смена состояния зацепки) с записью для отмены. */
  const applyJournalChange = ({ kind, questId, text, leadId, state: next, note = '', label = '', at }) => {
    if (!get().hasChat) return '';
    let made = '';
    const now = stamp();
    mutate(state => {
      const q = state.quests.find(x => x.id === questId);
      if (!q) return;
      const entry = { id: logId(), at: Math.max(0, Math.trunc(Number(at)) || 0), kind: 'quest', label: clipText(label, 300), questId, entryId: '', leadId: '', prevState: '', prevNote: '' };
      if (kind === 'entry') {
        const t = clipText(text, 400);
        if (!t || q.entries.length >= 200) return;
        const id = newId('e');
        q.entries.push({ id, date: now.date, minutes: now.minutes, t });
        entry.entryId = id;
      } else if (kind === 'lead') {
        const lead = q.leads.find(l => l.id === leadId);
        if (!lead || !LEAD_STATES.includes(next)) return;
        entry.leadId = leadId; entry.prevState = lead.state; entry.prevNote = lead.note;
        lead.state = next;
        if (note) lead.note = clipText(note, 300);
      } else return;
      state.relations.log.push(entry);
      state.relations = normalizeRelations(state.relations);
      made = entry.id;
    });
    return made;
  };


  // ---------- персона (игрок) ----------
  const normName = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  /** Персона это игрок, а не персонаж: у неё нет «чувств» для рассказчика, анкеты, знакомств по умолчанию; в списке она помечена. */
  const setPersona = id => mutate(state => {
    if (!state.cast.some(p => p.id === id)) return;
    for (const p of state.cast) p.persona = p.id === id;
    state.personaManual = true;
  });
  const clearPersonaLock = () => mutate(state => { state.personaManual = false; });
  /** Другие имена человека (прозвища, формы имени): по ним его узнают в тексте. Правятся и у персоны. */
  const setAliases = (id, text) => mutate(state => {
    const p = state.cast.find(x => x.id === id) ?? state.relations.people.find(x => x.id === id);
    if (!p) return;
    const aliases = String(text ?? '').split(/[,;\n]/).map(a => a.replace(/\s+/g, ' ').trim()).filter(a => a && normName(a) !== normName(p.name)).slice(0, 10);
    let reg = state.relations.people.find(x => x.id === id);
    if (!reg) { reg = { id, name: p.name, aliases: [] }; state.relations.people.push(reg); }
    reg.aliases = aliases;
    state.relations = normalizeRelations(state.relations);
  });
  const personaSeen = new Set();       // «чат|имя»: уже предупредили или пользователь решил оставить как есть
  const wordsEq = (x, y) => normName(x).split(' ').some(w => w.length >= 3 && normName(y).split(' ').includes(w));
  const sameAsTavern = (p, tavern, aliases) => normName(p.name) === normName(tavern) || (aliases ?? []).some(a => normName(a) === normName(tavern)) || wordsEq(p.name, tavern);
  /** Страховка: имя игрока в Таверне не совпадает с персоной, привязанной в этом чате (зашли не с той персоной). null, если всё в порядке или решение уже принято. */
  const personaMismatch = info => {
    try {
      const tavern = String(ctx().name1 ?? '').trim();
      const persona = info.cast.find(p => p.persona);
      if (!tavern || !persona) return null;
      if (sameAsTavern(persona, tavern, info.relations.people.find(x => x.id === persona.id)?.aliases)) return null;
      if (personaSeen.has(`${ctx().chatId}|dismiss|${normName(tavern)}`)) return null;
      return { tavern, bound: persona.name };
    } catch { return null; }
  };
  /** Привязка к персоне Таверны. Если в чате персоны ещё нет, привязывается тот, кто назван в Таверне игроком. Если персона уже есть и не совпадает,
   *  НИЧЕГО не меняется молча: расширение предупреждает (плашка в строке и всплывающее сообщение), решение за пользователем. */
  const syncPersona = () => {
    const name = String(ctx().name1 ?? '').trim();
    const info = get();
    if (!info.hasChat || !name) return false;
    const existing = info.cast.find(p => p.persona);
    if (existing) {
      const m = personaMismatch(info);
      const key = `${ctx().chatId}|warn|${normName(name)}`;
      if (m && !personaSeen.has(key)) {
        personaSeen.add(key);
        try { globalThis.toastr?.warning(`В Таверне сейчас персона «${m.tavern}», а в этом чате привязана «${m.bound}». Архивариус на паузе, пока вы не выберете: значок ⚠ в строке сцены.`, 'Кадр', { timeOut: 0, extendedTimeOut: 0, closeButton: true }); } catch { /* уведомления нет */ }
        notify();
      }
      return false;
    }
    // персону сама не заводит: если в составе есть человек с именем игрока, помечает его; иначе привязка ручная (switchPersona)
    const hit = info.cast.find(p => sameAsTavern(p, name, info.relations.people.find(x => x.id === p.id)?.aliases));
    if (!hit) return false;
    return mutate(state => { for (const p of state.cast) p.persona = p.id === hit.id; });
  };
  /** Выбор «переключить»: персоной становится тот, кто назван игроком в Таверне (находится в составе или добавляется). */
  const switchPersona = () => {
    const name = String(ctx().name1 ?? '').trim();
    const info = get();
    if (!info.hasChat || !name) return false;
    const hit = info.cast.find(p => sameAsTavern(p, name, info.relations.people.find(x => x.id === p.id)?.aliases));
    return mutate(state => {
      if (hit) { for (const p of state.cast) p.persona = p.id === hit.id; }
      else { for (const p of state.cast) p.persona = false; state.cast.push({ id: newId('c'), name: name.slice(0, 60), persona: true, present: true }); }
      state.personaManual = false;
    });
  };
  /** Привязка персоны по выбранному имени (мастер настройки): без угадывания по тому, кто сейчас в Таверне. */
  const bindPersonaByName = name => {
    const text = clipText(name, 60);
    const info = get();
    if (!text || !info.hasChat) return false;
    const hit = info.cast.find(p => sameAsTavern(p, text, info.relations.people.find(x => x.id === p.id)?.aliases));
    return mutate(state => {
      if (hit) { for (const p of state.cast) p.persona = p.id === hit.id; }
      else { for (const p of state.cast) p.persona = false; state.cast.push({ id: newId('c'), name: text, persona: true, present: true }); }
      state.personaManual = true;                    // выбрана вручную: сама больше не переключается
    });
  };
  /**
   * Начало истории (мастер настройки): мир и первый день. Если мир другой, переход как в «Календаре» (всё прежнее остаётся за прежним миром);
   * дата становится и началом времени, и Д1; лента времени начинается заново.
   */
  const startStory = ({ calendar, year, doy, minutes = 8 * 60 } = {}) => {
    const info = get();
    if (!info.hasChat) return false;
    const id = CALENDARS[calendar] ? calendar : info.state.calendar;
    if (!validDate(id, year, doy, minutes)) return false;
    return mutate(state => {
      if (state.calendar !== id) { const next = switchWorld(state, id); for (const k of Object.keys(state)) delete state[k]; Object.assign(state, next); }
      state.start = { year, doy, minutes };
      state.dayOne = { year, doy };
      state.timeline = [];
    });
  };
  /** Выбор «оставить»: в этом чате персоной остаётся прежняя, предупреждение для этого имени больше не показывается. */
  const keepPersona = () => { personaSeen.add(`${ctx().chatId}|dismiss|${normName(ctx().name1)}`); notify(); return true; };


  // ---------- проверка кубом для персоны ----------
  /** Назначить проверку вручную (или из строки рассказчика): сложность 1..20, режим обычный, с преимуществом или с помехой. */
  const assignCheck = ({ label = '', dc = 12, mode = 'normal', kind = 'dodge' } = {}) => withFate((f, state) => {
    if (intimateNow(state)) return;                 // в интимной сцене d20 не бросается
    const k = CHECK_KINDS.includes(kind) ? kind : 'dodge';
    f.check = { id: newId('q'), kind: k, label: clipText(label, 80) || (k === 'skill' ? 'попытка' : 'атака'), dc: Math.min(Math.max(Math.trunc(Number(dc)) || 12, 1), 20), mode: CHECK_MODES.includes(mode) ? mode : 'normal', at: Math.max(0, chatLength() - 1), roll: null };
  });
  /** Идёт ли близость: тогда проверки кубом не назначаются (режим «Интим» или открытая лесенка). */
  const intimateNow = state => state.fate.mode === 'intimacy' || Boolean(state.fate.heat);
  const clearCheck = () => withFate(f => { f.check = null; });
  /** Бросок: результат запоминается, рассказчику уходит одноразовая подсказка, а при попадании персоне сам записывается ранение (с отменой). */
  const rollCheck = ({ dice = null } = {}) => {
    const info = get();
    const check = info.fate.check;
    if (!info.hasChat || !check || check.roll || intimateNow(info.state)) return null;
    const result = rollCheckCore({ dc: check.dc, mode: check.mode, dice, kind: check.kind });
    const persona = info.cast.find(p => p.persona);
    const zone = ZONE_IDS[Math.floor(Math.random() * ZONE_IDS.length)];
    const label = `${check.label}, сложность ${check.dc}, ${CHECK_MODE_RU[check.mode]}: выпало ${result.roll} (${OUTCOME_RU[result.outcome]})`;
    withFate(f => {
      f.check = { ...f.check, roll: result };
      f.event = { kind: 'roll', label: `Куб: ${label}`, text: checkDirective(check, result), sent: false, ...(persona ? { target: { id: persona.id, name: persona.name, persona: true } } : {}), ...(result.sev && persona ? { harm: { t: `рана: ${check.label}`, sev: result.sev, zone, done: false } } : {}) };
    });
    if (result.sev && persona && settings.fate?.autoWound !== false) {
      const made = applyBodyChange({ op: 'wound', personId: persona.id, text: `рана: ${check.label}`, zone, sev: result.sev, label: `${persona.name}: ${OUTCOME_RU[result.outcome]} (${check.label})`, at: check.at });
      if (made) withFate(f => { if (f.event?.harm) f.event.harm.done = true; });
    }
    return result;
  };

  // ---------- перенос из Кулис ----------
  const kulisyState = () => { try { return globalThis.Kulisy?.getState?.() ?? null; } catch (error) { report('чтение состояния Кулис', error); return null; } };
  /** Что можно перенести из Кулис в открытом чате; ничего не меняет. { missing: true }, если расширения Кулисы нет. */
  const previewKulisy = () => {
    const info = get();
    if (!info.hasChat) return null;
    if (!globalThis.Kulisy?.getState) return { ok: false, missing: true, warnings: ['расширение Кулисы не найдено'] };
    return convertKulisy(kulisyState(), info.state.calendar);
  };
  /** Переносит дату и время, место, погоду и накал (как стартовое напряжение). Квесты пока не переносятся: журнала ещё нет. */
  const importFromKulisy = () => {
    const info = get();
    const plan = previewKulisy();
    if (!info.hasChat || !plan?.ok) return { ok: false, applied: [], warnings: plan?.warnings ?? ['нет открытого чата'] };
    const applied = [];
    mutate(state => {
      const at = lastIndex(chatLength());
      if (plan.date) { addEvent(state, { type: 'set', at, ...plan.date }); applied.push('дата и время'); }
      // номер дня истории: у Кулис «день 3» значит, что сегодняшняя дата это день 3, а первым днём считается дата на два дня раньше
      const today = plan.date ?? { year: info.time.year, doy: info.time.doy };
      if (plan.dayNumber) { state.dayOne = shiftDate(state.calendar, { year: today.year, doy: today.doy }, -(plan.dayNumber - 1)); applied.push(`счётчик дней (сегодня Д${plan.dayNumber})`); }
      if (plan.place) { state.place = plan.place.slice(0, 400); applied.push('место'); }
      if (plan.weather) {
        const day = plan.date ?? info.time;
        const tempC = plan.weather.tempC ?? adjustTemp(plan.weather.kind, generateWeather(state.calendar, day.year, day.doy, state.climate).tempC);
        addEvent(state, { type: 'weather', at, day: dayKey(day.year, day.doy), kind: plan.weather.kind, tempC, text: plan.weather.text, source: 'manual' });
        applied.push('погода');
      }
      if (plan.tension) { addEvent(state, { type: 'tension', at, level: plan.tension.level, source: 'manual' }); applied.push('напряжение'); }
      if (!state.cast.length && plan.castFull?.length) {
        state.cast = plan.castFull.map(person => ({ id: newId('c'), name: person.name.slice(0, 60), persona: person.persona, present: true }));
        applied.push(`участники сцены (${state.cast.length})`);
      }
    });
    return { ok: true, applied, warnings: plan.warnings, quests: plan.quests.length };
  };

  /** Секретное письмо: ждёт следующего ответа рассказчика. Пустой текст снимает письмо. */
  const setLetter = text => mutate(state => { state.letter = cleanLetter(text); });
  const clearLetter = () => setLetter('');
  const setLayers = (calendarId, ids) => {
    settings.layers[calendarId] = [...ids];
    save();
    refreshPrompt();
    notify();
  };
  const setSetting = (key, value) => { settings[key] = value; save(); refreshPrompt(); notify(); };

  // ---------- события Таверны ----------
  const undo = [];
  const on = (name, fn) => {
    const c = ctx();
    const type = c.eventTypes?.[name];
    if (!type) return;
    c.eventSource.on(type, fn);
    undo.push(() => c.eventSource.removeListener(type, fn));
  };

  on('CHAT_CHANGED', () => { try { syncPersona(); } catch (error) { report('привязка персоны', error); } refreshPrompt(); notify(); });
  on('MESSAGE_SENT', () => { try { syncPersona(); } catch (error) { report('привязка персоны', error); } });
  /**
   * Погода по тексту ответа: старая смена от этого сообщения снимается (свайп, правка), потом ищется новая.
   * Событие встаёт только если погода реально сменилась относительно той, что была до этого ответа.
   */
  function applyTextWeather(state, index, text) {
    const before = state.timeline.length;
    state.timeline = state.timeline.filter(e => !(e.type === 'weather' && e.source === 'text' && e.at === index));
    let changed = state.timeline.length !== before;
    const hit = detectWeatherChange(text);
    if (hit) {
      const time = resolveTime(state, index + 1);
      const now = resolveWeather(state, time, index + 1, true);
      if (now && now.kind !== hit.kind) {
        addEvent(state, { type: 'weather', at: index, day: dayKey(time.year, time.doy), kind: hit.kind, tempC: adjustTemp(hit.kind, now.tempC), text: '', source: 'text' });
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Напряжение по тексту ответа: старая смена от этого сообщения снимается (свайп, правка), потом ищется новая.
   * Выше текущего: поднимаем; то же: продлеваем (не остывает, пока тревожные слова повторяются); спокойные слова: на ступень вниз.
   */
  function applyTextTension(state, index, text) {
    const before = state.timeline.length;
    state.timeline = state.timeline.filter(e => !(e.type === 'tension' && e.source === 'text' && e.at === index));
    let changed = state.timeline.length !== before;
    const hit = detectTension(text);
    if (hit) {
      const cur = resolveTension(state, index + 1, { decayEvery: settings.tensionDecay }).level;
      let next = null;
      if (hit.kind === 'up' && hit.level >= cur && hit.level > 0) next = hit.level;
      else if (hit.kind === 'down' && cur > 0) next = cur - 1;
      if (next !== null && !(next === cur && hit.kind === 'down')) {
        addEvent(state, { type: 'tension', at: index, level: next, source: 'text' });
        changed = true;
      }
    }
    return changed;
  }

  /** Новый ответ рассказчика, свайп или правка: авто-шаг времени, смена погоды и напряжения по тексту. */
  const onReply = index => {
    try {
      if (!settings.enabled || !hasChat()) return;
      const message = ctx().chat?.[index];
      if (!message || message.is_user || message.is_system) return;   // шаг и погода только по ответу рассказчика
      const state = readState();
      let changed = false;
      if (settings.autoStep && !hasStep(state, index)) {              // свайп того же сообщения шаг не удваивает
        addEvent(state, { type: 'step', at: index, minutes: Math.max(0, Math.round(settings.stepMinutes)) });
        changed = true;
      }
      if (settings.weather && settings.weatherFromText) changed = applyTextWeather(state, index, storyText(message.mes)) || changed;
      if (settings.tension && settings.tensionFromText) changed = applyTextTension(state, index, storyText(message.mes)) || changed;
      // строка проверки кубом в конце ответа: ставится ожидающая проверка; новый ответ без строки снимает старую
      const chk = parseCheck(storyText(message.mes));
      if (chk && settings.fate?.diceCheck !== false && !intimateNow(state)) { state.fate.check = { id: newId('q'), ...chk, at: index, roll: null }; changed = true; }
      else if (state.fate.check && (state.fate.check.at !== index || intimateNow(state))) { state.fate.check = null; changed = true; }
      else if (state.fate.check && state.fate.check.at === index && !chk) { state.fate.check = null; changed = true; }
      // режим сцены включается сам: Бой по напряжению, Лагерь, Остановка, Путь по месту и словам рассказа; ручной режим не трогается
      if (settings.fate?.autoMode !== false) {
        const level = settings.tension ? resolveTension(state, index + 1, { decayEvery: settings.tensionDecay }).level : 0;
        const r = (state.fate.set === 'daily' ? detectDailyMode : detectAutoMode)({ text: storyText(message.mes), place: state.place, level, combat: detectCombat(storyText(message.mes)), mode: state.fate.mode, auto: state.fate.auto, back: state.fate.back });
        if (r) { state.fate.mode = r.mode; state.fate.auto = r.auto; state.fate.back = r.back ?? null; changed = true; }
      }
      if (!changed) return;
      persist(state);
      refreshPrompt();
      notify();
    } catch (error) { report('ответ рассказчика (шаг времени, погода)', error); }
  };
  on('MESSAGE_RECEIVED', onReply);
  on('MESSAGE_SWIPED', onReply);
  on('MESSAGE_EDITED', onReply);
  // секретное письмо исчезает, когда пришёл ответ, который оно направляло (в том числе пересозданный ответ).
  // Переключение между готовыми свайпами (MESSAGE_SWIPED) письмо не трогает: нового ответа там нет.
  on('MESSAGE_RECEIVED', index => {
    try {
      if (!hasChat()) return;
      const message = ctx().chat?.[index];
      if (!message || message.is_user || message.is_system) return;
      const state = readState();
      const fateWaiting = (state.fate.event && !state.fate.event.sent) || heatPending(state.fate.heat);
      if (!state.letter && !fateWaiting) return;
      state.letter = '';
      if (state.fate.event) state.fate.event.sent = true;        // подсказка и бросок ушли с этим ответом
      if (state.fate.heat) { state.fate.heat.nudgeSent = true; for (const n of state.fate.heat.notes) if (n.kind === 'once') n.sent = true; }   // подсказка и записи «на один ход» ушли с этим ответом
      persist(state);
      refreshPrompt();
      notify();
    } catch (error) { report('снятие секретного письма', error); }
  });
  on('MESSAGE_DELETED', () => {
    try {
      if (!hasChat()) return;
      const state = readState();
      if (state.fate.check && state.fate.check.at >= chatLength()) { state.fate.check = null; persist(state); }
      if (trimTimeline(state, chatLength())) persist(state);          // удалили ответ: время откатилось
      refreshPrompt();
      notify();
    } catch (error) { report('откат времени', error); }
  });

  refreshPrompt();

  const api = {
    get, skip, setTime, setPlace, setDayNumber, setCalendar, setLayers, setSetting, refreshPrompt, setWeather, rerollWeather, setClimate, setTension, setLetter, clearLetter, previewKulisy, importFromKulisy,
    addQuest, setQuestStatus, setQuestText, toggleTrack, removeQuest, addLead, setLeadState, setLeadNote, removeLead, addEntry, removeEntry, markQuestSeen, previewKulisyQuests, importQuestsFromKulisy,
    setPersona, clearPersonaLock, setAliases, syncPersona, switchPersona, keepPersona,
    syncLoreSecrets, applyKnowledgeChange, applyMoment, applyJournalChange,
    addPlace, updatePlace, restoreMapNesting, removePlace, placeText, togglePlaceCard, enableAllPlaceCards, setCurrentPlace, applyPlaceChange, previewKulisyMap, importMapFromKulisy, previewPlaceFile, importPlaceFile, syncMainPeople, bindPersonaByName, startStory, togglePlaceFlag, addPlaceLink, removePlaceLink, setLoreWhen, toggleLore,
    toggleOutfitItem, saveOutfit, wearOutfit, setArousal, applyBodyChange, addItem, updateItem, removeItem, giveItem, applyItemChange, addGear, updateGear, setItemKind, wearItem, unwearItem, setMood, applyWearChange,
    attachCard, attachCards, detachCard, updateEntered,
    applyRelChange, applyCastChange, applyNewPerson, bumpSeen, revertLog, revertAt, revertFrom,
    addHeadcanon, toggleHeadcanon, removeHeadcanon, addLine, removeLine, setScale, toggleScaleHidden, setStage, setGoal, addRecord, removeRecord, toggleRecord, addFactor, removeFactor, addPerson, addTriangle, toggleTriangle, removeTriangle, previewKulisyRelations, importRelationsFromKulisy,
    addFact, updateFact, removeFact, toggleWitness, setLearned, setAcquaintance, setDeath, clearDeath, previewKulisyKnowledge, importKnowledgeFromKulisy,
    assignCheck, clearCheck, rollCheck, setMode, setModeSet, pressNudge, rollFate, clearEvent, applyHarm, setHeat, endIntimacy, addHeatNote, toggleHeatNote, removeHeatNote,
    seedCast, addCast, removeCast, removePersonFromChat, mergePersons, setPresent, setTier, addWound, toggleBandage, removeWound, addCondition, removeCondition,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  deps.shared.scene = api;
  return () => {
    for (const fn of undo.reverse()) { try { fn(); } catch (error) { report('откат сервиса', error); } }
    try {
      ctx().setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, settings.depth, false, ROLE_SYSTEM);
      ctx().setExtensionPrompt(LETTER_KEY, '', IN_CHAT, 0, false, ROLE_SYSTEM);
    } catch (error) { report('снятие блока', error); }
    listeners.clear();
    delete deps.shared.scene;
  };
}
