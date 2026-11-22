import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonObject, auxReady, AUX_DEFAULTS } from '../extension/src/llm.js';
import { wantsJournal, wantsRelations, pickTasks, parseJournal, parseRelations, buildJournalRequest, buildRelationsRequest, mentionedPeople, MAX_DELTA } from '../extension/src/core/chronicle.js';
import { normalizeQuests } from '../extension/src/core/journal.js';
import { normalizeRelations, emptyRelations } from '../extension/src/core/relations.js';

const quests = normalizeQuests([
  { id: 'q1', title: 'Поиски лекаря', status: 'active', goal: 'Найти лекаря.', leads: [{ id: 'l1', t: 'Кишка, торговка', state: 'open' }, { id: 'l2', t: 'Хальсин', state: 'work' }], entries: [] },
  { id: 'q2', title: 'Старое дело', status: 'done', leads: [], entries: [] },
]);
const cast = [
  { id: 'c1', name: 'Лилит', persona: true, present: true }, { id: 'c2', name: 'Шэдоухарт', persona: false, present: true },
  { id: 'c3', name: 'Астарион', persona: false, present: true }, { id: 'c4', name: 'Гейл', persona: false, present: false },
];

test('parseJsonObject: ограды, мусор вокруг, вложенность, строки со скобками, оборванный ответ', () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('Вот: {"a":{"b":[1,2]},"t":"фигурная } скобка"} конец'), { a: { b: [1, 2] }, t: 'фигурная } скобка' });
  assert.throws(() => parseJsonObject('нет json'), /нет JSON/);
  assert.throws(() => parseJsonObject('{"a": [1, 2'), /оборван/);
  assert.throws(() => parseJsonObject('{"a": 1,}'), /повреждён/);
});

test('подключение: готово только при заполненных полях выбранного режима', () => {
  assert.equal(auxReady(AUX_DEFAULTS), false);
  assert.equal(auxReady({ mode: 'profile', profileId: '' }), false);
  assert.equal(auxReady({ mode: 'profile', profileId: 'x' }), true);
  assert.equal(auxReady({ mode: 'custom', url: 'https://a', model: '' }), false);
  assert.equal(auxReady({ mode: 'custom', url: 'https://a', model: 'm' }), true);
});

test('фильтр журнала: слова зацепок, слова квестов, пустота', () => {
  assert.equal(wantsJournal('Хальсина они увидели у моста.', quests), true);   // падеж: основа «хальс»
  assert.equal(wantsJournal('Кишка приглашает зайти.', quests), true);
  assert.equal(wantsJournal('Она нашла старый ключ под половицей.', quests), true);
  assert.equal(wantsJournal('Ветер шумел в листве, огонь трещал.', quests), false);
  assert.equal(wantsJournal('', quests), false);
  assert.equal(wantsJournal('Старое дело всплыло', quests), false);              // закрытый квест слов не даёт
});

test('фильтр отношений: двое присутствующих, или один рядом с персоной; отсутствующий не считается', () => {
  const rel = emptyRelations();
  assert.equal(wantsRelations('Астарион усмехнулся Шэдоухарт.', cast, rel), true);
  assert.equal(wantsRelations('Астарион молча смотрит в огонь.', cast, rel), true);    // один и есть персона в кадре
  assert.equal(wantsRelations('Гейл что-то бормочет.', cast, rel), false);             // Гейла нет в кадре
  assert.equal(wantsRelations('Тишина.', cast, rel), false);
  assert.equal(wantsRelations('Астарион', cast.map(p => ({ ...p, persona: false })), rel), false);
  assert.deepEqual(mentionedPeople('Шэдоухарт', [{ id: 'c2', name: 'Шэдоухарт', aliases: [] }]), ['c2']);
  const tasks = pickTasks('Тишина.', { quests, cast, relations: rel }, { journal: true, relations: true });
  assert.deepEqual(tasks, []);
  assert.deepEqual(pickTasks('Тишина.', { quests, cast, relations: rel }, { journal: true, relations: true }, true), ['journal', 'relations']);
  assert.deepEqual(pickTasks('Кишка', { quests, cast, relations: rel }, { journal: false, relations: true }), []);
});

