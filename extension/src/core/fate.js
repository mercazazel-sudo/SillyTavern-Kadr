/**
 * d20 жизни: режим сцены, одноразовые подсказки рассказчику, случайные события против «Мэри Сью» и близость
 * (лесенка стадий и кубик направления, перенесены из Кулис).
 *
 * Режимы без порядка и очков: подсказка рассказчику и включатель инструментов.
 *   Два набора режимов: приключенческий (Приключение, Город, Лагерь, Бой) и «обычная жизнь» (Дом, Работа, Отдых, Драка); Интим в обоих.
 *   Режим держится, пока его не сменят. Бой (Драка) и Близость главнее остальных.
 *   Привал: только кнопка (одноразовая подсказка), режимом не бывает. Лагерь: и кнопка, и режим.
 * Всё хранится в данных чата (state.fate); отправка рассказчику одноразовая: подсказка уходит с ближайшим ответом и гасится.
 * Чистая логика: случайность передаётся снаружи.
 */
export const MODES = Object.freeze([
  { id: 'path', ru: 'Приключение', icon: '🥾', hint: 'дорога, местность, мелкие встречи, приключения', rule: 'travel: the party is on the road; show distance, terrain, weather and small encounters; time passes between events; do not skip the journey in one sentence.' },
  { id: 'stop', ru: 'Город', icon: '🏰', hint: 'город, поселение, таверна', rule: 'stop in a settlement: people, trade, local talk, lodging; the place lives around the party and reacts to them.' },
  { id: 'camp', ru: 'Лагерь', icon: '🏕', hint: 'долгий отдых, ночь, разговоры у огня', rule: 'camp for the night: watches, a fire, quiet talk, companions open up or withdraw; time passes toward morning; wounds and tiredness are felt.' },
  { id: 'home', ru: 'Дом', icon: '🏠', hint: 'дом, квартира, свои стены', rule: 'at home: the quiet of a lived-in place, small domestic things, privacy; people drop their guard here; time passes in ordinary routines and talk.' },
  { id: 'work', ru: 'Работа', icon: '💼', hint: 'работа, учёба, дела', rule: 'at work: duties, colleagues, schedules and small pressures; people keep a professional face; business interrupts private talk.' },
  { id: 'leisure', ru: 'Отдых', icon: '☕', hint: 'прогулка, встреча, кафе, развлечения', rule: 'leisure: a walk, a meeting, a cafe, an outing; a relaxed pace, small talk and shared moments; the surroundings add colour.' },
  { id: 'fight', ru: 'Бой', icon: '⚔', hint: 'схватка, один обмен за раз', rule: 'combat: keep it tense and physical, one exchange at a time; do not resolve the whole fight in a single reply; the enemy acts with purpose; every hit has a cost.' },
  { id: 'intimacy', ru: 'Интим', icon: '💕', hint: 'накал сцены и свои записи', rule: 'an intimate scene: follow the intimacy stage; no skipping ahead.' },
]);
export const MODE_IDS = MODES.map(m => m.id);
/** Наборы режимов: приключенческий и «обычная жизнь». Бой и Интим есть в обоих, в обычной жизни бой называется «Драка». */
export const MODE_SETS = Object.freeze({
  adventure: { ru: 'Приключение', modes: ['path', 'stop', 'camp', 'fight', 'intimacy'], nudges: ['rest', 'camp', 'travel'] },
  daily: { ru: 'Обычная жизнь', modes: ['home', 'work', 'leisure', 'fight', 'intimacy'], nudges: ['break', 'homeward', 'out'] },
});
export const SET_IDS = Object.freeze(Object.keys(MODE_SETS));
const DAILY_FIGHT = Object.freeze({ ru: 'Драка', icon: '👊', hint: 'драка, один обмен за раз', rule: 'a fight between people: short, messy and physical, one exchange at a time; no weapons unless the story already has them; do not settle it in a single reply; every blow has a cost and onlookers react.' });
/** Режимы набора в порядке показа; Бой в обычной жизни это Драка. */
export const modesOf = setId => (MODE_SETS[setId] ?? MODE_SETS.adventure).modes.map(id => {
  const m = MODES.find(x => x.id === id);
  return setId === 'daily' && id === 'fight' ? { ...m, ...DAILY_FIGHT } : m;
});
/** Главные режимы: Бой и Близость. Лагерь, Город и Приключение им уступают и сами их не вытесняют. */
export const HIGH_MODES = Object.freeze(['fight', 'intimacy']);
export const LOW_MODES = Object.freeze(['path', 'stop', 'camp', 'home', 'work', 'leisure']);

/** Одноразовые кнопки: подсказка рассказчику; персону к решению не принуждают. */
export const NUDGES = Object.freeze({
  rest: { ru: 'Привал', mode: '', text: 'the companions feel the strain and propose a short rest (about an hour) to catch breath and tend wounds; they bring it up themselves, in their own manner; the player character is not forced and may decline' },
  camp: { ru: 'Лагерь', mode: 'camp', text: 'the companions suggest making camp for the night; they bring it up themselves, each in their own manner; the player character is not forced and may decline' },
  break: { ru: 'Перерыв', mode: '', text: 'someone in the scene feels the strain and suggests a short break to breathe, eat or step outside; they bring it up themselves, in their own manner; the player character is not forced and may decline' },
  homeward: { ru: 'Домой', mode: 'home', text: 'someone suggests calling it a day and heading home; they say it themselves, in their own manner; the player character is not forced and may decline' },
  out: { ru: 'Выйти', mode: 'leisure', text: 'someone suggests going out somewhere to unwind; they propose it themselves, in their own manner; the player character is not forced and may decline' },
  travel: { ru: 'В путь', mode: 'path', text: 'the companions are ready to move on and nudge the party back onto the road; they say so themselves; the player character is not forced and may decline' },
});

