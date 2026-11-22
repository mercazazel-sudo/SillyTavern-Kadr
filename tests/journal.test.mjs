import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { STATUSES, STATUS_RU, NEXT_LEAD, normalizeQuests, sortedEntries, lastEntry, openLeads, questLines, QUEST_RULE, isOpenStatus } from '../src/core/journal.js';
import { questsFromKulisy } from '../src/core/kulisy-import.js';
import { defaultState, normalizeState } from '../src/core/state.js';
import { buildSceneBlock, enabledLayers } from '../src/core/scene-text.js';
import { resolveTime } from '../src/core/clock.js';

const d = (doy, year = 1492) => ({ year, doy });
const quest = (extra = {}) => ({
  id: 'q1', title: 'Найти лекаря', status: 'active', tracked: true, goal: 'Найти того, кто вылечит рану.', who: ['Тав', 'Шэдоухарт'],
  leads: [{ id: 'l1', t: 'Нетти, знахарка', state: 'dead', note: 'не смогла помочь, погибла' }, { id: 'l2', t: 'Кишка', state: 'open' }, { id: 'l3', t: 'Хальсин', state: 'work' }, { id: 'l4', t: 'Жрица', state: 'done' }],
  entries: [{ id: 'e1', date: d(40), minutes: 1080, t: 'Рана не заживает.' }, { id: 'e2', date: d(42), minutes: 600, t: 'Нетти больше нет.' }, { id: 'e3', date: d(42), minutes: 1260, t: 'Остались три пути.' }], ...extra,
});

test('статусы и состояния зацепок', () => {
  assert.deepEqual(STATUSES, ['active', 'paused', 'done', 'failed', 'dropped']);
  assert.equal(STATUS_RU.done, 'выполнен');
  assert.equal(isOpenStatus('paused'), true);
  assert.equal(isOpenStatus('done'), false);
  assert.deepEqual(['open', 'work', 'done', 'dead'].map(s => NEXT_LEAD[s]), ['work', 'done', 'dead', 'open']);
});

test('записи сортируются от новых к старым; без даты это самые старые', () => {
  const q = quest({ entries: [{ id: 'a', date: d(42), minutes: 600, t: 'утро' }, { id: 'b', date: null, minutes: null, t: 'без даты' }, { id: 'c', date: d(42), minutes: 1260, t: 'вечер' }, { id: 'd', date: d(40), minutes: null, t: 'раньше' }] });
  assert.deepEqual(sortedEntries(q).map(e => e.id), ['c', 'a', 'd', 'b']);
  assert.equal(lastEntry(q).id, 'c');
  assert.equal(lastEntry({ entries: [] }), null);
  const tie = quest({ entries: [{ id: 'x', date: d(5), minutes: 100, t: 'первая' }, { id: 'y', date: d(5), minutes: 100, t: 'вторая' }] });
  assert.equal(lastEntry(tie).id, 'y');                                           // при равенстве позже добавленная новее
});

test('normalizeQuests: мусор, повторы, лимиты, одна отслеживаемая', () => {
  const raw = [quest(), quest({ id: 'q2', title: 'Письмо', tracked: true }), quest({ id: 'q1', title: 'Дубль' }), { id: 'q3', title: '' }, { title: 'нет id' }, null, quest({ id: 'q4', title: 'Ключ', status: 'done', tracked: true }), quest({ id: 'q5', title: 'Статус', status: 'взрыв' })];
  const out = normalizeQuests(raw);
  assert.deepEqual(out.map(q => q.id), ['q1', 'q2', 'q4', 'q5']);
  assert.deepEqual(out.map(q => q.tracked), [true, false, false, false]);      // отслеживается один, закрытый не может
  assert.equal(out[3].status, 'active');
  assert.equal(normalizeQuests('мусор').length, 0);
  const noisy = normalizeQuests([quest({ leads: [{ id: 'l', t: '' }, { id: 'l', t: 'ок', state: 'нет' }, { id: 'l', t: 'повтор' }], entries: [{ id: 'e', t: 'ok', date: { year: 1492, doy: -3 }, minutes: 99999 }] })]);
  assert.equal(noisy[0].leads.length, 1);
  assert.equal(noisy[0].leads[0].state, 'open');
  assert.equal(noisy[0].entries[0].date, null);
  assert.equal(noisy[0].entries[0].minutes, null);
  assert.equal(normalizeQuests(Array.from({ length: 100 }, (_, i) => ({ id: 'q' + i, title: 'T' + i }))).length, 60);
});