test('запросы: нумерация идущих квестов, только присутствующие, усечение длинного ответа', () => {
  const m = buildJournalRequest({ quests, reply: 'x'.repeat(9000), userText: 'я иду', dateLabel: '22 Элесиаса' });
  assert.equal(m[0].role, 'system');
  assert.match(m[1].content, /\[1\] Поиски лекаря — Найти лекаря\./);
  assert.match(m[1].content, /\(1\) Кишка, торговка \[open\]; \(2\) Хальсин \[work\]/);
  assert.doesNotMatch(m[1].content, /Старое дело/);
  assert.ok(m[1].content.length < 6500);
  const r = buildRelationsRequest({ present: cast.filter(p => p.present), lines: ['Шэдоухарт>Лилит;trust=20'], reply: 'ответ', userText: '', dateLabel: 'д' });
  assert.match(r[1].content, /Шэдоухарт, Астарион/);
  assert.doesNotMatch(r[1].content, /Гейл/);
  assert.match(r[1].content, /player character/);
});

test('разбор журнала: плохие номера, дубли квестов, неизменное состояние отбрасываются', () => {
  const data = {
    entries: [{ quest: 1, text: 'Нашли Кишку.' }, { quest: 7, text: 'мимо' }, { quest: 1, text: '' }],
    leads: [{ quest: 1, lead: 1, state: 'done', note: 'помогла' }, { quest: 1, lead: 2, state: 'work' }, { quest: 1, lead: 9, state: 'done' }, { quest: 1, lead: 1, state: 'взрыв' }],
    newQuests: [{ title: 'Поиски лекаря', goal: 'дубль' }, { title: 'Письмо для Лаэзель', goal: 'Передать письмо.', leads: ['Найти курьера'] }],
  };
  const out = parseJournal(data, quests);
  assert.deepEqual(out.map(p => p.kind), ['entry', 'lead', 'quest']);
  assert.equal(out[0].questId, 'q1');
  assert.deepEqual([out[1].leadId, out[1].state], ['l1', 'done']);
  assert.equal(out[2].title, 'Письмо для Лаэзель');
  assert.deepEqual(parseJournal({}, quests), []);
  assert.deepEqual(parseJournal(null, quests), []);
});

test('разбор отношений: имена, шкалы, потолок скачка, доказательство, персона', () => {
  const rel = normalizeRelations({ lines: [{ id: 'r1', from: 'c2', to: 'c1', scales: { trust: 20 } }] });
  const data = { changes: [
    { from: 'Шэдоухарт', to: 'Лилит', scale: 'trust', delta: 40, evidence: 'отдала ей кинжал', memory: 'кинжал' },
    { from: 'Астарион', to: 'Шэдоухарт', scale: 'respect', delta: -3, evidence: 'огрызнулся' },
    { from: 'Лилит', to: 'Астарион', scale: 'love', delta: 5, evidence: 'улыбнулась' },          // персона
    { from: 'Гейл', to: 'Лилит', scale: 'trust', delta: 5, evidence: 'x' },                       // не в кадре
    { from: 'Шэдоухарт', to: 'Лилит', scale: 'нет', delta: 5, evidence: 'x' },
    { from: 'Шэдоухарт', to: 'Лилит', scale: 'fear', delta: 0, evidence: 'x' },
    { from: 'Шэдоухарт', to: 'Лилит', scale: 'fear', delta: 5, evidence: '' },
    { from: 'Шэдоухарт', to: 'Лилит', scale: 'trust', delta: 3, evidence: 'дубль' },
  ] };
  const out = parseRelations(data, { cast, lines: rel.lines });
  assert.equal(out.length, 2);
  assert.equal(out[0].delta, MAX_DELTA);
  assert.match(out[0].label, /доверие 20 → 35/i);
  assert.equal(out[0].memory, 'кинжал');
  assert.deepEqual([out[1].fromId, out[1].toId, out[1].delta], ['c3', 'c2', -3]);
  assert.deepEqual(parseRelations({ changes: 'мусор' }, { cast, lines: [] }), []);
});

import { wantsScene, sceneRoster, buildSceneRequest, parseScene } from '../extension/src/core/chronicle.js';