/** Таблицы случайных событий по режимам. tag: danger (бьёт), boon (помогает), social, odd. w: вес, harm: возможная рана. */
const E = (id, ru, en, tag, w = 1, harm = null) => ({ id, ru, en, tag, w, harm });
export const TABLES = Object.freeze({
  path: [
    E('tracks', 'Свежие следы на дороге', 'fresh tracks cross the road, someone or something passed recently', 'odd', 2),
    E('trader', 'Попутный торговец', 'a wandering trader appears with news, wares and a price', 'boon', 2),
    E('ambush', 'Засада', 'a small ambush springs from cover; it is not a trap that cannot be survived, but it hurts', 'danger', 2, { t: 'удар в засаде', sev: 1 }),
    E('weather', 'Погода портится', 'the weather turns hard and forces the party to adapt', 'odd', 2),
    E('trouble', 'Беда у дороги', 'someone in trouble by the roadside: a wounded traveler, a broken cart', 'social', 2),
    E('ruin', 'Находка', 'an old ruin or a strange object appears off the road', 'odd', 1),
    E('fall', 'Трудный участок', 'the path turns treacherous: a slide, a ford, a bad slope; someone gets hurt', 'danger', 1, { t: 'ушиб при переходе', sev: 1 }),
  ],
  stop: [
    E('rumor', 'Слух в таверне', 'a rumour is overheard that touches the party or their goal', 'social', 3),
    E('brawl', 'Потасовка', 'a brawl breaks out nearby and the party is pulled in or must choose', 'danger', 2, { t: 'синяк после потасовки', sev: 1 }),
    E('stranger', 'Незнакомец с делом', 'a stranger approaches with an offer or a request', 'social', 3),
    E('thief', 'Воришка', 'a pickpocket tries someone; the party notices late', 'odd', 2),
    E('guard', 'Внимание стражи', 'the local watch takes interest in the party', 'odd', 1),
    E('feast', 'Праздник или торг', 'the town is busy with a fair or a feast that changes the mood', 'boon', 1),
  ],
  camp: [
    E('nightsound', 'Шорох в ночи', 'something stirs beyond the firelight during a watch', 'odd', 3),
    E('nightmare', 'Тревожный сон', 'a bad dream disturbs one of the party; they wake shaken', 'odd', 3),
    E('visitor', 'Ночной гость', 'a visitor approaches the camp: friend, wanderer or something worse', 'social', 2),
    E('raid', 'Налёт на лагерь', 'a short night attack on the camp; the watch must react', 'danger', 1, { t: 'рана в ночной стычке', sev: 1 }),
    E('talk', 'Откровенный разговор', 'a companion starts a candid talk by the fire that was not planned', 'boon', 3),
    E('lost', 'Пропажа', 'something small is missing from the camp by morning', 'odd', 1),
  ],
  fight: [
    E('reinforce', 'Подкрепление врага', 'the enemy gets reinforcement or a hidden helper joins', 'danger', 2),
    E('terrain', 'Местность вмешалась', 'the terrain interferes: slippery floor, falling debris, smoke', 'odd', 2),
    E('hit', 'Тяжёлое попадание', 'an enemy lands a hard hit on someone who was careless or exposed', 'danger', 3, { t: 'тяжёлое попадание в бою', sev: 2 }),
    E('graze', 'Скользящий удар', 'a glancing blow finds someone', 'danger', 3, { t: 'порез в бою', sev: 1 }),
    E('opening', 'Просвет', 'an opening appears: the enemy stumbles, a way out or a weak spot shows', 'boon', 2),
    E('flee', 'Колебание врага', 'one of the enemies hesitates, wavers or tries to flee', 'social', 1),
  ],
  home: [
    E('visitor', 'Гость на пороге', 'someone unexpected knocks or calls: a neighbour, a relative, a courier with a parcel', 'social', 3),
    E('breakage', 'Что-то сломалось', 'something small at home breaks or stops working and asks for attention', 'odd', 2),
    E('message', 'Сообщение', 'a message or a call arrives that touches someone in the scene', 'social', 2),
    E('keepsake', 'Находка в вещах', 'an old thing turns up and stirs a memory or a question', 'boon', 2),
    E('wallnoise', 'Шум за стеной', 'a noise from the neighbours or the street breaks the quiet', 'odd', 2),
    E('cosy', 'Тихий уют', 'an unplanned small kindness or comfort warms the evening', 'boon', 2),
  ],
  work: [
    E('summons', 'Вызов к начальству', 'someone is called in unexpectedly by the boss or a client', 'social', 2),
    E('deadline', 'Горит срок', 'a deadline suddenly tightens and the pace picks up', 'odd', 3),
    E('colleague', 'Разговор с коллегой', 'a colleague draws someone into a talk that is not about work', 'social', 3),
    E('slip', 'Ошибка в деле', 'a small mistake surfaces and someone has to answer for it', 'odd', 2),
    E('chance', 'Удачный случай', 'a lucky break or a useful contact appears', 'boon', 2),
    E('gossip', 'Слух в коллективе', 'office gossip reaches the scene and touches someone', 'social', 2),
  ],
  leisure: [
    E('meeting', 'Случайная встреча', 'an old acquaintance or an interesting stranger crosses their path', 'social', 3),
    E('weatherturn', 'Погода меняет планы', 'the weather turns and the plans have to change', 'odd', 2),
    E('crowd', 'Толпа и суета', 'a crowd or a queue gets in the way and tests patience', 'odd', 2),
    E('treat', 'Приятная мелочь', 'a pleasant small surprise: a good table, a street musician, a free treat', 'boon', 3),
    E('misplaced', 'Пропала вещь', 'something small goes missing and has to be looked for', 'odd', 1),
    E('pushy', 'Навязчивая компания', 'a pushy or drunk stranger bothers the group; it need not escalate', 'danger', 1, { t: 'ушиб в давке', sev: 1 }),
  ],
  brawl: [
    E('friends', 'Вмешались свои', 'bystanders or friends step in and try to pull the fighters apart', 'social', 2),
    E('punch', 'Крепкий удар', 'a hard punch lands on someone careless or exposed', 'danger', 3, { t: 'удар в драке', sev: 1 }),
    E('floored', 'Сбит с ног', 'someone is knocked down and loses a moment', 'danger', 2, { t: 'ушиб при падении', sev: 1 }),
    E('authority', 'Свистки и шаги', 'sounds of authority approaching force everyone to decide fast', 'odd', 2),
    E('backoff', 'Остыли', 'one of the fighters hesitates or backs off, shame or fear showing', 'social', 1),
    E('object', 'Что-то под рукой', 'someone grabs a nearby object: a bottle, a chair', 'danger', 1, { t: 'удар предметом', sev: 1 }),
  ],
  intimacy: [
    E('noise', 'Шум рядом', 'a sound nearby makes both of them freeze for a moment', 'odd', 2),
    E('clumsy', 'Неловкость', 'an awkward, human moment that breaks the tension and makes it warmer', 'boon', 3),
    E('interrupt', 'Вмешательство', 'someone or something interrupts, without necessarily ruining the moment', 'social', 1),
  ],
  generic: [
    E('news', 'Новости издалека', 'news reaches the party from outside the scene', 'social', 2),
    E('twist', 'Мелкая неприятность', 'a small complication appears that asks for a decision', 'odd', 3),
    E('luck', 'Мелкая удача', 'a small piece of luck helps the party, not decisively', 'boon', 2),
  ],
});
const TAG_RU = Object.freeze({ danger: 'опасность', boon: 'удача', social: 'встреча', odd: 'странность' });
export const tagRu = tag => TAG_RU[tag] ?? tag;

