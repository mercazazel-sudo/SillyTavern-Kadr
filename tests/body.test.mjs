import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, SEVERITY, ZONES, ZONE_IDS, clampTier, normalizeCast, normalizeBodies, woundAge, healLeft, condLeft, suggestTier, bodyLine, buildCastLines, presentCast } from '../extension/src/core/body.js';
import { defaultState, normalizeState } from '../extension/src/core/state.js';
import { buildSceneBlock, enabledLayers } from '../extension/src/core/scene-text.js';
import { resolveTime } from '../extension/src/core/clock.js';

const today = { year: 1492, doy: 40 };
const wound = (extra = {}) => ({ id: 'w1', zone: 'legL', t: 'рваная рана бедра', sev: 2, bnd: true, since: { year: 1492, doy: 38 }, ...extra });

test('ступени, тяжести и части тела', () => {
  assert.equal(TIERS.length, 5);
  assert.deepEqual(TIERS.map(t => t.ru), ['здоров', 'потрёпан', 'ранен', 'тяжело ранен', 'при смерти']);
  assert.equal(clampTier(9), 4);
  assert.equal(clampTier('abc'), 0);
  assert.equal(SEVERITY.length, 4);
  assert.equal(ZONE_IDS.length, 8);
  assert.ok(Object.values(ZONES).every(z => z.x > 0 && z.y > 0));
});

test('давность и срок заживления считаются по календарю, а не хранятся', () => {
  const w = wound();
  assert.equal(woundAge('harptos', w, today), 2);
  assert.equal(woundAge('harptos', w, { year: 1492, doy: 30 }), 0);              // «в прошлом» не уходит в минус
  assert.equal(healLeft(w, 2), 5);                                               // заметная 7 дней, перевязана, прошло 2
  assert.equal(healLeft(wound({ bnd: false }), 2), 9);                           // без перевязки на половину дольше: 11 - 2
  assert.equal(healLeft(w, 99), 0);
  assert.equal(woundAge('harptos', wound({ since: { year: 1491, doy: 360 } }), { year: 1492, doy: 5 }), 365 - 360 + 5);
  assert.equal(condLeft('harptos', { until: { year: 1492, doy: 42 } }, today), 2);
  assert.equal(condLeft('harptos', { until: { year: 1492, doy: 39 } }, today), 0);
  assert.equal(condLeft('harptos', { until: null }, today), null);
  assert.equal(suggestTier([]), 0);
  assert.equal(suggestTier([wound({ sev: 1 }), wound({ sev: 3 })]), 3);
});

test('список участников: чистка, повторы, предел', () => {
  const cast = normalizeCast([{ id: 'a', name: '  Тав ', persona: true }, { id: 'a', name: 'Дубль' }, { id: 'b', name: '' }, { id: 'c', name: 'Шэдоухарт', present: false }, null, { name: 'без id' }]);
  assert.deepEqual(cast.map(p => p.name), ['Тав', 'Шэдоухарт']);
  assert.equal(cast[0].persona, true);
  assert.deepEqual(presentCast(cast).map(p => p.name), ['Тав']);
  assert.equal(normalizeCast(Array.from({ length: 100 }, (_, i) => ({ id: 'x' + i, name: 'N' + i }))).length, 40);
  assert.deepEqual(normalizeCast('мусор'), []);
});

test('тела: мусор отбрасывается, чужие id тоже', () => {
  const raw = {
    a: { tier: 99, wounds: [wound(), { id: 'w2', zone: 'нет', t: 'ушиб', sev: 1, since: { year: 1492, doy: 40 } }, { id: 'w3', t: 'x', sev: 9, since: { year: 1492, doy: 1 } }, { id: 'w4', t: '', sev: 1, since: { year: 1492, doy: 1 } }, { t: 'без id', sev: 1, since: { year: 1492, doy: 1 } }],
      conds: [{ id: 'c1', t: 'отравлена', until: { year: 1492, doy: 42 } }, { id: 'c2', t: '' }] },
    zzz: { tier: 1 },
  };
  const out = normalizeBodies(raw, new Set(['a']));
  assert.deepEqual(Object.keys(out), ['a']);
  assert.equal(out.a.tier, 4);
  assert.equal(out.a.wounds.length, 2);
  assert.equal(out.a.wounds[1].zone, 'chest');                                   // неизвестная часть тела
  assert.equal(out.a.conds.length, 1);
  assert.deepEqual(normalizeBodies(null), {});
});