test('кто в кадре: фильтр, запрос, разбор (пришёл, ушёл, персона и мёртвые не трогаются)', () => {
  const rel = normalizeRelations({ people: [{ id: 'c5', name: 'Карлах', aliases: ['Карла'] }, { id: 'c6', name: 'Вилл' }] });
  const k = { deaths: { c6: { note: 'погиб' } } };
  assert.equal(wantsScene('Карлах вошла в лагерь и села у огня.', cast, rel, k), true);        // известная, но не в кадре
  assert.equal(wantsScene('Шэдоухарт ушла в темноту, не оглянувшись.', cast, rel, k), true);    // уход присутствующей
  assert.equal(wantsScene('Шэдоухарт молчит и смотрит на огонь.', cast, rel, k), false);
  assert.equal(wantsScene('Вилл не вернётся.', cast, rel, k), false);                           // мёртвый не в счёт
  const roster = sceneRoster(cast, rel, k);
  assert.ok(!roster.some(p => p.id === 'c6'));
  assert.ok(roster.some(p => p.id === 'c5' && !p.present));
  assert.match(buildSceneRequest({ roster, reply: 'текст', userText: '' })[1].content, /Карлах \(also written: Карла\): currently absent/);
  const out = parseScene({ present: ['Лилит', 'Астарион', 'Карлах'] }, roster);
  assert.deepEqual(out.map(p => [p.kind, p.personId]), [['leave', 'c2'], ['arrive', 'c5']]);     // Шэдоухарт ушла, Карлах пришла; Лилит (персона) на месте
  assert.deepEqual(parseScene({ present: [] }, roster), []);                                   // пустой ответ: не доверяем
  assert.deepEqual(parseScene({ present: ['Никто'] }, roster), []);
  assert.deepEqual(parseScene({ present: ['Астарион'] }, roster).map(p => p.personId), ['c2']);  // уход только непремерных; персону не убирает
  assert.deepEqual(pickTasks('Карлах вошла.', { quests: [], cast, relations: rel, knowledge: k }, { scene: true }), ['scene']);
});

test('журнал изменений нормализуется: мусор и неизвестные шкалы отбрасываются', () => {
  const r = normalizeRelations({ log: [
    { id: 'g1', at: 4, kind: 'rel', fromId: 'c2', toId: 'c1', scale: 'trust', delta: 7.4, label: 'ok', memoryId: 'm' },
    { id: 'g2', at: 5, kind: 'rel', fromId: 'c2', toId: 'c1', scale: 'нет', delta: 1 }, { id: 'g3', at: -1, kind: 'cast', personId: 'c3' },
    { id: 'g4', at: 6, kind: 'cast', personId: 'c3', wasPresent: true, joined: false }, { id: 'g1', at: 1, kind: 'cast', personId: 'c1' }, { id: 'g5', at: 7, kind: 'взрыв' },
  ] });
  assert.deepEqual(r.log.map(e => e.id), ['g1', 'g4']);
  assert.equal(r.log[0].delta, 7);
  assert.equal(r.log[1].wasPresent, true);
});

import { newNameCandidates } from '../extension/src/core/chronicle.js';

test('новые герои: кандидаты по заглавным словам в середине предложения', () => {
  const roster = sceneRoster(cast, normalizeRelations({}), { deaths: {} });
  const text = 'Дверь скрипнула. — Здравствуйте, — сказал Элминстер, входя. Шэдоухарт напряглась. Рядом шла Тамара, а позади Лилит. Они вышли к Врата Балдура и Тёмному Порыву.';
  const c = newNameCandidates(text, roster, {});
  assert.ok(c.includes('Элминстер') && c.includes('Тамара'));
  assert.ok(!c.includes('Дверь') && !c.includes('Здравствуйте'));        // начало предложения и начало реплики
  assert.ok(!c.includes('Шэдоухарт') && !c.includes('Лилит'));            // известные
  assert.ok(!newNameCandidates(text, roster, { Элминстер: 2, Тамара: 2, Врата: 2, Балдура: 2, Тёмному: 2, Порыву: 2 }).length);   // дважды проверенные не тревожат
  assert.equal(wantsScene('Рядом шла Тамара.', cast, normalizeRelations({}), { deaths: {} }), true);
  assert.equal(wantsScene('Рядом шла она.', cast, normalizeRelations({}), { deaths: {} }), false);
});