/** Вес записи: напряжение (0..4) усиливает опасность и приглушает удачу. */
const weightOf = (entry, tension, lethalOff) => {
  const t = Math.max(0, Math.min(4, Number(tension) || 0));
  let w = entry.w;
  if (entry.tag === 'danger') w *= 1 + t * 0.45;
  if (entry.tag === 'boon') w *= Math.max(0.35, 1 - t * 0.15);
  if (entry.tag === 'odd' && t === 0) w *= 1.1;
  return w;
};

/**
 * Бросок события. modeId: текущий режим (нет режима: общая таблица), tension 0..4, present: [{ id, name, persona }],
 * includePersona: можно ли задеть персону, lethal: тяжёлая и смертельная рана допустимы.
 * Возвращает { id, tag, ru, en, target?, harm? } или null, если нечего бросать. Рану только предлагает: записывает человек.
 */
export function rollEvent({ modeId = '', tension = 0, present = [], includePersona = true, lethal = false, random = Math.random, zones = [] } = {}) {
  const table = TABLES[modeId] ?? TABLES.generic;
  const weights = table.map(e => weightOf(e, tension));
  let at = random() * weights.reduce((s, w) => s + w, 0);
  let entry = table.at(-1);
  for (let i = 0; i < table.length; i++) { at -= weights[i]; if (at < 0) { entry = table[i]; break; } }
  const out = { id: entry.id, tag: entry.tag, ru: entry.ru, en: entry.en };
  if (entry.harm) {
    const pool = present.filter(p => includePersona || !p.persona);
    if (pool.length) {
      const target = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
      const sev = lethal ? entry.harm.sev : Math.min(entry.harm.sev, 2);
      const zone = zones.length ? zones[Math.min(zones.length - 1, Math.floor(random() * zones.length))] : 'chest';
      out.target = { id: target.id, name: target.name, persona: Boolean(target.persona) };
      out.harm = { t: entry.harm.t, sev, zone };
    }
  }
  return out;
}

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- накал близости ----------
/** Пять зон накала сцены: рассказчик пишет на уровне текущей зоны и сам вверх не перескакивает. */
export const HEAT = Object.freeze([
  { id: 'warm', ru: 'Тепло', hint: 'взгляды, близость', rule: 'warmth only: glances, pauses, nearness, light touches, clothes stay on; stop before a kiss and hand the turn over' },
  { id: 'hot', ru: 'Жар', hint: 'ласки, поцелуи', rule: 'kisses and caresses, clothes loosening; do not go further on your own, hand the turn over before the act' },
  { id: 'passion', ru: 'Страсть', hint: 'сама близость', rule: 'the act itself at an unhurried pace, sensory and true to the characters; do not rush toward the end and do not wrap it up' },
  { id: 'peak', ru: 'Пик', hint: 'разрядка', rule: 'the climax of the scene, brief and true to the characters, then let it settle; do not start a new round on your own' },
  { id: 'calm', ru: 'Покой', hint: 'после', rule: 'the quiet afterwards: breath, warmth, a few words; no new round unless the player begins one' },
]);
export const HEAT_IDS = Object.freeze(HEAT.map(z => z.id));
/** Прежние стадии лесенки, которые могут лежать в старых чатах, переезжают на ближайшую зону. */
const LEGACY_STAGE = { spark: 'warm', touch: 'warm', kiss: 'hot', undress: 'hot', act: 'passion', after: 'calm' };
/** Подсказка на ход: одноразовая, уходит рассказчику с ближайшим ответом. */
export const HEAT_NUDGES = Object.freeze([
  { id: 'softer', ru: 'нежнее', en: 'softer and more tender' },
  { id: 'slower', ru: 'медленнее', en: 'slower, savour each moment' },
  { id: 'bolder', ru: 'смелее', en: 'bolder' },
  { id: 'quieter', ru: 'тише', en: 'quieter, more restrained' },
  { id: 'playful', ru: 'с шуткой', en: 'with some humour and play' },
]);
/** Вид близости: что выбрали играющие (можно несколько). Рассказчик пишет только выбранное и не выходит за зону накала. */
export const HEAT_ACTS = Object.freeze([
  { id: 'petting', ru: 'Петтинг', hint: 'руки на интимных местах, без проникновения и без орального', en: 'hands on intimate areas, clothed or not; no penetration, no oral' },
  { id: 'vaginal', ru: 'Вагинальный', hint: 'вагинальный', en: 'vaginal intercourse' },
  { id: 'oral', ru: 'Оральный', hint: 'оральные ласки', en: 'oral play' },
  { id: 'anal', ru: 'Анальный', hint: 'анальный', en: 'anal intercourse' },
  { id: 'masturbation', ru: 'Мастурбация', hint: 'самоласки одного из героев или друг перед другом', en: 'self-pleasure, by one character or in front of each other' },
  { id: 'fingering', ru: 'Фингеринг', hint: 'пальцами, с проникновением', en: 'fingers inside, manual penetration', more: true },
  { id: 'frottage', ru: 'Фроттаж', hint: 'тесно прижавшись, трение друг о друга', en: 'pressed close, rubbing against each other', more: true },
  { id: 'intercrural', ru: 'Интеркруральный коитус', hint: 'между бёдер, без проникновения', en: 'between the thighs, no penetration', more: true },
  { id: 'mammary', ru: 'Маммарный секс', hint: 'между грудей', en: 'between the breasts', more: true },
]);
export const HEAT_ACT_IDS = Object.freeze(HEAT_ACTS.map(a => a.id));
export const HEAT_NOTE_KINDS = Object.freeze(['scene', 'once', 'limit']);
export const HEAT_NOTE_RU = Object.freeze({ scene: 'вся сцена', once: 'один ход', limit: 'граница' });
const HEAT_LIMITS = Object.freeze({ notes: 14, text: 200 });

