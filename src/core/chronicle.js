/**
 * Архивариус: малые задачи по фильтру вместо одного огромного запроса.
 * Здесь чистая логика: нужна ли задача по ответу, текст запроса, разбор и проверка ответа модели.
 * Модель только предлагает; код проверяет, что квест, зацепка, люди и шкалы существуют, и режет скачки.
 * Предложения применяются только по кнопке «Записать»: так не нужен откат при свайпе.
 */
import { SCALE_IDS, SCALES, UI_SCALES } from './relations.js';
import { FEATURES } from './features.js';
import { isOpenStatus } from './journal.js';
import { applyItemOp, itemsOf, findItem } from './inventory.js';
import { ZONE_IDS, ZONES, MOODS, MOOD_IDS, MOOD_LEVEL_RU, AROUSAL_RU, cleanArousal } from './body.js';
import { findGear, wardrobeOf } from './gear.js';
import { findNode, pathOf } from './places.js';
import { dossier, pairKey } from './secrets.js';
import { findAcrossScripts } from './names.js';

const REPLY_CAP = 4000;
const USER_CAP = 800;
export const MAX_DELTA = 15;

const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
const words = s => norm(s).match(/[\p{L}]{4,}/gu) ?? [];
/** Основа слова для грубого сопоставления падежей: первые 5 букв. */
const stem = w => w.slice(0, 5);

// ---------- фильтры: нужна ли задача, не спрашивая модель ----------
const QUEST_WORDS = /(?:квест|задани|поручени|пообещ|обещани|договор|след[уа]|зацепк|улик|найд[еёия]|нашл[аи]|выяснил|узнал[аи]?|раскрыл|письм[оа]|карт[ауы]|ключ|пропал[аи]?|похитил|разыска|отправ[ие]лс|клятв|контракт|награ|заказ)/iu;

/** Упоминания людей из списка (по имени и псевдониму) в тексте: возвращает id найденных. */
export function mentionedPeople(text, people) {
  const t = norm(text);
  const hit = [];
  for (const p of people) {
    const names = [p.name, ...(p.aliases ?? [])].map(norm).filter(n => n.length >= 3);
    if (names.some(n => t.includes(n) || (n.length >= 5 && t.includes(n.slice(0, n.length - 1))))) hit.push(p.id);
  }
  return hit;
}

export function wantsJournal(text, quests) {
  if (!text) return false;
  const open = quests.filter(q => isOpenStatus(q.status));
  const t = norm(text);
  const tStems = new Set(words(text).map(stem));
  for (const q of open) {
    const bits = [q.title, ...q.leads.map(l => l.t)];
    for (const bit of bits) if (words(bit).some(w => tStems.has(stem(w)))) return true;
  }
  return QUEST_WORDS.test(t);
}
export function wantsRelations(text, cast, rel) {
  const people = cast.filter(p => p.present).map(p => ({ id: p.id, name: p.name, persona: p.persona, aliases: rel.people.find(x => x.id === p.id)?.aliases ?? [] }));
  const found = mentionedPeople(text, people);
  return found.length >= 2 || (found.length === 1 && people.some(p => p.persona));
}

/** Какие задачи имеет смысл запустить для этого ответа. */
export function pickTasks(text, { quests, cast, relations, knowledge }, enabled, force = false) {
  const tasks = [];
  if (enabled.scene && (force || wantsScene(text, cast, relations, knowledge))) tasks.push('scene');
  if (enabled.items && (force || enabled.itemsAlways !== false || wantsItems(text))) tasks.push('items');
  if (enabled.body && (force || wantsTraces(text))) tasks.push('body');
  if (enabled.place && (force || wantsPlace(text))) tasks.push('place');
  if (FEATURES.secrets && enabled.know && (force || wantsKnowledge(text))) tasks.push('know');
  if (enabled.journal && (force || wantsJournal(text, quests))) tasks.push('journal');
  if (enabled.relations && (force || wantsRelations(text, cast, relations))) tasks.push('relations');
  return tasks;
}