test('новые герои: разбор ответа модели, имя должно быть в тексте, известные и выдумки отбрасываются', () => {
  const roster = sceneRoster(cast, normalizeRelations({}), { deaths: {} });
  const reply = 'Рядом шла Тамара, а позади Лилит и Астарион.';
  const out = parseScene({ present: ['Лилит', 'Астарион', 'Шэдоухарт'], new: [
    { name: 'Тамара', aliases: ['Тама'], present: true }, { name: 'Призрак', present: true }, { name: 'Астарион', present: true }, { name: 'Р2Д2', present: true }, { name: '', present: true },
  ] }, roster, reply);
  const np = out.filter(p => p.kind === 'newperson');
  assert.deepEqual(np.map(p => [p.name, p.present, p.aliases]), [['Тамара', true, ['Тама']]]);
  assert.deepEqual(parseScene({ present: [], new: [{ name: 'Тамара' }] }, roster, reply).map(p => p.kind), ['newperson']);   // пустой состав не мешает новым
  assert.deepEqual(parseScene({ new: [{ name: 'Тамара', present: false }] }, roster, reply)[0].present, false);
});

import { wantsTraces, parseTraces, buildTracesRequest } from '../extension/src/core/chronicle.js';

test('приметы и раны: фильтр, запрос, проверка ответа модели', () => {
  assert.equal(wantsTraces('На шее остался след от клыков.'), true);
  assert.equal(wantsTraces('Рубаха вымокла под ливнем.'), true);
  assert.equal(wantsTraces('Они тихо шли по дороге.'), false);
  const ppl = [{ id: 'c1', name: 'Лилит', persona: true }, { id: 'c2', name: 'Шэдоухарт', persona: false }];
  const bodies = { c1: { wounds: [], conds: [{ id: 'k1', t: 'след от укуса на шее', left: 2 }] }, c2: { wounds: ['порез на руке'], conds: [] } };
  const req = buildTracesRequest({ people: ppl, bodies, reply: 'текст', userText: '', dateLabel: 'д' })[1].content;
  assert.match(req, /Лилит \(player character\): след от укуса на шее \(2 d left\)/);
  assert.match(req, /Шэдоухарт: wound: порез на руке/);
  const out = parseTraces({ changes: [
    { who: 'Шэдоухарт', kind: 'mark', text: 'рубаха вымокла под ливнем', days: 1 },
    { who: 'Лилит', kind: 'mark', text: 'следы от укуса на шее', days: 3 },                         // уже есть похожий
    { who: 'Лилит', kind: 'clear', text: 'след от укуса на шее' },
    { who: 'Шэдоухарт', kind: 'wound', text: 'глубокий порез на бедре', zone: 'legL', severity: 9 },
    { who: 'Шэдоухарт', kind: 'wound', text: 'порез на руке', zone: 'armL', severity: 1 },          // уже есть похожая рана
    { who: 'Никто', kind: 'mark', text: 'что-то такое' }, { who: 'Лилит', kind: 'clear', text: 'ничего подобного нет' }, { who: 'Лилит', kind: 'взрыв', text: 'ааа' },
    { who: 'Шэдоухарт', kind: 'mark', text: 'ок' },
  ] }, { people: ppl, bodies });
  assert.deepEqual(out.map(c => [c.op, c.personId]), [['mark', 'c2'], ['clear', 'c1'], ['wound', 'c2']]);
  assert.equal(out[0].days, 1);
  assert.equal(out[1].condId, 'k1');
  assert.deepEqual([out[2].zone, out[2].sev], ['legL', 3]);                                       // тяжесть ограничена тремя
});

test('журнал изменений принимает записи тела', () => {
  const r = normalizeRelations({ log: [{ id: 'g1', at: 2, kind: 'body', personId: 'c2', add: { conds: ['k1'], wounds: [] }, removed: [{ id: 'k0', t: 'мокрая', until: { year: 1492, doy: 5 } }], prevTier: 1 }, { id: 'g2', at: 3, kind: 'body', personId: 'c2', add: {}, removed: [] }] });
  assert.deepEqual(r.log.map(e => e.id), ['g1']);
  assert.equal(r.log[0].removed[0].until.doy, 5);
  assert.equal(r.log[0].prevTier, 1);
});

import { wantsPlace, parsePlace, buildPlaceRequest } from '../extension/src/core/chronicle.js';
import { normalizeLibrary as normPlaceLib, normalizeMap as normPlaceMap, allNodes as allPlaceNodes } from '../extension/src/core/places.js';