/** Накал из сырых данных чата; пустое значение: накала нет. Старая «лесенка» (stage) переносится на ближайшую зону. */
export function normalizeHeat(raw, legacyStage = null) {
  const src = raw && typeof raw === 'object' ? raw : null;
  const zone = HEAT_IDS.includes(src?.zone) ? src.zone : LEGACY_STAGE[legacyStage?.stage] ?? '';
  if (!zone) return null;
  const notes = [];
  for (const n of Array.isArray(src?.notes) ? src.notes : []) {
    const text = clip(n?.text, HEAT_LIMITS.text);
    if (!text || notes.length >= HEAT_LIMITS.notes) continue;
    notes.push({ id: clip(n.id, 24) || `n${notes.length + 1}`, text, kind: HEAT_NOTE_KINDS.includes(n.kind) ? n.kind : 'scene', on: n.on !== false, sent: n.sent === true });
  }
  const oldNote = clip(legacyStage?.note, HEAT_LIMITS.text);
  if (!src && oldNote) notes.push({ id: 'n1', text: oldNote, kind: 'scene', on: true, sent: true });
  return {
    zone,
    lead: clip(src?.lead, 64) || 'story',
    nudge: HEAT_NUDGES.some(x => x.id === src?.nudge) ? src.nudge : '',
    nudgeSent: src?.nudgeSent !== false,
    acts: [...new Set(Array.isArray(src?.acts) ? src.acts.filter(id => HEAT_ACT_IDS.includes(id)) : [])],
    notes,
  };
}
/** Новое состояние накала после действия: { zone } поставить зону, { delta } сдвинуть, { lead }, { nudge }, { clear } снять. null снимает накал. */
export function moveHeat(heat, payload = {}) {
  if (payload.clear) return null;
  let h = heat ? { ...heat, notes: heat.notes.map(n => ({ ...n })) } : null;
  if (payload.zone !== undefined || payload.delta !== undefined || !h) {
    const at = HEAT_IDS.indexOf(h?.zone);
    let next = at;
    if (HEAT_IDS.includes(payload.zone)) next = HEAT_IDS.indexOf(payload.zone);
    else if (!h) next = 0;                                                          // первый шаг из ничего: первая зона, куда бы ни вёл сдвиг
    else if (payload.delta) next = Math.min(Math.max(at + Math.sign(payload.delta), 0), HEAT_IDS.length - 1);
    if (next < 0) return h;
    h = h ?? { zone: HEAT_IDS[next], lead: 'story', nudge: '', nudgeSent: true, acts: [], notes: [] };
    h.zone = HEAT_IDS[next];
  }
  if (payload.lead !== undefined) h.lead = clip(payload.lead, 64) || 'story';
  if (payload.act !== undefined && HEAT_ACT_IDS.includes(payload.act)) {
    const set = new Set(h.acts ?? []);
    if (set.has(payload.act)) set.delete(payload.act); else set.add(payload.act);
    h.acts = HEAT_ACT_IDS.filter(id => set.has(id));
  }
  if (payload.nudge !== undefined) { h.nudge = HEAT_NUDGES.some(x => x.id === payload.nudge) ? payload.nudge : ''; h.nudgeSent = !h.nudge; }
  return h;
}
/** Строки накала для рассказчика. names: { id → имя } для ведущего. Одноразовое (подсказка, записи «на один ход») уходит, пока не отмечено отправленным. */
export function heatLines(heat, names = {}) {
  if (!heat) return [];
  const z = HEAT.find(x => x.id === heat.zone);
  if (!z) return [];
  const lines = [`intimate scene, heat: ${z.id} (${HEAT_IDS.indexOf(z.id) + 1}/${HEAT.length}): ${z.rule}; keep to this level and never jump to a higher one on your own`];
  if (heat.lead === 'turns') lines.push('initiative alternates between the characters');
  else if (heat.lead && heat.lead !== 'story') lines.push(`${names[heat.lead] ?? 'one character'} takes the lead`);
  const acts = HEAT_ACTS.filter(a => (heat.acts ?? []).includes(a.id)).map(a => a.en);
  if (acts.length) lines.push(`kind of intimacy chosen by the players (stay inside it and inside the heat level): ${acts.join('; ')}`);
  const nudge = HEAT_NUDGES.find(x => x.id === heat.nudge);
  if (nudge && !heat.nudgeSent) lines.push(`nudge for this turn: ${nudge.en}`);
  const on = heat.notes.filter(n => n.on);
  const keep = on.filter(n => n.kind === 'scene').map(n => n.text);
  const limits = on.filter(n => n.kind === 'limit').map(n => n.text);
  const once = on.filter(n => n.kind === 'once' && !n.sent).map(n => n.text);
  if (keep.length) lines.push(`notes: ${keep.join('; ')}`);
  if (limits.length) lines.push(`limits (always honour): ${limits.join('; ')}`);
  if (once.length) lines.push(`this turn only: ${once.join('; ')}`);
  return lines;
}
/** Есть ли в накале то, что ещё не ушло рассказчику. */
export const heatPending = heat => Boolean(heat && ((heat.nudge && !heat.nudgeSent) || heat.notes.some(n => n.on && n.kind === 'once' && !n.sent)));