test('строка о теле для рассказчика', () => {
  const body = { tier: 2, wounds: [wound(), wound({ id: 'w2', zone: 'chest', t: 'ушиб рёбер', sev: 1, bnd: false, since: today })], conds: [{ id: 'c1', t: 'истощена', until: { year: 1492, doy: 42 } }] };
  const line = bodyLine('Тав', body, 'harptos', today);
  assert.match(line, /^body\[Тав\]: ранен; левая нога: рваная рана бедра \(заметная, перевязана, 2 дн\.\); грудь: ушиб рёбер \(лёгкая, не перевязана, сегодня\); истощена, ещё 2 дн\.$/);
  assert.equal(bodyLine('Тав', { tier: 0, wounds: [], conds: [] }, 'harptos', today), '');
  assert.equal(bodyLine('Тав', null, 'harptos', today), '');
  assert.match(bodyLine('Тав', { tier: 0, wounds: [], conds: [{ id: 'c', t: 'пьяна', until: { year: 1492, doy: 39 } }] }, 'harptos', today), /пьяна, должно пройти/);
});

test('в запрос идут только присутствующие', () => {
  const cast = [{ id: 'a', name: 'Тав', present: true }, { id: 'b', name: 'Лаэзель', present: true }, { id: 'c', name: 'Гейл', present: false }];
  const bodies = { a: { tier: 2, wounds: [wound()], conds: [] }, b: { tier: 0, wounds: [], conds: [] }, c: { tier: 3, wounds: [wound({ id: 'w9', sev: 3 })], conds: [] } };
  const lines = buildCastLines(cast, bodies, 'harptos', today);
  assert.equal(lines[0], 'present: Тав, Лаэзель');
  assert.equal(lines.length, 2);                                                   // тело Лаэзель пустое, Гейл не в кадре
  assert.ok(lines[1].startsWith('body[Тав]'));
  assert.equal(buildCastLines(cast, bodies, 'harptos', today, { sendBody: false }).length, 1);
  assert.deepEqual(buildCastLines([], {}, 'harptos', today), []);
});

test('состояние чата хранит участников и тела; блок содержит их строки', () => {
  const raw = { calendar: 'harptos', start: { year: 1492, doy: 40, minutes: 600 }, cast: [{ id: 'a', name: 'Тав', persona: true }], bodies: { a: { tier: 2, wounds: [wound()], conds: [] }, ghost: { tier: 4 } } };
  const s = normalizeState(raw);
  assert.deepEqual(Object.keys(s.bodies), ['a']);                                  // тело без участника отброшено
  assert.deepEqual(defaultState('harptos').cast, []);
  const time = resolveTime(s, 1);
  const castLines = buildCastLines(s.cast, s.bodies, s.calendar, { year: time.year, doy: time.doy });
  const block = buildSceneBlock({ state: s, time, layers: enabledLayers({}, 'harptos'), castLines });
  assert.match(block, /present: Тав/);
  assert.match(block, /body\[Тав\]: ранен/);
});

import { MOODS, cleanMood, bodyLine as bl2, normalizeBodies as nb2 } from '../extension/src/core/body.js';
import { parseTraces as pt2, buildTracesRequest as bt2, wantsTraces as wt2 } from '../extension/src/core/chronicle.js';
import { normalizeInventory as ni2 } from '../extension/src/core/inventory.js';
test('настроение: нормализация, строка рассказчику', () => {
  assert.deepEqual(cleanMood({ id: 'fear', lvl: 9 }), { id: 'fear', lvl: 3 });
  assert.equal(cleanMood({ id: 'вздор' }), null);
  assert.equal(MOODS.length, 7);
  const b = nb2({ a: { tier: 0, mood: { id: 'nervous', lvl: 2 } } }).a;
  assert.match(bl2('Астарион', b, 'harptos', { year: 1492, doy: 1 }), /mood: nervous \(noticeably\)/);
  assert.equal(bl2('Х', nb2({ a: { mood: { id: 'calm', lvl: 1 } } }).a, 'harptos', { year: 1, doy: 1 }), '');   // спокойный ничего не добавляет
});
test('Архивариус: настроение и «надел/снял» из ответа, только из гардероба', () => {
  const people = [{ id: 'a', name: 'Астарион', persona: false }, { id: 'p', name: 'Лилит', persona: true }];
  const items = ni2([{ id: 'c2', name: 'Чёрный плащ', ownerId: 'a', kind: 'gear', slot: 'cloak' }, { id: 'c1', name: 'Накидка', ownerId: 'a', kind: 'gear', slot: 'cloak', worn: true }]);
  const bodies = { a: { wounds: [], conds: [], mood: { id: 'calm', lvl: 1 } }, p: { wounds: [], conds: [] } };
  const out = pt2({ changes: [
    { who: 'Астарион', kind: 'mood', text: 'angry', severity: 3 }, { who: 'Лилит', kind: 'mood', text: 'fear', severity: 2 },
    { who: 'Астарион', kind: 'wear', text: 'плащ' }, { who: 'Астарион', kind: 'wear', text: 'шляпа' }, { who: 'Астарион', kind: 'unwear', text: 'накидка' },
  ] }, { people, bodies, items });
  assert.deepEqual(out.map(o => [o.op, o.personId, o.text, o.sev ?? o.on]), [['mood', 'a', 'anger', 3], ['wear', 'a', 'Чёрный плащ', true], ['wear', 'a', 'Накидка', false]]);   // для персоны и для вещи не из гардероба ничего нет
  assert.match(bt2({ people, bodies, reply: 'x', userText: '', dateLabel: 'д', items })[1].content, /wardrobe: Чёрный плащ, Накидка \[worn\]/);
  assert.equal(wt2('Он накинул плащ и нахмурился.'), true); assert.equal(wt2('Шёл дождь.'), false);
});

