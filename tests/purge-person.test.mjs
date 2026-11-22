import test from 'node:test';
import assert from 'node:assert/strict';
import { purgePerson } from '../src/core/purge-person.js';

const make = () => ({
  cast: [{ id: 'a', name: 'Рафаил', present: true }, { id: 'b', name: 'Астарион', present: true }],
  bodies: { a: { wounds: [] }, b: { wounds: [] } },
  outfits: { a: {}, b: {} },
  inventory: [{ id: 'i1', ownerId: 'a' }, { id: 'i2', ownerId: 'b' }],
  quests: [{ id: 'q1', who: ['Рафаил', 'Астарион'] }, { id: 'q2', who: ['рафаил'] }],
  cards: { entered: { a: 3, b: 5 } },
  relations: {
    people: [{ id: 'a', name: 'Рафаил' }, { id: 'b', name: 'Астарион' }, { id: 'c', name: 'Гейл' }],
    lines: [{ id: 'l1', from: 'a', to: 'b' }, { id: 'l2', from: 'b', to: 'a' }, { id: 'l3', from: 'b', to: 'c' }],
    shared: [{ id: 's1', who: ['a', 'b'] }, { id: 's2', who: ['b', 'c'] }],
    triangles: [{ id: 't1', centerId: 'a', firstId: 'b', secondId: 'c' }, { id: 't2', centerId: 'c', firstId: 'b', secondId: 'b' }],
    headcanons: [{ id: 'h1', pair: 'a|b' }, { id: 'h2', pair: 'b|c' }],
  },
  knowledge: {
    events: [{ id: 'e1', witnessIds: ['a', 'b'] }, { id: 'e2', witnessIds: ['c'] }],
    learned: [{ id: 'n1', eventId: 'e2', entityId: 'a', source: 'told' }, { id: 'n2', eventId: 'e2', entityId: 'b', source: 'told', fromId: 'a' }],
    acquaintances: { 'a|b': 'known', 'b|c': 'seen' },
    deaths: { a: { note: 'х' } },
  },
});

test('purgePerson: человек уходит из состава, тела, одежды, вещей и карточек чата', () => {
  const s = make();
  purgePerson(s, 'a');
  assert.deepEqual(s.cast.map(p => p.id), ['b']);
  assert.equal(s.bodies.a, undefined);
  assert.equal(s.outfits.a, undefined);
  assert.equal(s.inventory[0].ownerId, '');
  assert.equal(s.inventory[1].ownerId, 'b');
  assert.equal(s.cards.entered.a, undefined);
  assert.equal(s.cards.entered.b, 5);
});

test('purgePerson: отношения, общие моменты, треугольники и хедканоны с ним уходят, чужие остаются', () => {
  const s = make();
  purgePerson(s, 'a');
  assert.deepEqual(s.relations.people.map(p => p.id), ['b', 'c']);
  assert.deepEqual(s.relations.lines.map(l => l.id), ['l3']);
  assert.deepEqual(s.relations.shared.map(x => x.id), ['s2']);
  assert.deepEqual(s.relations.triangles.map(t => t.id), ['t2']);
  assert.deepEqual(s.relations.headcanons.map(h => h.id), ['h2']);
});

test('purgePerson: знания: не свидетель, не «узнал», нет знакомств и смерти; ссылка «от кого» снимается', () => {
  const s = make();
  purgePerson(s, 'a');
  assert.deepEqual(s.knowledge.events[0].witnessIds, ['b']);
  assert.deepEqual(s.knowledge.learned.map(l => l.id), ['n2']);
  assert.equal('fromId' in s.knowledge.learned[0], false);
  assert.deepEqual(Object.keys(s.knowledge.acquaintances), ['b|c']);
  assert.equal(s.knowledge.deaths.a, undefined);
});

test('purgePerson: метки в квестах снимаются по имени без учёта регистра', () => {
  const s = make();
  purgePerson(s, 'a');
  assert.deepEqual(s.quests.map(q => q.who), [['Астарион'], []]);
});

test('purgePerson: неизвестный id ничего не ломает', () => {
  const s = make();
  const before = JSON.stringify(s);
  purgePerson(s, 'zzz');
  assert.equal(JSON.stringify(s), before);
});