// ---------- состояние ----------
export const emptyFate = () => ({ set: 'adventure', mode: '', auto: false, back: null, check: null, heat: null, event: null });

export function normalizeFate(raw) {
  const base = emptyFate();
  if (!raw || typeof raw !== 'object') return base;
  let event = null;
  if (raw.event && typeof raw.event === 'object' && clip(raw.event.text, 600)) {
    event = { kind: ['roll', 'nudge'].includes(raw.event.kind) ? raw.event.kind : 'roll', label: clip(raw.event.label, 200), text: clip(raw.event.text, 600), sent: raw.event.sent === true };
    if (raw.event.target && typeof raw.event.target === 'object') event.target = { id: clip(raw.event.target.id, 64), name: clip(raw.event.target.name, 80), persona: raw.event.target.persona === true };
    const h = raw.event.harm;
    if (h && typeof h === 'object' && clip(h.t, 120)) event.harm = { t: clip(h.t, 120), sev: Math.min(Math.max(Math.trunc(Number(h.sev)) || 1, 1), 3), zone: clip(h.zone, 12) || 'chest', done: h.done === true };
  }
  let check = null;
  if (raw.check && typeof raw.check === 'object' && Number.isFinite(Number(raw.check.dc))) {
    const c = raw.check;
    check = { id: clip(c.id, 24) || 'chk', kind: CHECK_KINDS.includes(c.kind) ? c.kind : 'dodge', label: clip(c.label, 80) || (c.kind === 'skill' ? 'попытка' : 'атака'), dc: Math.min(Math.max(Math.trunc(Number(c.dc)), 1), 20), mode: CHECK_MODES.includes(c.mode) ? c.mode : 'normal', at: Math.max(0, Math.trunc(Number(c.at)) || 0), roll: null };
    const r = c.roll;
    if (r && typeof r === 'object' && Array.isArray(r.dice) && Number.isFinite(Number(r.roll)) && OUTCOMES.includes(r.outcome)) check.roll = { dice: r.dice.map(n => Math.min(Math.max(Math.trunc(Number(n)) || 1, 1), 20)).slice(0, 2), roll: Math.min(Math.max(Math.trunc(Number(r.roll)), 1), 20), outcome: r.outcome, sev: Math.min(Math.max(Math.trunc(Number(r.sev)) || 0, 0), 3) };
  }
  return {
    set: SET_IDS.includes(raw.set) ? raw.set : 'adventure', mode: MODE_IDS.includes(raw.mode) ? raw.mode : '', check, auto: raw.auto === true && MODE_IDS.includes(raw.mode), back: raw.back && LOW_MODES.includes(raw.back.mode) ? { mode: raw.back.mode, auto: raw.back.auto === true } : null, heat: normalizeHeat(raw.heat, raw.stage), event,
  };
}