import { cleanArousal, AROUSAL_RU, emptyBody as emptyBody3 } from '../extension/src/core/body.js';
import { normalizeRelations as normRel3 } from '../extension/src/core/relations.js';

test('возбуждение: шкала 0..4, нормализация, строка рассказчику только при ненулевом', () => {
  assert.equal(cleanArousal(9), 4); assert.equal(cleanArousal(-3), 0); assert.equal(cleanArousal('x'), 0); assert.equal(cleanArousal(2.9), 2);
  assert.equal(AROUSAL_RU.length, 5); assert.equal(emptyBody3().arousal, 0);
  const b = nb2({ a: { arousal: 3 }, c: { arousal: 0 } });
  assert.equal(b.a.arousal, 3); assert.equal(b.c.arousal, 0);
  assert.match(bl2('Астарион', b.a, 'harptos', { year: 1492, doy: 1 }), /arousal: strong/);
  assert.equal(bl2('Х', b.c, 'harptos', { year: 1, doy: 1 }), '');       // нулевое ничего не добавляет
  assert.match(bl2('Х', nb2({ a: { arousal: 1, mood: { id: 'happy', lvl: 2 } } }).a, 'harptos', { year: 1, doy: 1 }), /mood: happy.*arousal: slight/);
});

test('Архивариус: возбуждение из ответа, мимо персоны, без повторов и по словам-триггерам', () => {
  const people = [{ id: 'a', name: 'Астарион', persona: false }, { id: 'p', name: 'Лилит', persona: true }, { id: 'g', name: 'Гейл', persona: false }];
  const bodies = { a: { wounds: [], conds: [], arousal: 2 }, p: { wounds: [], conds: [] }, g: { wounds: [], conds: [] } };
  const out = pt2({ changes: [
    { who: 'Астарион', kind: 'arousal', text: 'strong' },            // был 2, стало 3
    { who: 'Лилит', kind: 'arousal', text: 'strong' },               // персона: мимо
    { who: 'Гейл', kind: 'arousal', text: 'на пределе' },             // русское слово
    { who: 'Гейл', kind: 'arousal', text: 'none' },                   // второй раз для того же человека: мимо
    { who: 'Астарион', kind: 'arousal', text: 'noticeable' },         // повтор для Астариона: мимо
  ] }, { people, bodies, items: [] });
  assert.deepEqual(out.map(o => [o.op, o.personId, o.sev]), [['arousal', 'a', 3], ['arousal', 'g', 4]]);
  assert.match(out[0].label, /возбуждение — сильное/);
  assert.equal(pt2({ changes: [{ who: 'Астарион', kind: 'arousal', text: 'noticeable' }] }, { people, bodies, items: [] }).length, 0);   // уже заметное
  assert.equal(wt2('Он поцеловал её, дыхание стало тяжёлым.'), true);
  assert.equal(wt2('Они обсудили маршрут.'), false);
  assert.match(bt2({ people, bodies, reply: 'x', userText: '', dateLabel: 'д', items: [] })[1].content, /Астарион: .*arousal: noticeable/);
});

test('журнал: откат возбуждения помнит прежнее значение', () => {
  const r = normRel3({ people: [], lines: [], log: [{ id: 'e1', at: 3, kind: 'body', personId: 'a', add: { conds: [], wounds: [] }, removed: [], arousalSet: true, prevArousal: 2, label: 'x' }] });
  assert.equal(r.log.length, 1); assert.equal(r.log[0].arousalSet, true); assert.equal(r.log[0].prevArousal, 2);
  assert.equal(normRel3({ people: [], lines: [], log: [{ id: 'e2', at: 3, kind: 'body', personId: 'a', add: { conds: [], wounds: [] }, removed: [] }] }).log.length, 0);   // пустая запись не живёт
});
