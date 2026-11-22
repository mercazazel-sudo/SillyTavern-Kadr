/**
 * Разбор лорбука по людям и местам. Лорбук не всегда в формате «[ Имя ] - Раздел»: бывают записи по темам
 * (правила мира, места, жители вперемешку). Здесь чистые функции: быстрая оценка по названию и тексту (без запроса),
 * запрос вспомогательной модели, проверка её ответа и «подпись» лорбука, чтобы замечать новые записи.
 * Ничего не меняет: возвращает план, который человек правит сам.
 */
import { parseSheetTitle } from './cards.js';

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export const KINDS_TRIAGE = Object.freeze(['person', 'place', 'other']);
export const KIND_RU = Object.freeze({ person: 'Человек', place: 'Место', other: 'Остальное' });
const SECRET = /^\s*\[\s*(?:секрет|secret)/iu;

/** Записи, которые вообще разбираются: включённые, с текстом, не секретные и не в формате анкеты «[ Имя ] - Раздел». */
export function triageCandidates(entries, { linkedTitles = new Set(), sheetUids = new Set() } = {}) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.disable || typeof e.content !== 'string' || !e.content.trim()) continue;
    const title = clip(e.comment, 120);
    if (!title || SECRET.test(title)) continue;
    if (parseSheetTitle(title)) continue;                         // анкеты в нужном формате собирает прежний механизм
    if (sheetUids.has(String(e.uid))) continue;                   // уже стала разделом анкеты
    if (linkedTitles.has(norm(title))) continue;                  // уже привязана к месту
    out.push({ uid: String(e.uid), title, keys: Array.isArray(e.key) ? e.key.map(k => clip(k, 60)).filter(Boolean).slice(0, 6) : [], text: String(e.content).trim() });
  }
  return out;
}