export const FATE_RULE = 'scene mode is the current kind of scene, let it colour pacing and detail; a "fate event" is a one-time complication or chance: weave it in naturally in this reply, in the world\'s own terms, without announcing it, and do not repeat it later; a harm in a fate event is only a suggestion of what may happen, the story decides how; dice details (kind, pace, setting, mood) are a direction for the intimate scene, adapt them to where the scene is and write only your own characters, never the user\'s character; companions\' suggestions (rest, camp, road) come from the companions, never force the user\'s character';

/** Строки для блока рассказчика. Одноразовое (событие, кубик) уходит, пока не помечено отправленным. */
export function fateLines(fate, { diceCheck = false, names = {} } = {}) {
  const lines = [];
  const mode = MODES.find(m => m.id === fate.mode);
  if (mode) lines.push(`scene mode: ${mode.id} — ${mode.rule}`);
  const heat = heatLines(fate.heat, names);
  if (heat.length) lines.push(...heat);
  else if (fate.mode === 'intimacy') lines.push('intimate scene: follow the story\'s own pace; heat is not set');
  if (fate.event && !fate.event.sent) lines.push(`${fate.event.kind === 'nudge' ? 'companions' : 'fate event'}: ${fate.event.text}${fate.event.harm ? ` (possible harm: ${fate.event.harm.t}${fate.event.target ? ` to ${fate.event.target.name}` : ''})` : ''}`);
  if (diceCheck && !heat.length && fate.mode !== 'intimacy') lines.push(CHECK_INSTRUCTION);
  return lines;
}


// ---------- режим сцены сам: по месту и словам рассказа ----------
const lastSegment = place => String(place ?? '').split('›').map(s => s.trim()).filter(Boolean).pop() ?? '';
const CAMP_PLACE = /лагер|палатк|привал|бивак|ночлег|стоянк/iu;
/** Чужой лагерь или поселение («Лагерь гоблинов», «гоблинский лагерь»): это место, а не привал отряда. */
const FOREIGN_CAMP = /лагер\p{L}*\s+(?!отряда|привала|путников|героев|на\s|у\s|для\s)\p{L}{3,}|\p{L}*(?:ск|цк)(?:ий|ого|ом|ая|ой|ие|их)\s+(?:лагер|стоянк)/iu;
const STRONG_CAMP_TEXT = /разбил\p{L}*\s+лагер|у\s+догорающ\p{L}*\s+костр|привал/iu;
const CAMP_TEXT = /(?:в|у|возле|около|вокруг|внутри|из)\s+(?:общего\s+|своего\s+|их\s+)?(?:лагер\p{L}*|палатк\p{L}*|костр\p{L}*)|разбил\p{L}*\s+лагер|у\s+догорающ\p{L}*\s+костр|привал/iu;
const LEAVE_CAMP = /(?:свернул\p{L}*|собрал\p{L}*|покинул\p{L}*|оставил\p{L}*|вышл\p{L}*|снял\p{L}*)\s+(?:из\s+)?(?:лагер|палатк)|двинул\p{L}*\s+в\s+путь|выступил\p{L}*|отправил\p{L}*\s+в\s+путь|в\s+путь\b/iu;
const PATH_TEXT = /(?:шли|идут|идёт|шёл|шел|ехали|едут|двинул\p{L}*|направил\p{L}*)\s+(?:по\s+)?(?:дорог\p{L}*|тропе|тропинке|тракту|лес\p{L}*|горн\p{L}*)|в\s+пути|по\s+дороге/iu;
const STOP_TEXT = /(?:вошл\p{L}*|добрал\p{L}*|прибыл\p{L}*|пришл\p{L}*|зашл\p{L}*)\s+(?:в|к|на)\s+(?:дерев\p{L}*|город\p{L}*|таверн\p{L}*|поселк\p{L}*|посёлк\p{L}*|порт\p{L}*|харчевн\p{L}*|рынок|рынк\p{L}*|площад\p{L}*)|в\s+таверне|на\s+рынке|на\s+площади/iu;
/**
 * Какой режим выставить сам. Режимы двух ступеней: главные (Бой, Близость) и обычные (Приключение, Город, Лагерь).
 *  - Бой (в тексте боевое действие: detectCombat) главнее любого обычного режима, даже выбранного вручную; то, что было, запоминается в back и возвращается, когда бой остыл.
 *  - Бой и Близость никогда не вытесняются автоматикой слов про лагерь, город и дорогу; Близость автоматикой не включается (её ставит лесенка или кубик).
 *  - Обычные режимы определяются по месту и словам рассказа; режим, выбранный вручную, они не трогают.
 * Приоритет внутри обычных: Лагерь, Город (вошли в деревню, таверну), Приключение (идут по дороге). Лагерь держится, пока рассказ не скажет, что его свернули.
 * Возвращает { mode, auto, back } или null, если менять нечего.
 */
