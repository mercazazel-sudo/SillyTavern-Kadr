import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInventory, applyItemOp, undoItemOp, inventoryLines, sameItem, findItem, RULE } from '../src/core/inventory.js';
import { wantsItems, parseItems, buildItemsRequest, pickTasks } from '../src/core/chronicle.js';
import { normalizeRelations } from '../src/core/relations.js';
import { normalizeState, defaultState } from '../src/core/state.js';
import { buildSceneBlock, enabledLayers } from '../src/core/scene-text.js';
import { resolveTime } from '../src/core/clock.js';

const mk = (() => { let n = 0; return () => `n${++n}`; })();
const base = () => normalizeInventory([
  { id: 'a', name: 'Кинжал', qty: 1, ownerId: 'c2' }, { id: 'b', name: 'Зелье лечения', qty: 3, note: 'красное', ownerId: 'c2' }, { id: 'c', name: 'Верёвка', qty: 1, ownerId: '' },
  { id: 'a', name: 'дубль', ownerId: 'c3' }, { id: '', name: 'без id' }, { id: 'd', name: '', ownerId: 'c3' },
]);
const people = [{ id: 'c1', name: 'Лилит', persona: true, present: true }, { id: 'c2', name: 'Шэдоухарт', persona: false, present: true }, { id: 'c3', name: 'Астарион', persona: false, present: true }, { id: 'c4', name: 'Гейл', persona: false, present: false }];

test('список вещей: нормализация, названия вещей, поиск', () => {
  const inv = base();
  assert.deepEqual(inv.map(i => i.id), ['a', 'b', 'c']);
  assert.equal(normalizeInventory([{ id: 'x', name: 'Меч', qty: 0 }])[0].qty, 1);
  assert.equal(normalizeInventory([{ id: 'x', name: 'Меч', qty: 99999 }])[0].qty, 9999);
  assert.equal(sameItem('Зелье', 'зелье лечения'), true);
  assert.equal(sameItem('Нож', 'Ножны'), false);                              // короче четырёх знаков по вхождению не считается
  assert.equal(findItem(inv, 'c2', 'зелье')?.id, 'b');
  assert.equal(findItem(inv, 'c3', 'зелье'), null);
});

test('изменения вещей: получил, лишился, отдал, слияние, раздел стопки; отмена возвращает как было', () => {
  const inv = base();
  let r = applyItemOp(inv, { op: 'gain', name: 'зелье лечения', qty: 2, ownerId: 'c2' }, mk);
  assert.equal(r.items.find(i => i.id === 'b').qty, 5);                       // у владельца уже есть: количество растёт
  assert.deepEqual(undoItemOp(r.items, r).sort((x, y) => x.id.localeCompare(y.id)), inv);
  r = applyItemOp(inv, { op: 'gain', name: 'Ключ', ownerId: 'c3', note: 'ржавый' }, mk);
  assert.equal(r.items.length, 4);
  assert.deepEqual(undoItemOp(r.items, r).sort((x, y) => x.id.localeCompare(y.id)), inv);
  r = applyItemOp(inv, { op: 'lose', name: 'зелье', qty: 1, ownerId: 'c2' }, mk);
  assert.equal(r.items.find(i => i.id === 'b').qty, 2);
  r = applyItemOp(inv, { op: 'lose', name: 'кинжал', ownerId: 'c2' }, mk);
  assert.equal(r.items.some(i => i.id === 'a'), false);                       // последняя штука уходит из списка
  assert.deepEqual(undoItemOp(r.items, r).sort((x, y) => x.id.localeCompare(y.id)), inv);
  assert.equal(applyItemOp(inv, { op: 'lose', name: 'меч', ownerId: 'c2' }, mk).ok, false);   // нечего терять
  r = applyItemOp(inv, { op: 'give', name: 'Кинжал', ownerId: 'c2', toId: 'c3' }, mk);
  assert.equal(r.items.find(i => i.id === 'a').ownerId, 'c3');               // вся вещь меняет владельца
  r = applyItemOp(inv, { op: 'give', name: 'Зелье', qty: 1, ownerId: 'c2', toId: 'c3' }, mk);
  assert.equal(r.items.find(i => i.id === 'b').qty, 2);                       // часть стопки: у отдающего остаётся
  assert.equal(r.items.find(i => i.ownerId === 'c3' && i.name === 'Зелье лечения').qty, 1);
  assert.deepEqual(undoItemOp(r.items, r).sort((x, y) => x.id.localeCompare(y.id)), inv);
  const merged = applyItemOp(r.items, { op: 'give', name: 'Зелье', qty: 1, ownerId: 'c2', toId: 'c3' }, mk);
  assert.equal(merged.items.find(i => i.ownerId === 'c3' && i.name === 'Зелье лечения').qty, 2);   // у получателя такая же: складываются
  assert.equal(applyItemOp(inv, { op: 'give', name: 'Кинжал', ownerId: 'c2', toId: 'c2' }, mk).ok, false);
  assert.equal(applyItemOp(inv, { op: 'сломать', name: 'Кинжал', ownerId: 'c2' }, mk).ok, false);
});

