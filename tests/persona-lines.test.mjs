import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePersonaLines, relationLines, normalizeRelations, emptyRelations } from '../src/core/relations.js';

let n = 0;
const newId = p => `${p}${++n}`;
const mk = () => ({
  cast: [
    { id: 'me', name: 'Игрок', persona: true, present: true },
    { id: 'a', name: 'Анна', persona: false, present: true },
    { id: 'b', name: 'Борис', persona: false, present: false },
    { id: 'd', name: 'Давний', persona: false, present: false },
  ],
  relations: emptyRelations(),
  knowledge: { deaths: { d: { note: '' } } },
});

test('каждому герою заводится линия к персоне, умершему и персоне нет', () => {
  const st = mk();
  assert.equal(ensurePersonaLines(st, newId), 2);
  assert.deepEqual(st.relations.lines.map(l => `${l.from}>${l.to}`).sort(), ['a>me', 'b>me']);
  assert.equal(ensurePersonaLines(st, newId), 0);                 // второй раз ничего не добавляет
});

test('линии от персоны не заводятся никогда', () => {
  const st = mk();
  ensurePersonaLines(st, newId);
  assert.equal(st.relations.lines.some(l => l.from === 'me'), false);
});

test('без персоны ничего не заводится', () => {
  const st = mk();
  st.cast = st.cast.filter(p => !p.persona);
  assert.equal(ensurePersonaLines(st, newId), 0);
});

test('пустая линия рассказчику не уходит, заполненная уходит', () => {
  const st = mk();
  ensurePersonaLines(st, newId);
  const cast = st.cast.map(p => ({ ...p, present: true }));
  assert.equal(relationLines(st.relations, cast).kept?.length ?? relationLines(st.relations, cast).length ?? 0, 0);
  st.relations.lines.find(l => l.from === 'a').scales.trust = 40;
  const out = relationLines(st.relations, cast);
  const text = JSON.stringify(out);
  assert.match(text, /Анна>Игрок/);
  assert.doesNotMatch(text, /Борис>Игрок/);
});

test('линии к персоне переживают нормализацию', () => {
  const st = mk();
  ensurePersonaLines(st, newId);
  const norm = normalizeRelations(JSON.parse(JSON.stringify(st.relations)));
  assert.equal(norm.lines.length, 2);
});