test('строки для рассказчика: только идущие, отслеживаемый первым', () => {
  const quests = normalizeQuests([quest({ id: 'a', title: 'Письмо', tracked: false, goal: 'Передать письмо.', who: [], leads: [], entries: [] }), quest(), quest({ id: 'd', title: 'Старое', status: 'done', tracked: false })]);
  const lines = questLines(quests);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^quest\[Найти лекаря\] \(main\): Найти того, кто вылечит рану\. \| involves: Тав, Шэдоухарт \| latest: Остались три пути\. \| open leads: Кишка; Хальсин \(in progress\) \| closed leads: Нетти, знахарка \(не смогла помочь, погибла\); Жрица \(done\)$/);
  assert.match(lines[1], /^quest\[Письмо\]: Передать письмо\.$/);
  assert.equal(questLines([]).length, 0);
  assert.equal(questLines(quests, { max: 1 }).length, 1);
  assert.equal(openLeads(quests[1]).length, 2);
});

test('блок рассказчику: квесты и правила', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 40, minutes: 600 };
  s.quests = normalizeQuests([quest()]);
  const time = resolveTime(s, 1);
  const block = buildSceneBlock({ shortRules: false, state: s, time, layers: enabledLayers({}, 'harptos'), questLines: questLines(s.quests) });
  assert.match(block, /quest\[Найти лекаря\] \(main\)/);
  assert.ok(block.includes(`quest rules: ${QUEST_RULE}`));
  assert.doesNotMatch(buildSceneBlock({ shortRules: false, state: s, time, layers: enabledLayers({}, 'harptos') }), /quest/);
  assert.equal(normalizeState({ calendar: 'harptos', quests: [quest()] }).quests.length, 1);
  assert.deepEqual(defaultState('harptos').quests, []);
});

test('квесты Кулис → журнал: шаги, итог, награда, даты', () => {
  const dayOne = { year: 1492, doy: 234 };
  const ku = { entities: { e1: { name: 'Лилит' } }, world: { quests: [
    { id: 'a', name: 'Поиски лекаря', status: 'active', text: 'Найти лекаря.', steps: [{ text: 'Найти лекаря на побережье', done: true }, { text: 'Расспросить жрицу', done: false }], startedDay: 1, participantIds: ['e1', 'нет'] },
    { id: 'b', name: 'Кага', status: 'done', text: 'Остановить Кагу.', steps: [{ text: 'Исследовать план', done: false }], startedDay: 1, closedDay: 3, outcome: 'Кагу остановили', reward: { text: 'наручи воина' } },
    { id: 'c', name: '', status: 'active' }, { id: 'd', name: 'Отложен', status: 'paused', steps: [] },
  ] } };
  const list = questsFromKulisy(ku, 'harptos', dayOne);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0].leads.map(l => l.state), ['done', 'open']);
  assert.deepEqual(list[0].who, ['Лилит']);
  assert.deepEqual(list[0].entries[0].date, { year: 1492, doy: 234 });             // день 1
  assert.equal(list[1].status, 'done');
  assert.equal(list[1].leads[0].state, 'dead');                                    // несделанный шаг закрытого квеста
  assert.deepEqual(list[1].entries.map(e => e.t), ['Остановить Кагу.', 'Итог: Кагу остановили', 'Награда: наручи воина']);
  assert.deepEqual(list[1].entries[1].date, { year: 1492, doy: 236 });             // день 3
  assert.equal(list[2].status, 'paused');
  assert.deepEqual(questsFromKulisy({}, 'harptos', dayOne), []);
  const noDays = questsFromKulisy({ world: { quests: [{ name: 'X', status: 'active', text: 'суть', steps: [] }] } }, 'harptos', dayOne);
  assert.equal(noDays[0].entries[0].date, null);
});

const exportPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'exports', 'local-only-export.json');
test('экспорт Нарратора1: семь квестов переносятся и проходят нормализацию', { skip: !existsSync(exportPath) }, () => {
  const ku = JSON.parse(readFileSync(exportPath, 'utf8')).kulisy;
  const list = questsFromKulisy(ku, 'harptos', { year: 1492, doy: 234 }).map((q, i) => ({ ...q, id: 'q' + i, leads: q.leads.map((l, j) => ({ ...l, id: `l${i}_${j}` })), entries: q.entries.map((e, j) => ({ ...e, id: `e${i}_${j}` })) }));
  const quests = normalizeQuests(list);
  assert.equal(quests.length, 7);
  assert.deepEqual(quests.map(q => q.status), ['active', 'active', 'done', 'done', 'done', 'done', 'done']);
  assert.ok(quests[2].entries.some(e => e.t.startsWith('Итог:')));
  assert.equal(questLines(quests).length, 2);
});