test('место: фильтр, запрос, проверка ответа (известное, новое с родителем, находки, повторы)', () => {
  assert.equal(wantsPlace('Они вошли в деревню.'), true);
  assert.equal(wantsPlace('Она смотрела вдаль.'), false);
  const lib = normPlaceLib({ nodes: [{ id: 'f', name: 'Папка', kind: 'folder' }, { id: 'p1', name: 'Побережье Мечей', parentId: 'f', traits: ['галька'] }, { id: 'p2', name: 'Лагерь', parentId: 'p1', aliases: ['лагерная стоянка'], traits: ['костёр'] }] });
  const map = normPlaceMap({ current: 'p2', over: { p2: { traits: [], notes: ['мост обрушился'] } } });
  const nodes = allPlaceNodes(lib, map);
  const req = buildPlaceRequest({ nodes, current: 'p2', reply: 'текст', userText: '' })[1].content;
  assert.match(req, /Побережье Мечей › Лагерь  <- the party is here now/);
  assert.doesNotMatch(req, /Папка/);                                            // папки не места
  const ctx = { nodes, current: 'p2', over: map.over };
  let out = parsePlace({ current: { name: 'Заражённая деревня', parent: 'Побережье' }, traits: [{ place: 'Заражённая деревня', text: 'разбитые ставни' }, { place: 'Лагерь', text: 'костёр' }], notes: [{ place: 'Лагерь', text: 'мост обрушился' }, { place: 'Нигде', text: 'мимо' }] }, ctx)[0];
  assert.deepEqual(out.current, { id: '', name: 'Заражённая деревня', parentId: 'p1' });   // новое место внутри известного
  assert.deepEqual(out.traits.map(t => [t.placeName, t.text]), [['Заражённая деревня', 'разбитые ставни']]);   // «костёр» уже есть
  assert.deepEqual(out.notes, []);                                              // перемена уже записана, неизвестное место отброшено
  out = parsePlace({ current: { name: 'лагерная стоянка' }, traits: [{ place: 'Лагерь', text: 'туман у воды' }] }, ctx);
  assert.equal(out[0].current, null);                                           // уже здесь: сцена не меняется
  assert.equal(out[0].traits[0].placeId, 'p2');
  out = parsePlace({ current: { name: 'Побережье Мечей' } }, ctx)[0];
  assert.deepEqual(out.current, { id: 'p1', name: 'Побережье Мечей' });
  assert.deepEqual(parsePlace({ current: { name: 'Он пошёл. Куда-то там далеко' } }, ctx), []);   // не название
  assert.deepEqual(parsePlace({}, ctx), []);
});

import { wantsKnowledge, parseKnowledge, buildKnowledgeRequest } from '../extension/src/core/chronicle.js';
import { normalizeKnowledge as normKnow } from '../extension/src/core/secrets.js';

test('моменты: воспоминания и напряжения пар из ответа; повторы и одиночки отбрасываются', () => {
  const ppl = [{ id: 'c1', name: 'Лилит', persona: true, present: true }, { id: 'c2', name: 'Шэдоухарт', persona: false, present: true }, { id: 'c3', name: 'Астарион', persona: false, present: true }];
  const shared = [{ id: 's1', kind: 'memory', text: 'Шэдоухарт и Лилит бежали с наутилоида', who: ['c1', 'c2'], disabled: false }];
  const out = parseRelations({ changes: [], moments: [
    { between: ['Шэдоухарт', 'Лилит'], kind: 'memory', text: 'Шэдоухарт и Лилит бежали с наутилоида вместе', intensity: 4 },   // повтор
    { between: ['Астарион', 'Лилит'], kind: 'tension', text: 'Астарион не поверил обещанию Лилит и ждёт подвоха', intensity: 9 },
    { between: ['Астарион', 'Астарион'], kind: 'memory', text: 'сам с собой тут нет смысла' }, { between: ['Астарион', 'Никто'], kind: 'memory', text: 'выдуманный участник' },
    { between: ['Астарион', 'Шэдоухарт'], kind: 'взрыв', text: 'неизвестный вид момента тут' }, { between: ['Астарион', 'Шэдоухарт'], kind: 'memory', text: 'коротко' },
  ] }, { cast: ppl, lines: [], shared });
  assert.deepEqual(out.map(m => [m.kind, m.mkind, m.who, m.intensity]), [['moment', 'tension', ['c3', 'c1'], 5]]);
  assert.match(out[0].label, /^Напряжение \(Астарион и Лилит\)/);
  assert.match(buildRelationsRequest({ present: ppl, lines: [], reply: 'т', userText: '', dateLabel: 'д' })[1].content, /"moments"/);
});

