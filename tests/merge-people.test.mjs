import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePeople } from '../src/core/merge-people.js';

const base = () => ({
  cast: [{ id: 'lil', name: 'Лилит', persona: true, present: true }, { id: 'ast', name: 'Astarion Ancunín', persona: false, present: true }],
  bodies: { ast: { tier: 0 }, rus: { tier: 2 } },
  inventory: [{ id: 'i1', name: 'Кинжал', ownerId: 'rus' }],
  relations: {
    people: [{ id: 'rus', name: 'Астарион', aliases: ['Аст'] }],
    lines: [{ id: 'l1', from: 'rus', to: 'lil' }, { id: 'l2', from: 'lil', to: 'rus' }, { id: 'l3', from: 'ast', to: 'lil' }],
    headcanons: [{ id: 'h', pair: ['lil', 'rus'].sort().join('|'), text: 'держит дистанцию' }],
    triangles: [{ id: 't', centerId: 'rus', firstId: 'lil', secondId: 'ast' }],
    log: [],
  },
  knowledge: { events: [{ id: 'e', witnessIds: ['rus', 'ast'] }], learned: [{ eventId: 'e', entityId: 'rus' }, { eventId: 'e', entityId: 'ast' }], acquaintances: { [['lil', 'rus'].sort().join('|')]: 'known' }, deaths: {} },
  cards: { ids: [], entered: { rus: 5 } }, fate: {},
});

test('объединение: чувства, вещи, знания и имена лишнего переходят к основному, повторы не множатся', () => {
  const s = base();
  const r = mergePeople(s, 'ast', 'rus');
  assert.equal(r.ok, true);
  assert.deepEqual(s.relations.people.map(p => p.id), ['ast']);
  assert.deepEqual(s.relations.people[0].aliases.sort(), ['Аст', 'Астарион']);
  assert.deepEqual(s.relations.lines.map(l => `${l.from}>${l.to}`).sort(), ['ast>lil', 'lil>ast']);   // ast>lil уже была: из rus>lil повтор отброшен
  assert.equal(s.inventory[0].ownerId, 'ast');
  assert.deepEqual(s.knowledge.events[0].witnessIds, ['ast']);
  assert.equal(s.knowledge.learned.length, 1);
  assert.deepEqual(Object.keys(s.knowledge.acquaintances), [['ast', 'lil'].sort().join('|')]);
  assert.equal(s.relations.headcanons[0].pair, ['ast', 'lil'].sort().join('|'));
  assert.equal(s.relations.triangles.length, 0);                      // центр и «второй» стали одним человеком: треугольник теряет смысл
  assert.equal(s.cards.entered.ast, 5);
  assert.equal(s.bodies.ast.tier, 0); assert.equal(s.bodies.rus, undefined);
});
test('объединение: нельзя с самим собой и с неизвестным', () => {
  assert.equal(mergePeople(base(), 'ast', 'ast').ok, false);
  assert.equal(mergePeople(base(), 'ast', 'нет').ok, false);
});