// ---------- новые герои: имена, которых нет в списке ----------
const STOP_CAPS = new Set(['я', 'ты', 'он', 'она', 'мы', 'вы', 'они', 'бог', 'боги', 'боже']);
/** Слова с заглавной буквы в середине предложения, которых нет среди известных имён и которые ещё не проверяли дважды. */
export function newNameCandidates(text, roster, seen = {}) {
  const t = String(text ?? '');
  const known = new Set();
  for (const p of roster) for (const n of [p.name, ...(p.aliases ?? [])]) for (const w of norm(n).match(/[\p{L}]{3,}/gu) ?? []) known.add(w.slice(0, 5));
  const out = [];
  const re = /\p{Lu}[\p{L}'’-]{2,}/gu;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const i = m.index;
    let j = i - 1;
    while (j >= 0 && /[ \t]/.test(t[j])) j--;
    const prev = j >= 0 ? t[j] : '';
    let start = j < 0 || /[.!?…\n:]/.test(prev);
    if (!start && /["«“—–-]/.test(prev)) {            // начало реплики или абзаца: после кавычки или тире
      let k = j - 1;
      while (k >= 0 && /[ \t]/.test(t[k])) k--;
      start = k < 0 || /[.!?…\n:]/.test(t[k]);
    }
    if (start) continue;
    const w = m[0].replace(/['’-]+$/, '');
    const n = norm(w);
    if (STOP_CAPS.has(n) || known.has(n.slice(0, 5)) || (seen[w] ?? 0) >= 2 || out.includes(w)) continue;
    out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

// ---------- задача «сцена»: кто сейчас рядом ----------
const LEAVE_WORDS = /(?:ушёл|ушел|ушла|ушли|уехал[аи]?|покинул[аи]?|скрылся|скрылась|исчез[ла]*|пропал[аи]?|удалил[а-я]*сь|вышел|вышла|вышли|отправил[а-я]*сь|попрощал[а-я]*сь|расстал[а-я]*сь|остал[а-я]*сь\s+(?:в|на|у)|прибыл[аи]?|пришёл|пришел|пришла|пришли|появил[а-я]*сь|вошёл|вошел|вошла|вошли|присоедин[а-я]*сь)/iu;

/** Известные люди для задачи: [{ id, name, aliases, persona, present, dead }] */
export function sceneRoster(cast, rel, knowledge) {
  const out = cast.map(p => ({ id: p.id, name: p.name, persona: p.persona, present: p.present, aliases: rel.people.find(x => x.id === p.id)?.aliases ?? [] }));
  for (const p of rel.people) if (!out.some(x => x.id === p.id)) out.push({ id: p.id, name: p.name, persona: false, present: false, aliases: p.aliases ?? [] });
  return out.map(p => ({ ...p, dead: Boolean(knowledge?.deaths?.[p.id]) })).filter(p => !p.dead);
}
/** Нужна ли проверка: назван кто-то известный, кого нет в кадре, или есть слово прихода и ухода рядом с присутствующим. */
export function wantsScene(text, cast, rel, knowledge) {
  if (!text) return false;
  const roster = sceneRoster(cast, rel, knowledge);
  if (newNameCandidates(text, roster, rel?.seen).length) return true;
  const named = new Set(mentionedPeople(text, roster));
  if (roster.some(p => !p.present && named.has(p.id))) return true;
  return LEAVE_WORDS.test(text) && roster.some(p => p.present && !p.persona && named.has(p.id));
}
export function buildSceneRequest({ roster, reply, userText, candidates = [] }) {
  const list = roster.map(p => `${p.name}${(p.aliases ?? []).length ? ` (also written: ${p.aliases.join(', ')})` : ''}${p.persona ? ' (player character, always present)' : ''}: ${p.present ? 'currently present' : 'currently absent'}`).join('\n');
  const user = `Known characters:
${list}

Player's last message:
${clipTail(userText, USER_CAP) || '(none)'}

Narrator's reply:
${clipTail(reply, REPLY_CAP)}

Return JSON: {"present":["<name>", ...],"new":[{"name":"<personal name>","aliases":["<other forms>"],"present":true|false}]}
Capitalized words in the reply that are not on the known list: ${candidates.join(', ') || '(none)'}.
Rules for "new": add a character only if it is a PERSON or creature with a personal name that acts, speaks or is directly dealt with in the story (a companion, an NPC, an enemy with a name). Do NOT add places, peoples, gods only invoked in an oath, titles, items, spells or the player character. "present" is true if they are physically in the scene now. Known characters may be written in the reply in another language or spelling (for example a Russian form of an English name): that is the SAME character, never add it as new. Use the name exactly as written in the reply. Leave "new" empty when unsure.
Rules for "present": list EVERY known character who is physically in the scene right now, after this reply: they can speak, act or be touched. A character who is only mentioned, remembered or talked about is NOT present. A character who left, was sent away, died or was left behind is NOT present. A character who arrived, entered or joined in this reply IS present. Keep characters who are present and not said to have left. Use the names exactly as given.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}
/** Сравнивает ответ модели с текущим составом: кто пришёл и кто ушёл. Персона не уходит, мёртвые не приходят. */
export function parseScene(data, roster, reply = '') {
  const list = Array.isArray(data?.present) ? data.present : [];
  const find = name => { const n = norm(name); return roster.find(p => norm(p.name) === n) ?? (n.length >= 3 ? roster.find(p => norm(p.name).startsWith(n) || (p.aliases ?? []).some(a => norm(a) === n)) : null) ?? findAcrossScripts(roster, name) ?? null; };
  const set = new Set(list.map(find).filter(Boolean).map(p => p.id));
  const out = [];
  // новые герои: имя должно стоять в тексте ответа, быть не слишком длинным и не совпадать с известным человеком
  const lower = norm(reply);
  for (const n of (Array.isArray(data?.new) ? data.new : []).slice(0, 3)) {
    const name = clean(n?.name, 40);
    const key = norm(name);
    if (name.length < 2 || !lower.includes(key.slice(0, Math.max(3, key.length - 1))) || find(name) || /\d/.test(name)) continue;
    const aliases = (Array.isArray(n?.aliases) ? n.aliases : []).map(a => clean(a, 40)).filter(a => a && norm(a) !== key).slice(0, 4);
    out.push({ kind: 'newperson', name, aliases, present: n?.present !== false, label: `Новый герой: ${name}${n?.present === false ? ' (не в кадре)' : ' (в кадре)'}` });
  }
  if (!set.size) return out;                                          // модель не назвала известных: состав не трогаем, новых оставляем
  for (const p of roster) {
    if (p.persona) continue;
    if (set.has(p.id) && !p.present) out.push({ kind: 'arrive', personId: p.id, name: p.name, label: `${p.name} теперь в кадре` });
    else if (!set.has(p.id) && p.present) out.push({ kind: 'leave', personId: p.id, name: p.name, label: `${p.name} ушёл из сцены` });
  }
  return out.slice(0, 8);
}


// ---------- задача «вещи»: кто что взял, отдал, потерял ----------
const ITEM_WORDS = /(?:взял[аи]?|подобрал[аи]?|достал[аи]?|вытащил[аи]?|протянул[аи]?|отдал[аи]?|передал[аи]?|вручил[аи]?|нашёл|нашел|нашла|нашли|получил[аи]?|купил[аи]?|продал[аи]?|украл[аи]?|выронил[аи]?|бросил[аи]?|потерял[аи]?|сломал[аи]?|надел[аи]?|снял[аи]?|положил[аи]?|убрал[аи]?|вложил[аи]?|сунул[аи]?|одолжил[аи]?|подарил[аи]?|забрал[аи]?|выпил[аи]?|съел[аи]?|использовал[аи]?|потратил[аи]?|кинжал|меч|зелье|свиток|ключ|амулет|кошел)/iu;
export const wantsItems = text => Boolean(text) && ITEM_WORDS.test(text);
export function buildItemsRequest({ people, items, reply, userText }) {
  const roster = people.map(p => `${p.name}${p.persona ? ' (player character)' : ''}${p.present ? '' : ' (absent)'}`).join(', ');
  const inv = [...people.map(p => p), { id: '', name: 'party' }].map(p => { const list = itemsOf(items, p.id); return list.length ? `${p.name}: ${list.map(i => `${i.name}${i.qty > 1 ? ` x${i.qty}` : ''}`).join('; ')}` : ''; }).filter(Boolean).join('\n') || '(nothing recorded yet)';
  const user = `Characters: ${roster}.
Recorded inventory:
${inv}

Player's last message:
${clipTail(userText, USER_CAP) || '(none)'}

Narrator's reply:
${clipTail(reply, REPLY_CAP)}

Return JSON: {"changes":[{"op":"gain|lose|give","item":"<item name>","qty":1,"owner":"<name or party>","to":"<name, only for give>","note":"<optional short detail>"}]}
Rules: record only what the reply SHOWS happening: gain = someone obtains an item (picks up, finds, takes from a body or chest, buys, receives, is gifted, or is newly shown holding, using or carrying a notable item that is not recorded yet); lose = it leaves the inventory (used up, dropped, sold, destroyed, stolen, left behind); give = it passes from one character to another (owner gives to "to"). Notable items are portable things with a use or value: weapons, tools, keys, books, letters and notes, maps, blueprints, artifacts, gems, coins, potions, scrolls, supplies, loot, containers. Do NOT record worn clothes, body parts, scenery, furniture, or trivial props (a cup, dust, a candle). "owner" is the character who has it (for gain: who gets it; for lose: who loses it), "party" for shared gear. Use names exactly as listed and the item's own name (a short noun phrase, in Russian). Do not repeat what is already recorded. At most 8 changes. Empty list when nothing changed hands.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}
/** Проверяет изменения: владелец известен, у отдающего вещь есть (пробное применение), не больше пяти. */
export function parseItems(data, { people, items }) {
  const find = name => {
    const n = norm(name);
    if (!n) return undefined;
    if (['party', 'отряд', 'общее', 'общий'].includes(n)) return { id: '', name: 'отряд' };
    return people.find(p => [p.name, ...(p.aliases ?? [])].some(a => norm(a) === n)) ?? people.find(p => n.length >= 3 && norm(p.name).startsWith(n)) ?? findAcrossScripts(people, name);
  };
  const out = [];
  let work = items;
  let seq = 0;
  for (const c of Array.isArray(data?.changes) ? data.changes.slice(0, 8) : []) {
    const op = ['gain', 'lose', 'give'].includes(c?.op) ? c.op : '';
    const name = clean(c?.item, 80);
    const owner = find(c?.owner);
    const to = op === 'give' ? find(c?.to) : null;
    const qty = Math.min(Math.max(int(c?.qty) || 1, 1), 999);
    if (!op || !name || !owner || (op === 'give' && (!to || to.id === owner.id))) continue;
    const change = { op, name, qty, ownerId: owner.id, toId: to?.id ?? '', note: clean(c?.note, 160) };
    const probe = applyItemOp(work, change, () => `probe${++seq}`);
    if (!probe.ok) continue;
    work = probe.items;
    const label = op === 'gain' ? `${owner.name} получает: ${name}${qty > 1 ? ` x${qty}` : ''}` : op === 'lose' ? `${owner.name} лишается: ${name}${qty > 1 ? ` x${qty}` : ''}` : `${owner.name} отдаёт ${to.name}: ${name}${qty > 1 ? ` x${qty}` : ''}`;
    out.push({ kind: 'item', ...change, label });
  }
  return out;
}


// ---------- задача «приметы и раны»: следы на теле и одежде, ссадины, раны ----------
const TRACE_WORDS = /(?:след[аы]?(?![\p{L}])|укус|кусан|укусил|синяк|ссадин|царапин|шрам|рубец|мокр|промок|вымок|промокл|грязн|в грязи|забрызга|в крови|окровав|кровь|ожог|порез|ушиб|рана|раны|ранен|ранил|засос|отметин|пятн|потёк|порван|разорван|хромает|хромал|лихорадк|отрав|кашля|дрожит|трясётся|истощ|измотан|вымотан)/iu;
const MOOD_WORDS = /(?:зл[ао]ст|злил|разозл|ярост|в ярости|бешенств|гнев|страх|испуг|напуган|боязн|ужас|тревог|тревожн|нервн|волнени|напряжен|дрож|радост|обрадовал|счастлив|улыбнул|рассмея|печал|грусть|грустн|тоск|подавлен|успокоил|спокойн|расслабил|в панике|паник|боится|боялся)/iu;
const WEAR_WORDS = /(?:надел|одел[аи]?(?![\p{L}])|натянул|накинул|набросил|снял[аи]?(?![\p{L}])|сбросил|скинул|облачил|переоделс|переоделась|обул|разул|взял в руку|выхватил|достал (?:меч|клинок|кинжал|лук|арбалет)|вытащил|обнажил|убрал (?:оружие|клинок|меч|кинжал)|вложил|сунул в ножны)/iu;
// возбуждение: слова о желании и близости (чтобы запрос шёл и на таких сценах, а не только на ранах и настроении)
const AROUSAL_WORDS = /(?:возбуд|желани[еяю]|страст|вожделен|влечени|томлени|трепет|мурашк|ласк|поцел|целова|прижал|прижим|тяжёл\S* дыхани|тяжел\S* дыхани|учащ[её]нн\S* дыхани|краснея|покраснел|arous)/iu;
export const wantsTraces = text => Boolean(text) && (TRACE_WORDS.test(text) || MOOD_WORDS.test(text) || WEAR_WORDS.test(text) || AROUSAL_WORDS.test(text));
const AROUSAL_ALIASES = { none: 0, no: 0, calm: 0, нет: 0, slight: 1, light: 1, mild: 1, лёгкое: 1, легкое: 1, noticeable: 2, moderate: 2, заметное: 2, strong: 3, high: 3, сильное: 3, overwhelming: 4, peak: 4, extreme: 4, 'на пределе': 4 };
const stems = s => (norm(s).match(/[\p{L}]{4,}/gu) ?? []).map(w => w.slice(0, 4));
/** Похожие по смыслу фразы (для воспоминаний и событий): общих основ слов не меньше двух-трёх и не меньше 60% от короткой фразы; имена людей в счёт не идут. */
const similarText = (a, b, names = []) => {
  const skip = new Set(names.flatMap(n => stems(n)));
  const x = new Set(stems(a).filter(w => !skip.has(w))), y = [...new Set(stems(b).filter(w => !skip.has(w)))];
  const shared = y.filter(w => x.has(w)).length;
  const small = Math.min(x.size, y.length);
  return shared >= Math.min(3, Math.max(2, small)) && shared / Math.max(1, small) >= 0.6;
};
const MOOD_ALIASES = { angry: 'anger', furious: 'rage', afraid: 'fear', scared: 'fear', joy: 'happy', joyful: 'happy', anxious: 'nervous', worried: 'nervous', tense: 'nervous', sorrow: 'sad', upset: 'sad', relaxed: 'calm', злость: 'anger', ярость: 'rage', страх: 'fear', радость: 'happy', печаль: 'sad', спокойный: 'calm', нервный: 'nervous' };
const similarTrace = (a, b) => { const x = new Set(stems(a)); return stems(b).filter(w => x.has(w)).length >= Math.min(2, Math.max(1, x.size)); };
export function buildTracesRequest({ people, bodies, reply, userText, dateLabel, items = [] }) {
  const list = people.map(p => {
    const b = bodies[p.id] ?? { conds: [], wounds: [] };
    const conds = b.conds.map(c => `${c.t}${c.left === null ? '' : c.left > 0 ? ` (${c.left} d left)` : ' (expiring)'}`);
    const gear = wardrobeOf(items, p.id);
    const wardrobe = gear.length ? `wardrobe: ${gear.map(g => `${g.name}${g.worn ? ' [worn]' : ''}`).join(', ')}` : '';
    const mood = b.mood ? `mood: ${(MOODS.find(m => m.id === b.mood.id) ?? MOODS[0]).en}` : '';
    const arousal = cleanArousal(b.arousal) ? `arousal: ${['', 'slight', 'noticeable', 'strong', 'overwhelming'][cleanArousal(b.arousal)]}` : '';
    return `${p.name}${p.persona ? ' (player character)' : ''}: ${[...b.wounds.map(w => `wound: ${w}`), ...conds, mood, arousal, wardrobe].filter(Boolean).join('; ') || 'nothing recorded'}`;
  }).join('\n');
  const user = `Date in the story: ${dateLabel}.
Characters in the scene and what is already recorded on them:
${list}

Player's last message:
${clipTail(userText, USER_CAP) || '(none)'}

Narrator's reply:
${clipTail(reply, REPLY_CAP)}

Return JSON: {"changes":[{"who":"<name>","kind":"mark|wound|clear|mood|arousal|wear|unwear","text":"short Russian phrase (for mood: ${MOOD_IDS.join('|')}; for arousal: none|slight|noticeable|strong|overwhelming; for wear and unwear: the item name exactly as in the wardrobe)","days":<integer>,"zone":"${ZONE_IDS.join('|')}","severity":<1-3>}]}
Rules: "mark" = a visible lasting trace on a body or on what is worn that the reply SHOWS or newly establishes: bite marks, bruises, scratches, scars freshly made, being soaked, muddy, bloodied, shaking, exhausted. "days" = how long it plausibly lasts (soaked or muddy 1; bruise or bite marks 2-4; tired 1; use 0 only for permanent). "wound" = real damage with severity 1 (light), 2 (serious), 3 (grave) and the body "zone". "clear" = a recorded trace that the reply shows is gone (washed off, dried, healed, changed clothes): put the recorded text in "text". Use names exactly as listed, only characters from the list. Do not repeat what is already recorded. At most 6 changes; an empty list is right when nothing new is shown. Keep "text" short, in Russian, about what is seen ("след от укуса на шее", "рубаха вымокла под ливнем"). "mood" = the character's emotional state in this reply changed or is clearly shown: text is one of ${MOOD_IDS.join(", ")} and "severity" is how strong it is (1 slight, 2 noticeable, 3 strong); use "calm" when they settle down; only for a person who acts or speaks, never for the player character; skip it if it matches what is already recorded. "arousal" = how physically aroused the character visibly is in this reply (a flush, quickened breath, desire in words or touch): text is one of none, slight, noticeable, strong, overwhelming; use "none" when it clearly passes; only for a person who acts or speaks, never for the player character; skip it if it matches what is already recorded; judge only by what the text SHOWS, never guess. "wear" = a character puts on, draws or picks up an item that is IN THEIR WARDROBE list; "unwear" = takes it off, sheathes or drops it; use the exact wardrobe name; never invent items that are not on the list.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}
/** Проверка: человек из списка, зона и тяжесть в пределах, повторы существующего отбрасываются, clear должен найти запись. */
export function parseTraces(data, { people, bodies, items = [] }) {
  const find = name => { const n = norm(name); return people.find(p => [p.name, ...(p.aliases ?? [])].some(a => norm(a) === n)) ?? people.find(p => n.length >= 3 && norm(p.name).startsWith(n)) ?? (n ? findAcrossScripts(people, name) : undefined); };
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(data?.changes) ? data.changes.slice(0, 6) : []) {
    const p = find(c?.who);
    const kind = ['mark', 'wound', 'clear', 'mood', 'arousal', 'wear', 'unwear'].includes(c?.kind) ? c.kind : '';
    const text = clean(c?.text, 120);
    if (!p || !kind || text.length < 3) continue;
    if (kind === 'mood') {
      const key = MOOD_ALIASES[norm(text)] ?? (MOOD_IDS.includes(norm(text)) ? norm(text) : '');
      const lvl = Math.min(Math.max(int(c?.severity) || 2, 1), 3);
      const cur = bodies[p.id]?.mood;
      if (!key || p.persona || (cur && cur.id === key && cur.lvl === lvl) || (!cur && key === 'calm') || seen.has(`${p.id}|mood`)) continue;
      seen.add(`${p.id}|mood`);
      const m = MOODS.find(x => x.id === key);
      out.push({ kind: 'body', op: 'mood', personId: p.id, name: p.name, text: key, sev: lvl, label: `${p.name}: ${m.ru.toLowerCase()}${key === 'calm' ? '' : `, ${MOOD_LEVEL_RU[lvl]}`}` });
      continue;
    }
    if (kind === 'arousal') {
      const key = norm(text);
      const lvl = key in AROUSAL_ALIASES ? AROUSAL_ALIASES[key] : cleanArousal(key);
      const cur = cleanArousal(bodies[p.id]?.arousal);
      if (p.persona || lvl === cur || seen.has(`${p.id}|arousal`)) continue;
      seen.add(`${p.id}|arousal`);
      out.push({ kind: 'body', op: 'arousal', personId: p.id, name: p.name, text: String(lvl), sev: lvl, label: `${p.name}: возбуждение — ${AROUSAL_RU[lvl]}` });
      continue;
    }
    if (kind === 'wear' || kind === 'unwear') {
      const it = findGear(items, p.id, text);
      const on = kind === 'wear';
      if (!it || Boolean(it.worn) === on || seen.has(`${p.id}|wear|${it.id}`)) continue;
      seen.add(`${p.id}|wear|${it.id}`);
      out.push({ kind: 'body', op: 'wear', personId: p.id, name: p.name, text: it.name, on, label: `${p.name}: ${on ? 'надел(а)' : 'снял(а)'} — ${it.name}` });
      continue;
    }
    const b = bodies[p.id] ?? { conds: [], wounds: [] };
    const key = `${p.id}|${kind}|${stems(text).join('')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (kind === 'clear') {
      const hit = b.conds.find(x => similarTrace(x.t, text));
      if (hit) out.push({ kind: 'body', op: 'clear', personId: p.id, name: p.name, condId: hit.id, text: hit.t, label: `${p.name}: больше нет — ${hit.t}` });
    } else if (kind === 'mark') {
      if (b.conds.some(x => similarTrace(x.t, text))) continue;
      const days = Math.min(Math.max(int(c?.days), 0), 30);
      out.push({ kind: 'body', op: 'mark', personId: p.id, name: p.name, text, days: Number.isFinite(days) ? days : 2, label: `${p.name}: ${text}${days > 0 ? ` (${days} дн.)` : ''}` });
    } else {
      if (b.wounds.some(w => similarTrace(w, text))) continue;
      const zone = ZONE_IDS.includes(c?.zone) ? c.zone : 'chest';
      const sev = Math.min(Math.max(int(c?.severity) || 1, 1), 3);
      out.push({ kind: 'body', op: 'wound', personId: p.id, name: p.name, text, zone, sev, label: `${p.name}: рана — ${text} (${ZONES[zone].ru}, тяжесть ${sev})` });
    }
  }
  return out;
}


// ---------- задача «место»: где сцена, новые места, находки и перемены ----------
const PLACE_WORDS = /(?:пришли|пришёл|пришел|пришла|прибыл|добрал|оказал|вошл|вошё|вошел|вошла|зашл|зашё|зашел|вышл|вышё|вышел|подошл|подошё|подошел|направил|отправил|спустил|поднял|вернул|переправ|пересекл|пещер|деревн|город|таверн|лагер|лес|поляна|поляну|зал|комнат|коридор|тропа|тропу|дорог|мост|храм|башн|подвал|порт|рынок|площад|обвал|обруш|разруш|сгорел|сожгл|рухнул|взорвал|затопл|пробоин)/iu;
export const wantsPlace = text => Boolean(text) && PLACE_WORDS.test(text);
export function buildPlaceRequest({ nodes, current, reply, userText }) {
  const places = nodes.filter(n => n.kind !== 'folder').slice(0, 120).map(n => `${pathOf(nodes, n.id)}${n.id === current ? '  <- the party is here now' : ''}`).join('\n') || '(no places recorded yet)';
  const user = `Known places (a path shows the place inside larger ones):
${places}

Player's last message:
${clipTail(userText, USER_CAP) || '(none)'}

Narrator's reply:
${clipTail(reply, REPLY_CAP)}

Return JSON: {"current":{"name":"<place name>","parent":"<known place or empty>"}|null,"traits":[{"place":"<place name>","text":"<short>"}],"notes":[{"place":"<place name>","text":"<short>"}]}
Rules: "current" is where the party stands at the END of the reply. If it is a known place, use its name exactly; if it is a new place, give a short name (up to six words, no verbs) and the known place it lies inside as "parent" (empty if none fits). Put null when the party stays where it was. "traits" are lasting physical features of a place that the reply newly SHOWS (at most 3). "notes" are lasting changes or events that altered a place (a bridge collapsed, a door burned, a body left): at most 2. Never record weather, passing noises or people as traits. Short Russian phrases. Empty lists are right when nothing new is shown.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}
/** Проверка: известные места по названию, новое место с родителем из известных, повторы существующего не нужны. */
export function parsePlace(data, { nodes, current, over = {} }) {
  const out = { current: null, traits: [], notes: [] };
  const cur = data?.current && typeof data.current === 'object' ? data.current : null;
  if (cur) {
    const name = clean(cur.name, 60);
    const known = findNode(nodes, name);
    if (known) { if (known.id !== current) out.current = { id: known.id, name: known.name }; }
    else if (name.length >= 3 && !/[.!?:;]/.test(name) && name.split(' ').length <= 7) {
      const parent = findNode(nodes, clean(cur.parent, 60));
      out.current = { id: '', name, parentId: parent?.id ?? '' };
    }
  }
  const have = (list, text) => list.some(x => norm(x) === norm(text) || stems(x).filter(w => stems(text).includes(w)).length >= 2);
  const target = name => { const k = findNode(nodes, name); if (k) return k; return out.current && !out.current.id && norm(out.current.name) === norm(name) ? { id: '', name: out.current.name } : null; };
  for (const [key, max] of [['traits', 3], ['notes', 2]]) {
    for (const t of (Array.isArray(data?.[key]) ? data[key] : []).slice(0, max)) {
      const place = target(clean(t?.place, 60)), text = clean(t?.text, 120);
      if (!place || text.length < 3) continue;
      const base = place.id ? [...(nodes.find(n => n.id === place.id)?.traits ?? []), ...(nodes.find(n => n.id === place.id)?.notes ?? []), ...(over[place.id]?.traits ?? []), ...(over[place.id]?.notes ?? [])] : [];
      if (have(base, text)) continue;
      out[key].push({ placeId: place.id, placeName: place.name, text });
    }
  }
  const label = [];
  if (out.current) label.push(out.current.id ? `Обстановка: ${out.current.name}` : `Новое место: ${out.current.name}`);
  for (const t of out.traits) label.push(`${t.placeName}: ${t.text}`);
  for (const n of out.notes) label.push(`${n.placeName}, перемена: ${n.text}`);
  return label.length ? [{ kind: 'place', ...out, label: label.join('; ') }] : [];
}


// ---------- задача «знания»: кто что узнал, кто с кем познакомился, кто погиб ----------
const KNOW_WORDS = /(?:рассказал|поведал|признал|сообщил|раскрыл|выдал|узнал|выяснил|услышал|подслушал|заметил|увидел|понял|догадал|шепнул|открыл|призна|тайн|секрет|слух|прочитал|письм|представил|назвал|зовут|знакомьтесь|знаком|познаком|умер|умерла|погиб|убит|убила|убил|мёртв|мертв|скончал|казнён|казнен)/iu;
export const wantsKnowledge = text => Boolean(text) && KNOW_WORDS.test(text);

// ---------- удалённый свидетель: устройство (Око), через которое кто-то смотрит и слушает ----------
const EYE_RE = /(?<![\p{L}\p{N}])(?:всевидящ\p{L}*[ \t]+ок\p{L}*|ок(?:о|а|у|ом|е)|scrying[ \t]+eye)(?![\p{L}\p{N}])/iu;
/** Упомянуто ли устройство наблюдения в тексте (devices: свои названия, дополняют стандартные). */
export function eyeMentioned(text, devices = []) {
  const t = String(text ?? '');
  if (!t) return false;
  if (EYE_RE.test(t)) return true;
  const n = norm(t);
  return (Array.isArray(devices) ? devices : []).some(d => { const w = norm(d).trim(); return w.length >= 3 && n.includes(w); });
}
/** Наблюдатель среди людей: по имени или прозвищу, без учёта регистра. */
export function findWatcher(people, name) {
  const n = norm(name).trim();
  if (!n) return null;
  const list = people ?? [];
  return list.find(p => [p.name, ...(p.aliases ?? [])].some(a => norm(a).trim() === n)) ?? findAcrossScripts(list, name) ?? null;   // «Вестор» находит «Alden Vestor» и без прозвища
}

/**
 * Запасная строка журнала наблюдений, когда модель-архивариус ничего не вернула, а Око точно рядом: что сказал и сделал игрок
 * (реплики в кавычках, иначе начало его сообщения). Пусто, если сказать нечего.
 */
export function eyeFallbackLine(userText, personaName = '', cap = 260) {
  const raw = String(userText ?? '').replace(/<[^>]*>/g, ' ').replace(/[*_`~#]+/g, '').replace(/\s+/g, ' ').trim();
  if (raw.length < 3) return '';
  const quotes = [...raw.matchAll(/[«"“„]([^«»"“”„]{3,200})[»"”“]/gu)].map(m => m[1].trim()).filter(Boolean).slice(0, 3);
  const who = String(personaName ?? '').trim() || 'Герой';
  const line = quotes.length ? `${who} говорит: ${quotes.map(q => `«${q}»`).join(' ')}` : `${who} при Оке: ${raw}`;
  return line.length > cap ? `${line.slice(0, cap - 1)}…` : line;
}

export function buildKnowledgeRequest({ people, events, reply, userText, dateLabel, watch = null }) {
  const roster = [...people.map(p => `${p.name}${p.persona ? ' (player character)' : ''}${p.present ? '' : ' (absent)'}`), ...(watch ? [`${watch.watcherName} (absent, watching through the ${watch.device})`] : [])].join(', ');
  const known = events.slice(-30).map((e, i) => `[${i + 1}] ${e.text}${e.secret ? ' (secret)' : ''}`).join('\n') || '(none recorded yet)';
  const user = `Date in the story: ${dateLabel}.
Characters: ${roster}.
Recorded events (what is known in the story):
${known}

Player's last message:
${clipTail(userText, USER_CAP) || '(none)'}

Narrator's reply:
${clipTail(reply, REPLY_CAP)}

Return JSON: {"events":[{"text":"<what happened, one short Russian sentence>","secret":true|false,"witnesses":["<name>"]}],"learned":[{"event":<number from the list>,"who":["<name>"],"from":"<name or empty>","how":"told|rumor"}],"met":[{"a":"<name>","b":"<name>","status":"known|seen"}],"deaths":[{"name":"<name>","note":"<how and when, short>"}]${watch ? ',"watch":"<see rules>"' : ''}}
Rules: "events" = important facts the reply establishes that others may or may not know (a betrayal, a plan, a discovery, an oath, a killing, a revelation); "witnesses" = ONLY characters who saw or heard it happen; mark "secret" true when the characters are hiding it. "learned" = a recorded event that someone is TOLD or hears as rumour in this reply ("from" is who told them). "met" = two characters who introduced themselves or learned each other's names in this reply (known) or saw each other without names (seen). "deaths" = a character who dies in this reply (not the player character). Use names exactly as listed. At most 4 events, 4 learned, 3 met, 2 deaths. Empty lists are right when nothing like this happens.${watch ? ` "watch": the ${watch.device} is a floating observation device; ${watch.watcherName} sees and hears through it. If in THIS reply the ${watch.device} is clearly in the room with the characters, "watch" = one or two short Russian sentences about what it saw and heard (who said or did what, by name, keep key words of important speech); if it is gone, absent or only mentioned, "watch" = "". Do not list ${watch.watcherName} as a witness of other events unless he is really in the room.` : ''}`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}
/** Проверка: имена из списка, события не дублируют записанные, «узнал» ссылается на существующее событие и на того, кто ещё не знал. */
export function parseKnowledge(data, { people, knowledge, watch = null }) {
  const find = name => { const n = norm(name); return n ? people.find(p => [p.name, ...(p.aliases ?? [])].some(a => norm(a) === n)) ?? people.find(p => n.length >= 3 && norm(p.name).startsWith(n)) ?? findAcrossScripts(people, name) : undefined; };
  const have = knowledge.events.slice(-30);
  const out = { events: [], learned: [], met: [], deaths: [], watch: null };
  if (watch) {
    const text = clean(data?.watch, 400), who = find(watch.watcherName);
    if (text.length >= 5 && who) out.watch = { text, watcherId: who.id };
  }
  for (const e of (Array.isArray(data?.events) ? data.events : []).slice(0, 4)) {
    const text = clean(e?.text, 200);
    if (text.length < 5 || knowledge.events.some(x => similarText(x.text, text, people.map(p => p.name)) || norm(x.text) === norm(text))) continue;
    const witnessIds = [...new Set((Array.isArray(e?.witnesses) ? e.witnesses : []).map(find).filter(Boolean).map(p => p.id))];
    out.events.push({ text, secret: e?.secret === true, witnessIds });
  }
  for (const l of (Array.isArray(data?.learned) ? data.learned : []).slice(0, 4)) {
    const ev = have[int(l?.event) - 1];
    const how = l?.how === 'rumor' ? 'rumor' : 'told';
    const from = find(l?.from);
    if (!ev) continue;
    for (const w of (Array.isArray(l?.who) ? l.who : []).map(find).filter(Boolean)) {
      if (dossier(knowledge, w.id).knows.some(k => k.event.id === ev.id)) continue;
      out.learned.push({ eventId: ev.id, eventText: ev.text, personId: w.id, personName: w.name, source: how, fromId: from && from.id !== w.id ? from.id : '' });
    }
  }
  for (const m of (Array.isArray(data?.met) ? data.met : []).slice(0, 3)) {
    const a = find(m?.a), b = find(m?.b);
    const status = m?.status === 'seen' ? 'seen' : 'known';
    if (!a || !b || a.id === b.id) continue;
    const key = pairKey(a.id, b.id);
    if ((knowledge.acquaintances[key] ?? '') === status || (knowledge.acquaintances[key] === 'known' && status === 'seen')) continue;
    out.met.push({ key, status, aName: a.name, bName: b.name });
  }
  for (const d of (Array.isArray(data?.deaths) ? data.deaths : []).slice(0, 2)) {
    const p = find(d?.name);
    if (!p || p.persona || knowledge.deaths[p.id]) continue;
    out.deaths.push({ personId: p.id, name: p.name, note: clean(d?.note, 300) });
  }
  const label = [
    ...out.events.map(e => `Событие${e.secret ? ' (тайна)' : ''}: ${e.text}`),
    ...out.learned.map(l => `${l.personName} ${l.source === 'rumor' ? 'слышит слух' : 'узнаёт'}: ${l.eventText}`),
    ...out.met.map(m => `${m.aName} и ${m.bName}: ${m.status === 'known' ? 'познакомились' : 'видели друг друга'}`),
    ...out.deaths.map(d => `${d.name} погиб${d.note ? `: ${d.note}` : ''}`),
    ...(out.watch ? [`Око видит: ${out.watch.text}`] : []),
  ];
  return label.length ? [{ kind: 'know', ...out, label: label.join('; ') }] : [];
}

// ---------- запросы ----------
const clipTail = (s, n) => { const v = String(s ?? '').trim(); return v.length > n ? `…${v.slice(-n)}` : v; };
const SYSTEM = 'You are a quiet chronicler for a roleplay. You read ONE reply of the narrator and record only what the text itself shows. Never invent, never guess feelings that are not shown, never record the player character\'s thoughts. Answer with a single JSON object and nothing else. Empty arrays are the right answer when nothing qualifies. Write all text values in Russian, short and concrete.';

export function buildJournalRequest({ quests, reply, userText, dateLabel }) {
  const open = quests.filter(q => isOpenStatus(q.status));
  const list = open.map((q, i) => `[${i + 1}] ${q.title}${q.goal ? ` — ${q.goal}` : ''}${q.leads.length ? `\n   leads: ${q.leads.map((l, j) => `(${j + 1}) ${l.t} [${l.state}]`).join('; ')}` : ''}`).join('\n') || '(no open quests)';
  const user = `Date in the story: ${dateLabel}.
Open quests:
${list}

Player's last message:
${clipTail(userText, USER_CAP) || '(none)'}

Narrator's reply:
${clipTail(reply, REPLY_CAP)}

Return JSON: {"entries":[{"quest":<number>,"text":"what happened that matters for this quest, one sentence"}],"leads":[{"quest":<number>,"lead":<number>,"state":"work|done|dead","note":"how it ended, short"}],"newQuests":[{"title":"short title","goal":"one sentence","leads":["optional lead"]}]}
Rules: at most 3 entries, 3 lead changes and 1 new quest. "dead" means the lead is a dead end or failed. Add a new quest only when someone clearly gives the player a task or a clear goal appears; do not duplicate an existing quest. An entry must report a concrete event from the reply, not a summary of the whole scene.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

export function buildRelationsRequest({ present, lines, reply, userText, dateLabel }) {
  const roster = present.map(p => p.name + (p.persona ? ' (player character)' : '')).join(', ');
  const cur = lines.length ? lines.join('\n') : '(no lines yet)';
  const scales = UI_SCALES.join(', ');
  const user = `Date in the story: ${dateLabel}.
Characters present in the scene: ${roster}.
Current feelings (A>B means how A feels toward B, scale −100..100):
${cur}

Player's last message:
${clipTail(userText, USER_CAP) || '(none)'}

Narrator's reply:
${clipTail(reply, REPLY_CAP)}

Return JSON: {"changes":[{"from":"<name>","to":"<name>","scale":"<one of: ${scales}>","delta":<integer, -${MAX_DELTA}..${MAX_DELTA}>,"evidence":"short quote or fact from the reply that justifies it","memory":"optional: a lasting memory worth keeping, one sentence"}],"moments":[{"between":["<name>","<name>"],"kind":"memory|tension","text":"<one short Russian sentence>","intensity":<1-5>}]}
Rules: only characters from the present list. Judge the feeling of "from" toward "to" only if "from" saw or heard what happened. Evidence is required; without a clear sign in the text make no change. Typical delta is 2-6, 10+ only for a shattering event. Negative feelings (fear, resentment, hostility, jealousy, guilt, anxiety) rise on hurt, threat and betrayal and fall on reassurance; warm feelings rise on kindness, help and trust. At most 5 changes. "moments": when the reply establishes something the characters will REMEMBER together (a shared event, a promise, a rescue, a quarrel, a confession) give a "memory" between the participants; when it leaves something UNRESOLVED between them (a suspicion, an unanswered question, a threat, a debt) give a "tension". Use present characters only, at most 2 moments, one concrete sentence each, nothing for small talk.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

// ---------- разбор и проверка ----------
const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const int = v => Math.trunc(Number(v));

/** Журнал: проверяет номера против списка идущих квестов; плохие правки молча отбрасывает. */
export function parseJournal(data, quests) {
  const open = quests.filter(q => isOpenStatus(q.status));
  const out = [];
  for (const e of Array.isArray(data?.entries) ? data.entries.slice(0, 3) : []) {
    const q = open[int(e?.quest) - 1], text = clean(e?.text, 400);
    if (q && text) out.push({ kind: 'entry', questId: q.id, text, label: `Запись в «${q.title}»: ${text}` });
  }
  for (const l of Array.isArray(data?.leads) ? data.leads.slice(0, 3) : []) {
    const q = open[int(l?.quest) - 1], lead = q?.leads[int(l?.lead) - 1];
    const state = ['work', 'done', 'dead'].includes(l?.state) ? l.state : '';
    if (q && lead && state && lead.state !== state) {
      const note = clean(l?.note, 300);
      out.push({ kind: 'lead', questId: q.id, leadId: lead.id, state, note, label: `«${q.title}»: зацепка «${lead.t}» → ${{ work: 'в работе', done: 'отработана', dead: 'тупик' }[state]}${note ? ` (${note})` : ''}` });
    }
  }
  const fresh = (Array.isArray(data?.newQuests) ? data.newQuests : []).filter(n => { const title = clean(n?.title, 120); return title && !quests.some(q => norm(q.title) === norm(title)); });
  for (const n of fresh.slice(0, 1)) {
    const title = clean(n?.title, 120);
    const goal = clean(n?.goal, 400);
    const leads = (Array.isArray(n?.leads) ? n.leads : []).map(x => clean(x, 200)).filter(Boolean).slice(0, 4);
    out.push({ kind: 'quest', title, goal, leads, label: `Новый квест «${title}»${goal ? `: ${goal}` : ''}` });
  }
  return out;
}

/** Отношения: имена сопоставляются с присутствующими, шкалы с известными, скачок режется до MAX_DELTA. */
export function parseRelations(data, { cast, lines, shared = [] }) {
  const present = cast.filter(p => p.present);
  const byName = new Map(present.flatMap(p => [p.name, ...(p.aliases ?? [])].map(n => [norm(n), p])));
  const find = name => byName.get(norm(name)) ?? present.find(p => norm(p.name).startsWith(norm(name)) && norm(name).length >= 3) ?? findAcrossScripts(present, name);
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(data?.changes) ? data.changes.slice(0, 5) : []) {
    const from = find(c?.from), to = find(c?.to);
    const scale = SCALE_IDS.includes(c?.scale) ? c.scale : '';
    let delta = int(c?.delta);
    const evidence = clean(c?.evidence, 300);
    if (!from || !to || from.id === to.id || !scale || !Number.isFinite(delta) || delta === 0 || !evidence) continue;
    if (from.persona) continue;                                         // чувствами персоны управляет игрок
    delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta));
    const key = `${from.id}>${to.id}|${scale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = lines.find(l => l.from === from.id && l.to === to.id);
    const was = line?.scales?.[scale] ?? 0;
    const memory = clean(c?.memory, 300);
    out.push({ kind: 'rel', fromId: from.id, toId: to.id, scale, delta, memory, evidence, label: `${from.name} → ${to.name}: ${SCALES.find(s => s.id === scale).ru} ${was} → ${Math.max(-100, Math.min(100, was + delta))} (${delta > 0 ? '+' : ''}${delta}). «${evidence}»${memory ? ` Запомнить: ${memory}` : ''}` });
  }
  for (const m of (Array.isArray(data?.moments) ? data.moments : []).slice(0, 2)) {
    const who = [...new Set((Array.isArray(m?.between) ? m.between : []).map(find).filter(Boolean).map(p => p.id))];
    const text = clean(m?.text, 300), mk = m?.kind === 'tension' ? 'tension' : m?.kind === 'memory' ? 'memory' : '';
    if (who.length < 2 || !mk || text.length < 8) continue;
    if (shared.some(x => x.kind === mk && who.every(id => x.who.includes(id)) && similarText(x.text, text, cast.map(p => p.name)))) continue;
    const names = who.map(id => present.find(p => p.id === id)?.name).join(' и ');
    out.push({ kind: 'moment', who, mkind: mk, text, intensity: Math.min(Math.max(int(m?.intensity) || 3, 1), 5), label: `${mk === 'tension' ? 'Напряжение' : 'Воспоминание'} (${names}): ${text}` });
  }
  return out;
}


// ---------- группы: несколько задач одним запросом ----------
/** Какие задачи идут вместе при режиме «группами» (две модели-вызова вместо семи). */
export const GROUPS = Object.freeze({ people: ['scene', 'relations', 'know', 'journal'], world: ['items', 'body', 'place'] });
/** Раскладывает задачи по запросам: 'split' по одному, 'grouped' по два запроса, 'single' всё сразу. */
export function planRequests(tasks, mode = 'grouped') {
  if (mode === 'split') return tasks.map(t => [t]);
  if (mode === 'single') return tasks.length ? [tasks] : [];
  const out = [];
  for (const g of Object.values(GROUPS)) { const part = tasks.filter(t => g.includes(t)); if (part.length) out.push(part); }
  return out;
}
/**
 * Склеивает готовые запросы задач в один: у каждой задачи берётся её описание и схема ответа, а ответ рассказчика и
 * сообщение игрока (они у всех одинаковые) идут один раз. Модель отвечает одним объектом {"задача": {…}, …}.
 */
export function mergeRequests(list) {
  if (list.length === 1) return { messages: list[0].messages, keyed: false };
  const user = m => m.messages[1].content;
  const cut = (text, marker) => { const i = text.indexOf(marker); return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i)]; };
  const parts = list.map(item => {
    const [head, rest] = cut(user(item), "\n\nPlayer's last message:");
    const [shared, tail] = cut(rest, '\n\nReturn JSON:');
    return { name: item.name, head: head.trim(), shared: shared.trim(), tail: tail.replace(/^\n\nReturn JSON:/, '').trim() };
  });
  const names = parts.map(p => p.name);
  const content = `${parts.map(p => `### TASK "${p.name}"\n${p.head}`).join('\n\n')}\n\n${parts[0].shared}\n\n${parts.map(p => `### ANSWER FORMAT AND RULES for "${p.name}"\n${p.tail}`).join('\n\n')}\n\nReturn ONE JSON object whose keys are exactly: ${names.map(n => `"${n}"`).join(', ')}. Under each key put the object described for that task (an empty object or empty lists when nothing applies). No text outside the JSON.`;
  return { messages: [list[0].messages[0], { role: 'user', content }], keyed: true };
}