// ---------- быстрая оценка ----------
const EN_PLACE = 'village|town|city|tavern|inn|farm|farmhouse|forest|woods|mountain|castle|temple|camp|road|bridge|cave|house|mill|market|harbou?r|port|district|street|tower|fort|keep|dungeon|ruins|island|river|lake|gate|hall|room|shop|manor|estate|barn|field|garden|church|school|cabin|hut|shrine|capital|kingdom|region|valley|hill|swamp|desert|coast';
const RU_PLACE = 'деревн|город|таверн|постоял|ферм|замок|храм|лагер|дорог|мост|пещер|мельниц|рынок|район|улиц|башн|крепост|подземель|руин|остров|озер|ворота|комнат|лавк|поместь|церков|школ|хижин|святилищ|столиц|королевств|долин|болот|пустын|побережь';
const RU_PLACE_WHOLE = 'лес|дом|сад|зал|порт|гора|горы|река|реки';
const PLACE_WORD = new RegExp(String.raw`(?:^|[^\p{L}])(?:(?:${EN_PLACE})s?(?![\p{L}])|(?:${RU_PLACE})|(?:${RU_PLACE_WHOLE})(?![\p{L}]))`, 'iu');
const EN_OTHER = 'rules?|laws?|overview|history|biology|culture|cultures|magic|system|guide|setting|world|instructions?|reforms?|diversity|physiology|medicine|healthcare|identification|documentation|economy|religion|politics|factions?|species|races?|society|lore|notes?';
const RU_OTHER = 'правил|закон|обзор|истори|биолог|культур|магия|систем|инструкц|реформ|разнообраз|медицин|экономик|религи|политик|фракци|общество|заметк';
const RU_OTHER_WHOLE = 'мир|вид|виды|раса|расы';
const OTHER_WORD = new RegExp(String.raw`(?:^|[^\p{L}])(?:(?:${EN_OTHER})(?![\p{L}])|(?:${RU_OTHER})|(?:${RU_OTHER_WHOLE})(?![\p{L}]))`, 'iu');
const FIELD = /(?:^|\n|\.\s)\s*(?:age|race|species|gender|appearance|personality|occupation|background|height|voice|возраст|раса|пол|внешность|характер|профессия|рост|голос)\s*[:：]/iu;
const PRONOUN = /(?:^|[^\p{L}])(?:he|she|his|her|him|hers|он|она|его|ее|её|ему|ей)(?=$|[^\p{L}])/giu;
const NAME_ROLE = /^\p{Lu}[\p{L}'’.]*(?:\s+\p{Lu}[\p{L}'’.]*){0,2}\s+[-–—:]\s+\S.*$/u;
const NAME_ONLY = /^\p{Lu}[\p{L}'’.]*(?:\s+\p{Lu}[\p{L}'’.]*){0,2}$/u;
const LOCATED = /(?:is a (?:small |large |quiet )?(?:village|town|city|farm|place|building|tavern|inn)|is located|lies |situated|расположен|находится|это (?:деревня|город|таверна|ферма))/iu;
const DIRECTIVE = /(?:^|\n)\s*(?:never|always|do not|don't|must|нельзя|никогда|всегда|не\s+(?:допускай|делай))/iu;

/** Оценка записи: { kind, conf } где conf от 0 до 3 (насколько уверенно по признакам). */
export function heuristicKind(title, text = '') {
  const t = clip(title, 120), body = String(text ?? '').slice(0, 900);
  let person = 0, place = 0, other = 0;
  if (NAME_ROLE.test(t) && !OTHER_WORD.test(t.split(/\s[-–—:]\s/)[0]) && !PLACE_WORD.test(t.split(/\s[-–—:]\s/)[0])) person += 3;
  else if (NAME_ONLY.test(t) && !OTHER_WORD.test(t) && !PLACE_WORD.test(t) && t.split(' ').length <= 3) person += 1;
  if (FIELD.test(body)) person += 2;
  if (((body.match(PRONOUN) ?? []).length) >= 3) person += 1;
  if (PLACE_WORD.test(t)) place += 2;
  if (LOCATED.test(body)) place += 2;
  if (OTHER_WORD.test(t)) other += 3;
  if (DIRECTIVE.test(body)) other += 1;
  if (/&|\band\b| и /.test(t) && !NAME_ROLE.test(t)) other += 1;
  const top = Math.max(person, place, other);
  if (top === 0) return { kind: 'other', conf: 0 };
  const kind = person === top ? 'person' : place === top ? 'place' : 'other';
  const second = [person, place, other].sort((a, b) => b - a)[1];
  return { kind, conf: Math.min(3, top - second) };
}

/** Имя человека или места из названия записи: «Anna - Village Baker» → «Anna»; «The Late Grandfather» остаётся как есть. */
export function nameFromTitle(title, kind = 'person') {
  const t = clip(title, 120);
  if (kind === 'person') {
    const head = t.split(/\s[-–—:]\s/)[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
    return clip(head || t, 80);
  }
  return clip(t.replace(/\s*\([^)]*\)\s*$/, '').replace(/^\s*(?:location|place|место)\s*[-–—:]\s*/i, ''), 80);
}

// ---------- запрос к модели ----------
const SYSTEM = 'You sort lorebook entries of a roleplay for a tool that builds character sheets and a place map. Output JSON only.';
export const BATCH = 40;

export function buildTriageRequest(batch) {
  const list = batch.map((e, i) => `${i + 1} | ${e.title} | ${clip(e.text, 170)}`).join('\n');
  const user = `Entries (number | title | start of text):
${list}

Decide for each entry:
- "person": ONE named individual character (an NPC, companion, enemy), alive, dead or absent.
- "place": a location: building, settlement, region, room, landmark.
- "other": world rules, lore topics, cultures, species, factions, groups, families, items, events, instructions, entries that describe several people.

Return JSON: {"items":[{"n":1,"kind":"person|place|other","name":"<personal name or place name without role or description>","parent":<number of another entry of this list that this place lies inside, or null>}]}
Rules: "name" is the short name in the language of the title ("Anna - Village Baker" gives "Anna"; "The Inherited Farmhouse" stays as is). "parent" only for places and only if the text clearly says it lies inside another listed place; otherwise null. Include every entry. Do not invent entries.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

/** Ответ модели → вердикты по записям пачки: { uid: { kind, name, parentUid } }. Лишнее и неверное отбрасывается. */
export function parseTriage(data, batch) {
  const out = {};
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const it of items) {
    const i = Math.trunc(Number(it?.n)) - 1;
    const e = batch[i];
    if (!e) continue;
    const kind = KINDS_TRIAGE.includes(it?.kind) ? it.kind : 'other';
    const name = clip(it?.name, 80);
    const pi = it?.parent == null ? -1 : Math.trunc(Number(it.parent)) - 1;
    const parent = kind === 'place' && pi >= 0 && pi !== i && batch[pi] ? batch[pi].uid : '';
    out[e.uid] = { kind, name: name.length >= 2 ? name : '', parentUid: parent };
  }
  return out;
}

/** Сводит оценку по признакам и ответ модели в план: модель главнее, если она ответила про запись. */
export function buildPlan(candidates, verdicts = {}) {
  const byUid = new Map(candidates.map(e => [e.uid, e]));
  return candidates.map(e => {
    const h = heuristicKind(e.title, e.text);
    const v = verdicts[e.uid];
    const kind = v ? v.kind : h.kind;
    const name = kind === 'other' ? '' : (v?.name || nameFromTitle(e.title, kind));
    const parentTitle = v?.parentUid ? byUid.get(v.parentUid)?.title ?? '' : '';
    return { uid: e.uid, title: e.title, snippet: clip(e.text, 110), kind, name, parentTitle, byModel: Boolean(v), sure: v ? v.kind === h.kind || h.conf < 2 : h.conf >= 2 };
  });
}

// ---------- подпись лорбука ----------
/** Какие записи уже видели: uid всех разбираемых записей. Новые записи это те, чьих uid в списке нет. */
export const seenUids = candidates => candidates.map(e => e.uid);
export const freshOf = (candidates, seen = []) => { const s = new Set(seen); return candidates.filter(e => !s.has(e.uid)); };
