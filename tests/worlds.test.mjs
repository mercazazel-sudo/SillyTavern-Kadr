import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, switchWorld, defaultState } from '../src/core/state.js';

const played = () => normalizeState({
  calendar: 'harptos', place: 'Врата Балдура', start: { year: 1492, doy: 40, minutes: 600 },
  cast: [{ id: 'a', name: 'Астарион', persona: false, present: true }, { id: 'u', name: 'Лилит', persona: true, present: true }],
  relations: { people: [{ id: 'g', name: 'Гейл', aliases: ['Gale'] }] },
  quests: [{ id: 'q1', title: 'Найти кольцо', status: 'active', goal: 'кольцо', entries: [], leads: [] }],
  climate: 'north', personaManual: true,
});

test('смена мира: всё, что велось, откладывается за миром и возвращается; новый мир чистый, игрок остаётся тем же', () => {
  const s = played();
  assert.equal(s.relations.people.length, 1);
  const e = switchWorld(s, 'earth');
  assert.equal(e.calendar, 'earth');
  assert.equal(e.relations.people.length, 0);                                  // отношения не переехали в новый мир
  assert.equal(e.quests.length, 0);
  assert.equal(e.place, '');
  assert.deepEqual(e.cast.map(p => [p.name, p.persona]), [['Лилит', true]]);   // персона пошла с игроком, остальные остались
  assert.equal(e.personaManual, true);
  assert.deepEqual(Object.keys(e.worlds), ['harptos']);                        // прежний мир отложен
  assert.equal(e.worlds.harptos.relations.people.length, 1);
  assert.equal(e.worlds.harptos.start.doy, 40);
  // в новом мире что-то ведётся
  const e2 = normalizeState({ ...e, relations: { people: [{ id: 'z', name: 'Попутчик', aliases: [] }] }, place: 'Москва' });
  assert.equal(e2.worlds.harptos.relations.people[0].name, 'Гейл');             // чужой мир читается назад целым
  // возвращаемся: прежний мир как был, а земной откладывается со своим
  const back = switchWorld(e2, 'harptos');
  assert.equal(back.calendar, 'harptos');
  assert.equal(back.relations.people[0].name, 'Гейл');
  assert.equal(back.place, 'Врата Балдура');
  assert.equal(back.climate, 'north');
  assert.equal(back.start.doy, 40);
  assert.equal(back.quests[0].title, 'Найти кольцо');
  assert.deepEqual(back.cast.map(p => p.name).sort(), ['Астарион', 'Лилит']);
  assert.deepEqual(Object.keys(back.worlds), ['earth']);                         // активный мир среди отложенных не хранится
  assert.equal(back.worlds.earth.relations.people[0].name, 'Попутчик');
  assert.equal(back.worlds.earth.place, 'Москва');
});

test('смена мира: тот же мир не трогает состояние, неизвестный id игнорируется, три мира держатся одновременно', () => {
  const s = played();
  assert.equal(switchWorld(s, 'harptos'), s);
  assert.equal(switchWorld(s, 'нет такого'), s);
  const a = switchWorld(s, 'earth'), b = switchWorld(a, 'golarion');
  assert.deepEqual(Object.keys(b.worlds).sort(), ['earth', 'harptos']);
  const c = switchWorld(switchWorld(b, 'harptos'), 'earth');
  assert.deepEqual(Object.keys(c.worlds).sort(), ['golarion', 'harptos']);
});

test('нормализация: снимки других миров сохраняются, мусор, активный мир и вложенные снимки отбрасываются', () => {
  const raw = { calendar: 'earth', worlds: { harptos: { calendar: 'harptos', place: 'X', worlds: { exandria: { place: 'глубоко' } } }, earth: { calendar: 'earth' }, '??': { a: 1 }, golarion: 5, eberron: [] } };
  const s = normalizeState(raw);
  assert.deepEqual(Object.keys(s.worlds), ['harptos']);
  assert.equal(s.worlds.harptos.place, 'X');
  assert.equal(s.worlds.harptos.worlds, undefined);
  assert.deepEqual(defaultState('earth').worlds, {});
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(s))).worlds, s.worlds);        // без изменений после круга через JSON
});