test('журнал изменений принимает записи моментов и квестов', () => {
  const r = normalizeRelations({ log: [
    { id: 'g1', at: 1, kind: 'moment', sharedId: 's9', removed: { id: 's1', kind: 'memory', text: 'старое', who: ['c1', 'c2'] } }, { id: 'g2', at: 2, kind: 'moment' },
    { id: 'g3', at: 3, kind: 'quest', questId: 'q1', entryId: 'e1' }, { id: 'g4', at: 4, kind: 'quest', questId: 'q1', leadId: 'l1', prevState: 'open', prevNote: 'было' }, { id: 'g5', at: 5, kind: 'quest' },
  ] });
  assert.deepEqual(r.log.map(e => e.id), ['g1', 'g3', 'g4']);
  assert.equal(r.log[0].removed.text, 'старое');
  assert.equal(r.log[2].prevState, 'open');
});

import { storyText } from '../extension/src/core/story.js';

test('рассказ без служебного блока анализа', () => {
  assert.equal(storyText('<rp_preflight> [ANCHOR] Setting: подвал. Present: Астарион </rp_preflight>Чугунный боек вошёл в кладку.'), 'Чугунный боек вошёл в кладку.');
  assert.equal(storyText('Начало.<details><summary>x</summary>скрыто</details> Конец.'), 'Начало. Конец.');
  assert.equal(storyText('Текст <rp_preflight> не закрыт и тянется'), 'Текст');
  assert.equal(storyText('<think>размышление</think>Ответ.'), 'Ответ.');
  assert.equal(storyText(null), '');
  assert.equal(pickTasks('Тишина.', { quests: [], cast: [], relations: normalizeRelations({}), knowledge: { deaths: {} } }, { items: true }).includes('items'), true);          // вещи ищутся в каждом ответе
  assert.equal(pickTasks('Тишина.', { quests: [], cast: [], relations: normalizeRelations({}), knowledge: { deaths: {} } }, { items: true, itemsAlways: false }).includes('items'), false);
});

import { planRequests, mergeRequests, GROUPS, buildItemsRequest } from '../extension/src/core/chronicle.js';
import { isRateLimit } from '../extension/src/llm.js';

test('запросы группами: раскладка, склейка без дублей ответа, разбор по ключам', () => {
  const tasks = ['scene', 'relations', 'know', 'journal', 'items', 'body', 'place'];
  assert.deepEqual(planRequests(tasks, 'grouped'), [['scene', 'relations', 'know', 'journal'], ['items', 'body', 'place']]);
  assert.deepEqual(planRequests(tasks, 'split').length, 7);
  assert.deepEqual(planRequests(tasks, 'single'), [tasks]);
  assert.deepEqual(planRequests(['items'], 'grouped'), [['items']]);                                    // одна задача идёт как раньше
  assert.deepEqual(planRequests([], 'grouped'), []);
  assert.ok(Object.values(GROUPS).flat().length === 7);
  const ppl = [{ id: 'c1', name: 'Лилит', persona: true, present: true }, { id: 'c2', name: 'Шэдоухарт', persona: false, present: true }];
  const reply = 'Шэдоухарт протянула Лилит кинжал и призналась в обмане.'.repeat(20);
  const a = { name: 'relations', messages: buildRelationsRequest({ present: ppl, lines: [], reply, userText: 'я смотрю', dateLabel: 'д' }) };
  const b = { name: 'items', messages: buildItemsRequest({ people: ppl, items: [], reply, userText: 'я смотрю', dateLabel: 'д' }) };
  const solo = mergeRequests([a]);
  assert.equal(solo.keyed, false);
  const merged = mergeRequests([a, b]);
  assert.equal(merged.keyed, true);
  const text = merged.messages[1].content;
  assert.equal(text.split(reply).length - 1, 1);                                                          // ответ рассказчика один раз, а не по разу на задачу
  assert.match(text, /### TASK "relations"/);
  assert.match(text, /### ANSWER FORMAT AND RULES for "items"/);
  assert.match(text, /"moments"/);
  assert.match(text, /keys are exactly: "relations", "items"/);
  assert.ok(text.length < a.messages[1].content.length + b.messages[1].content.length);
  assert.equal(isRateLimit(new Error('Вспомогательный API: код 429 Too Many Requests')), true);
  assert.equal(isRateLimit(new Error('rate limit exceeded')), true);
  assert.equal(isRateLimit(new Error('HTTP 400 bad request')), false);
});