export function detectAutoMode({ text = '', place = '', level = 0, combat = false, mode = '', auto = false, back = null } = {}) {
  if (combat) {                                              // бой включают только боевые действия в тексте, не крики и не напряжение само по себе
    if (HIGH_MODES.includes(mode)) return null;
    return { mode: 'fight', auto: true, back: mode ? { mode, auto } : back };
  }
  if (mode === 'fight' && auto && level <= 1) return back ? { mode: back.mode, auto: back.auto, back: null } : { mode: '', auto: false, back: null };
  if (HIGH_MODES.includes(mode)) return null;
  if (mode && !auto) return null;
  const leaving = LEAVE_CAMP.test(text);
  const seg = lastSegment(place);
  const foreign = FOREIGN_CAMP.test(seg);                   // чужой лагерь в названии места: режим «Лагерь» не включается
  const campPlace = CAMP_PLACE.test(seg) && !foreign;
  // слова «в лагере», «у костра» считаются, только если место не названо или это наш лагерь; «разбили лагерь» и «привал» работают везде
  const campText = STRONG_CAMP_TEXT.test(text) || (!seg || campPlace) && CAMP_TEXT.test(text);
  let want = '';
  if ((campPlace || campText) && !leaving) want = 'camp';
  else if (STOP_TEXT.test(text)) want = 'stop';
  else if (PATH_TEXT.test(text) && (!campPlace || leaving)) want = 'path';
  if (want) return want === mode ? null : { mode: want, auto: true, back };
  if (!auto || !mode) return null;
  if (mode === 'camp' && (leaving || foreign || (place && !campPlace && PATH_TEXT.test(text)))) return { mode: '', auto: false, back };
  if (mode === 'stop' && PATH_TEXT.test(text)) return { mode: 'path', auto: true, back };
  return null;
}


// ---------- проверка кубом для персоны (бросок d20 против сложности) ----------
export const CHECK_MODES = Object.freeze(['normal', 'advantage', 'disadvantage']);
export const CHECK_MODE_RU = Object.freeze({ normal: 'обычный бросок', advantage: 'с преимуществом', disadvantage: 'с помехой' });
export const OUTCOME_RU = Object.freeze({ dodge: 'уворот удался', hit: 'ранен', 'crit-hit': 'тяжело ранен', 'crit-dodge': 'идеальный уворот', success: 'удалось', fail: 'не удалось', 'crit-success': 'блестяще удалось', 'crit-fail': 'провал' });
/** Все исходы броска: уворот и попытка. */
export const OUTCOMES = Object.freeze(Object.keys(OUTCOME_RU));
/** Что рассказчику велено делать: довести сцену до удара и закончить строкой с порогом сложности. */
export const CHECK_INSTRUCTION = 'd20 check: when luck should decide an outcome for the player character, write the scene up to the moment of decision and END the reply with exactly one line [[КУБ: <what is at stake, 2-5 words> | сложность <1-20> | <обычно|преимущество|помеха> | <уворот|действие>]], then stop: never narrate whether it works or how the player character reacts. Use "уворот" when an attack or danger targets the character (a failure means a wound); use "действие" when the character tries something uncertain (deceive, persuade, sneak, spot, climb, force, resist a spell) and a failure only means it goes wrong. Call a check only when the stakes matter and the result is truly open, at most once in several replies, never when the story already decided the outcome and never in an intimate scene. Difficulty 8 easy, 12 moderate, 16 hard, 19 near-impossible; advantage when the character has the edge (cover, surprise, skill, preparation), disadvantage when hindered (wounded, off-balance, surrounded, rushed); the result arrives next as a "dice result" line: narrate exactly that outcome';
const CHECK_RE = /\[\[\s*(?:КУБ|CUBE|DICE)\s*:([^\]]*)\]\]/iu;
/** Вид проверки: dodge это опасность (при провале рана), skill это попытка (обман, убеждение, скрытность…), при провале просто неудача. */
export const CHECK_KINDS = Object.freeze(['dodge', 'skill']);
/** Строка проверки из ответа рассказчика → { label, dc (1..20), mode, kind } или null. Без вида в строке это уворот (прежний формат). */
export function parseCheck(text) {
  const m = CHECK_RE.exec(String(text ?? ''));
  if (!m) return null;
  const parts = m[1].split('|').map(s => s.trim());
  const dcMatch = /(?:сложность|порог|DC)\s*:?\s*(\d{1,2})/iu.exec(parts[1] ?? '');
  if (!dcMatch) return null;
  const rest = parts.slice(2).join(' ').toLowerCase();
  const mode = /преим|advant/.test(rest) ? 'advantage' : /помех|disadv|disad/.test(rest) ? 'disadvantage' : 'normal';
  const kind = /действи|навык|попытк|skill|action/.test(rest) ? 'skill' : 'dodge';
  return { label: clip(parts[0], 80) || (kind === 'skill' ? 'попытка' : 'атака'), dc: Math.min(Math.max(parseInt(dcMatch[1], 10), 1), 20), mode, kind };
}
/**
 * Бросок d20: с преимуществом берётся больший из двух, с помехой меньший. Меньше сложности: ранен; не меньше: уворот.
 * Выпала 1: тяжёлая рана при любой сложности; 20: идеальный уворот. sev: тяжесть раны (0 нет, 1 лёгкая, 2 серьёзная).
 */