test('строки рассказчику: только присутствующие и общие, количество и заметка', () => {
  const inv = normalizeInventory([...base(), { id: 'g', name: 'Свиток', ownerId: 'c4' }]);
  const lines = inventoryLines(inv, people, id => ({ c2: 'Шэдоухарт', c3: 'Астарион', c4: 'Гейл' })[id]);
  assert.deepEqual(lines, ['inventory[Шэдоухарт]: Кинжал; Зелье лечения x3 (красное)', 'inventory[party]: Верёвка']);   // Гейла нет в кадре
  assert.deepEqual(inventoryLines([], people, id => id), []);
  assert.equal(inventoryLines(inv, people, id => id, { maxChars: 40 }).length <= 1, true);
  const s = defaultState('harptos');
  const block = buildSceneBlock({ shortRules: false, state: s, time: resolveTime(s, 1), layers: enabledLayers({}, 'harptos'), inventoryLines: lines });
  assert.match(block, /inventory\[Шэдоухарт\]/);
  assert.ok(block.includes(`inventory rules: ${RULE}`));
  assert.deepEqual(normalizeState({ calendar: 'harptos' }).inventory, []);
});

test('Архивариус: фильтр вещей, запрос, проверка изменений', () => {
  assert.equal(wantsItems('Она протянула ему кинжал.'), true);
  assert.equal(wantsItems('Ветер шумел.'), false);
  const inv = base();
  assert.match(buildItemsRequest({ people, items: inv, reply: 'текст', userText: '' })[1].content, /Шэдоухарт: Кинжал; Зелье лечения x3/);
  const out = parseItems({ changes: [
    { op: 'give', item: 'кинжал', owner: 'Шэдоухарт', to: 'Лилит' }, { op: 'gain', item: 'Ключ от камеры', qty: 1, owner: 'Астарион', note: 'ржавый' },
    { op: 'lose', item: 'Меч', owner: 'Астарион' }, { op: 'give', item: 'Верёвка', owner: 'отряд', to: 'Гейл' }, { op: 'gain', item: 'Что-то', owner: 'Никто' }, { op: 'give', item: 'Кинжал', owner: 'Шэдоухарт', to: 'Шэдоухарт' },
    { op: 'взрыв', item: 'x', owner: 'Лилит' },
  ] }, { people, items: inv });
  assert.deepEqual(out.map(c => [c.op, c.name, c.ownerId, c.toId]), [['give', 'кинжал', 'c2', 'c1'], ['gain', 'Ключ от камеры', 'c3', ''], ['give', 'Верёвка', '', 'c4']]);
  assert.match(out[0].label, /Шэдоухарт отдаёт Лилит: кинжал/);
  // последовательность учитывается: отданное нельзя отдать второй раз
  const twice = parseItems({ changes: [{ op: 'give', item: 'Кинжал', owner: 'Шэдоухарт', to: 'Лилит' }, { op: 'give', item: 'Кинжал', owner: 'Шэдоухарт', to: 'Астарион' }] }, { people, items: inv });
  assert.equal(twice.length, 1);
  assert.deepEqual(pickTasks('Кинжал у неё.', { quests: [], cast: people, relations: normalizeRelations({}), knowledge: { deaths: {} } }, { items: true }), ['items']);
});

test('журнал изменений принимает вещи', () => {
  const r = normalizeRelations({ log: [{ id: 'g1', at: 3, kind: 'item', op: 'give', label: 'x', touched: ['a', 'b'], before: [{ id: 'a', name: 'Кинжал', qty: 1, ownerId: 'c2' }, { id: '', name: 'мусор' }] }, { id: 'g2', at: 4, kind: 'item', touched: [] }] });
  assert.deepEqual(r.log.map(e => e.id), ['g1']);
  assert.equal(r.log[0].before.length, 1);
});

import { SHORT_RULES } from '../src/core/scene-text.js';

test('краткие правила: втрое короче, смысл на месте, по умолчанию включены', () => {
  const s = defaultState('harptos');
  const args = { state: s, time: resolveTime(s, 1), layers: enabledLayers({}, 'harptos'), inventoryLines: ['inventory[A]: меч'], placeLines: ['place card[Лагерь]: тихо'] };
  const short = buildSceneBlock(args);
  const long = buildSceneBlock({ ...args, shortRules: false });
  assert.ok(short.includes(`inventory rules: ${SHORT_RULES.inventory}`));
  assert.ok(long.includes(`inventory rules: ${RULE}`));
  assert.ok(short.length < long.length - 200);
  assert.ok(Object.values(SHORT_RULES).every(r => r.length < 520 && /never/.test(r)));
});