export function rollCheck({ dc, mode = 'normal', random = Math.random, dice: given = null, kind = 'dodge' }) {
  const d = () => Math.floor(random() * 20) + 1;
  // dice: уже выпавшие кубики (их показала анимация); берутся, только если подходят режиму: один обычный, два с преимуществом или помехой
  const need = mode === 'normal' ? 1 : 2;
  const ok = Array.isArray(given) && given.length === need && given.every(v => Number.isInteger(v) && v >= 1 && v <= 20);
  const dice = ok ? [...given] : mode === 'normal' ? [d()] : [d(), d()];
  const roll = mode === 'advantage' ? Math.max(...dice) : mode === 'disadvantage' ? Math.min(...dice) : dice[0];
  if (kind === 'skill') {
    const verdict = roll === 1 ? 'crit-fail' : roll === 20 ? 'crit-success' : roll >= dc ? 'success' : 'fail';
    return { dice, roll, outcome: verdict, sev: 0 };
  }
  const outcome = roll === 1 ? 'crit-hit' : roll === 20 ? 'crit-dodge' : roll >= dc ? 'dodge' : 'hit';
  return { dice, roll, outcome, sev: outcome === 'crit-hit' ? 2 : outcome === 'hit' ? 1 : 0 };
}
/** Одноразовая подсказка рассказчику с результатом броска (по-английски, для модели). */
export function checkDirective(check, result) {
  const how = `${check.mode === 'normal' ? 'd20' : `d20 ${check.mode} (${result.dice.join(', ')})`} = ${result.roll} against difficulty ${check.dc}`;
  const text = {
    dodge: 'the player character AVOIDS the attack: narrate the dodge or the miss, the character stays unhurt',
    'crit-dodge': 'natural 20: a flawless dodge, the attack misses badly and the character may gain a brief opening',
    hit: 'the attack LANDS: the player character is hurt (a light wound): narrate the strike and its immediate pain, not the character\'s choices',
    'crit-hit': 'natural 1: critical failure, the attack lands HARD: a serious wound: narrate the strike and its consequences, not the character\'s choices',
    success: 'the attempt SUCCEEDS: narrate it working as the character intended, without extra gifts',
    fail: 'the attempt FAILS: narrate how it goes wrong and the immediate consequence, do not let the character get away with it',
    'crit-success': 'natural 20: the attempt succeeds spectacularly: narrate it working better than hoped, with a small bonus',
    'crit-fail': 'natural 1: the attempt fails badly: narrate it going wrong in a costly or embarrassing way',
  }[result.outcome];
  return `dice result for "${check.label}": ${how}: ${text}`;
}

// ---------- обычная жизнь: режим сам по месту и словам рассказа ----------
const DAILY_PLACES = [
  ['home', /(?<![\p{L}])(?:дом|дома|домик|квартир|комнат|спальн|кухн|гостин|общежити|подъезд|двор)/iu],
  ['work', /(?<![\p{L}])(?:офис|работ|кабинет|школ|класс|универ|институт|лекци|магазин|мастерск|склад|завод|контор|больниц)/iu],
  ['leisure', /(?<![\p{L}])(?:кафе|бар|парк|кино|клуб|пляж|набережн|площадь|ресторан|театр|концерт|музей|прогулк|лес(?![\p{L}]))/iu],
];
const DAILY_TEXT = [
  ['home', /(?:вернул\p{L}*|пришл\p{L}*|зашл\p{L}*)\s+(?:домой|в\s+квартир\p{L}*)|дома(?![\p{L}])/iu],
  ['work', /(?:на\s+работ\p{L}*|в\s+офис\p{L}*|на\s+урок\p{L}*|на\s+пар\p{L}*)/iu],
  ['leisure', /(?:вышл\p{L}*\s+погуля\p{L}*|пошл\p{L}*\s+(?:в\s+кафе|гулять|в\s+кино))/iu],
];
/**
 * Режим обычной жизни сам: Дом, Работа, Отдых по названию места и словам рассказа; Драку включают только боевые действия (combat).
 * Ручной режим не трогается, Драка и Интим главнее остальных. Возвращает { mode, auto, back } или null, если менять нечего.
 */
export function detectDailyMode({ text = '', place = '', level = 0, combat = false, mode = '', auto = false, back = null } = {}) {
  if (combat) {
    if (HIGH_MODES.includes(mode)) return null;
    return { mode: 'fight', auto: true, back: mode ? { mode, auto } : back };
  }
  if (mode === 'fight' && auto && level <= 1) return back ? { mode: back.mode, auto: back.auto, back: null } : { mode: '', auto: false, back: null };
  if (HIGH_MODES.includes(mode)) return null;
  if (mode && !auto) return null;
  const spot = String(place ?? '').split('›').map(s => s.trim()).filter(Boolean).pop() ?? '';
  const byPlace = DAILY_PLACES.find(([, re]) => re.test(spot))?.[0];
  const byText = DAILY_TEXT.find(([, re]) => re.test(String(text ?? '')))?.[0];
  const want = byPlace || byText || '';
  return want && want !== mode ? { mode: want, auto: true, back } : null;
}
