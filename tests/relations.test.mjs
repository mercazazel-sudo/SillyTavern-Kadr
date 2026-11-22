import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SCALE_IDS, describeScale, normalizeRelations, relationLines, emptyRelations, RULE } from '../src/core/relations.js';
import { relationsFromKulisy } from '../src/core/kulisy-import.js';
import { normalizeState, defaultState } from '../src/core/state.js';
import { buildSceneBlock, enabledLayers } from '../src/core/scene-text.js';
import { resolveTime } from '../src/core/clock.js';

const cast = [
  { id: 'c1', name: 'Лилит', persona: true, present: true },
  { id: 'c2', name: 'Шэдоухарт', persona: false, present: true },
  { id: 'c3', name: 'Астарион', persona: false, present: true },
  { id: 'c4', name: 'Гейл', persona: false, present: false },
];
const line = (id, from, to, scales, extra = {}) => ({ id, from, to, scales, ...extra });

test('шкалы: 15 штук; подсказки по уровню, у тёмных шкал минус подсказки не даёт', () => {
  assert.equal(SCALE_IDS.length, 15);
  assert.equal(describeScale('trust', 70), '(принимает слова за правду, делится секретами)');
  assert.equal(describeScale('trust', 40), '(слушает всерьёз)');
  assert.equal(describeScale('trust', 15), '(пробует положиться)');
  assert.equal(describeScale('trust', 5), '');
  assert.equal(describeScale('trust', -50), '(ждёт подвоха)');
  assert.equal(describeScale('guilt', -50), '');          // у Кулис тут была ошибка: отрицательная вина давала «мучительное чувство вины»
  assert.equal(describeScale('approval', -70), '(осуждает его поступки)');
  assert.equal(describeScale('нет такой', 90), '');
});

test('normalizeRelations: мусор, дубли пар, лимиты значений', () => {
  const out = normalizeRelations({
    people: [{ id: 'p1', name: 'Вилл' }, { id: 'p1', name: 'Дубль' }, { id: '', name: 'X' }],
    lines: [line('a', 'c1', 'c2', { trust: 250, love: -999, nope: 5, fear: 0 }, { stage: 'x'.repeat(100), factors: [{ scaleId: 'trust', direction: 'down', text: 'причина' }, { scaleId: 'нет', text: 'мимо' }, { scaleId: 'trust', direction: 'down', text: 'причина' }], memories: [{ id: 'm', text: 'было', intensity: 99 }] }),
      line('b', 'c1', 'c2', { love: 1 }), line('c', 'c2', 'c2', {}), null, line('a', 'c3', 'c2', {})],
    triangles: [{ id: 't', centerId: 'c1', firstId: 'c2', secondId: 'c3', goal: 'цель' }, { id: 'bad', centerId: 'c1' }],
  });
  assert.equal(out.people.length, 1);
  assert.equal(out.lines.length, 1);
  assert.deepEqual(out.lines[0].scales, { trust: 100, love: -100 });
  assert.equal(out.lines[0].stage.length, 40);
  assert.equal(out.lines[0].factors.length, 1);
  assert.equal(out.lines[0].memories[0].intensity, 5);
  assert.equal(out.triangles.length, 1);
  assert.deepEqual(normalizeRelations('мусор'), emptyRelations());
  assert.deepEqual(normalizeState({ calendar: 'harptos' }).relations, emptyRelations());
});

test('строки рассказчику: только присутствующие, без линий персоны, сильные первыми', () => {
  const rel = normalizeRelations({ lines: [
    line('1', 'c2', 'c3', { trust: 20 }), line('2', 'c3', 'c1', { love: 70, hostility: 10 }, { stage: 'flirt', memories: [{ id: 'm1', text: 'спасла', intensity: 4 }] }),
    line('3', 'c1', 'c2', { love: 90 }), line('4', 'c2', 'c4', { trust: 90 }), line('5', 'c4', 'c2', { trust: 90 }),
  ] });
  const lines = relationLines(rel, cast);
  assert.equal(lines.length, 2);                                   // 3 (персона) и 4, 5 (Гейл не в кадре) отброшены
  assert.match(lines[0], /^Астарион>Лилит;love=70\(любит всем сердцем, предан\),hostility=10\(недолюбливает\);stage=flirt;mem=спасла$/);
  assert.match(lines[1], /^Шэдоухарт>Астарион;trust=20\(пробует положиться\)$/);
  assert.equal(relationLines(rel, cast.map(p => ({ ...p, present: p.id === 'c2' }))).length, 0);
});

test('скрытые шкалы, выключенные записи, закреплённые и бюджет', () => {
  const rel = normalizeRelations({ lines: [line('1', 'c2', 'c3', { trust: 50, fear: 50 }, { hidden: ['fear'], memories: [{ id: 'a', text: 'старое', intensity: 1 }, { id: 'b', text: 'выкл', intensity: 1, disabled: true }, { id: 'c', text: 'новое1' }, { id: 'd', text: 'новое2' }, { id: 'e', text: 'новое3' }, { id: 'f', text: 'прикреплено', pinned: true }], goal: 'далёкая цель', factors: [{ scaleId: 'trust', direction: 'up', text: 'делится тайной' }] })] });
  const [text] = relationLines(rel, cast);
  assert.doesNotMatch(text, /fear/);
  assert.doesNotMatch(text, /выкл/);
  assert.match(text, /mem=.*прикреплено/);
  assert.match(text, /grow\[\+trust: делится тайной\]/);
  assert.match(text, /endpoint=далёкая цель/);
  assert.equal(relationLines(rel, cast, { factors: false })[0].includes('grow['), false);
  assert.equal(relationLines(rel, cast, { maxChars: 5 }).length, 0);
});

test('треугольник уходит, когда в кадре двое из трёх; общие воспоминания, когда все участники здесь', () => {
  const rel = normalizeRelations({
    triangles: [{ id: 't', centerId: 'c3', firstId: 'c1', secondId: 'c2', goal: 'сблизятся' }, { id: 'u', centerId: 'c4', firstId: 'c1', secondId: 'c2' }, { id: 'v', centerId: 'c3', firstId: 'c1', secondId: 'c2', resolved: true }],
    shared: [{ id: 's1', kind: 'memory', text: 'побег с наутилоида', who: ['c1', 'c2'] }, { id: 's2', kind: 'tension', text: 'тайна', who: ['c2', 'c4'] }],
  });
  const lines = relationLines(rel, cast);
  assert.equal(lines.length, 3);                                    // t, u (двое из трёх на месте), s1; v решён, s2 с отсутствующим
  assert.match(lines.join('\n'), /triangle center=Астарион; others=Лилит,Шэдоухарт; far goal of this pair: сблизятся/);
  assert.match(lines.join('\n'), /shared-memory\[Лилит,Шэдоухарт\]=побег с наутилоида/);
});

test('блок рассказчику: строки отношений и правила', () => {
  const s = defaultState('harptos');
  const rel = normalizeRelations({ lines: [line('1', 'c2', 'c3', { trust: 20 })] });
  const lines = relationLines(rel, cast);
  const block = buildSceneBlock({ shortRules: false, state: s, time: resolveTime(s, 1), layers: enabledLayers({}, 'harptos'), relationLines: lines });
  assert.match(block, /relation: Шэдоухарт>Астарион;trust=20/);
  assert.ok(block.includes(`relation rules: ${RULE}`));
  assert.doesNotMatch(buildSceneBlock({ shortRules: false, state: s, time: resolveTime(s, 1), layers: enabledLayers({}, 'harptos') }), /relation/);
});

test('отношения Кулис → наши: сопоставление по имени и псевдониму, реестр для остальных', () => {
  const ku = {
    entities: { e1: { name: 'Лилит' }, e2: { name: 'Shadowheart', aliases: ['Шэдоухарт'] }, e3: { name: 'Vestor', aliases: ['Вестор'] }, e4: { name: 'Никто' } },
    relationships: { r1: { id: 'r1', from: 'e2', to: 'e1', scales: { trust: 30 }, memories: [{ id: 'm', text: 'вместе', intensity: 4 }], tensions: [], factors: [{ scaleId: 'trust', direction: 'up', text: 'честность' }], goal: 'доверие' }, r2: { id: 'r2', from: 'e3', to: 'e1', scales: { respect: 35 } }, r3: { id: 'r3', from: 'e9', to: 'e1', scales: {} } },
    records: { memories: [{ id: 'sm', text: 'общее', participantIds: ['e1', 'e2'] }, { id: 'pm', text: 'парное', participantIds: ['e1', 'e2'], relationshipId: 'r1' }], tensions: [] },
    ui: { triangles: [{ id: 'tr', name: 'Т', centerId: 'e3', firstId: 'e1', secondId: 'e2', goal: 'г' }] },
  };
  const plan = relationsFromKulisy(ku, cast);
  assert.equal(plan.mapped, 2);
  assert.deepEqual(plan.people.map(p => p.id), ['e3']);               // Вестор не в кадре: в реестре; «Никто» нигде не нужен
  assert.deepEqual(plan.lines.map(l => [l.from, l.to]), [['c2', 'c1'], ['e3', 'c1']]);
  assert.equal(plan.shared.length, 1);                                // парная запись уже внутри линии
  assert.deepEqual(plan.triangles[0].centerId, 'e3');
  const norm = normalizeRelations({ people: plan.people, lines: plan.lines, shared: plan.shared, triangles: plan.triangles });
  assert.equal(norm.lines.length, 2);
  assert.deepEqual(relationsFromKulisy({}, cast).lines, []);
});

const exportPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'exports', 'local-only-export.json');
test('экспорт Нарратора1: 31 линия переносится и проходит нормализацию', { skip: !existsSync(exportPath) }, () => {
  const ku = JSON.parse(readFileSync(exportPath, 'utf8')).kulisy;
  const names = ['Лилит', 'Shadowheart', 'Astarion', 'Gale', 'Lae\'zel', 'Wyll', 'Мизора'];
  const c = names.map((name, i) => ({ id: 'c' + i, name, persona: i === 0, present: true }));
  const plan = relationsFromKulisy(ku, c);
  assert.equal(plan.lines.length, 31);
  const norm = normalizeRelations({ people: plan.people, lines: plan.lines, shared: plan.shared, triangles: plan.triangles });
  assert.equal(norm.lines.length, 31);
  assert.ok(plan.mapped >= 5);
  assert.ok(relationLines(norm, c).length > 0);
});

test('хедканоны: нормализация, только присутствующие пары, выключенные не уходят, перенос из Кулис', () => {
  const rel = normalizeRelations({ headcanons: [
    { id: 'h1', pair: 'c3|c2', text: 'держится на расстоянии шага' }, { id: 'h2', pair: 'c2|c4', text: 'Гейл не в кадре' }, { id: 'h3', pair: 'c2|c3', text: 'выкл', enabled: false },
    { id: 'h1', pair: 'c1|c2', text: 'дубль' }, { id: 'h4', pair: 'c2|c2', text: 'сам с собой' }, { id: 'h5', pair: 'c1|c3', text: '' },
  ] });
  assert.deepEqual(rel.headcanons.map(h => h.id), ['h1', 'h2', 'h3']);
  assert.equal(rel.headcanons[0].pair, 'c2|c3');                       // пара отсортирована
  const lines = relationLines(rel, cast);
  assert.deepEqual(lines, ['headcanon[Шэдоухарт & Астарион]: держится на расстоянии шага']);
  assert.ok(RULE.includes('headcanon lines are settled facts'));
  const ku = { entities: { e1: { name: 'Лилит' }, e2: { name: 'Shadowheart', aliases: ['Шэдоухарт'] } }, ui: { headcanons: { 'e2|e1': { items: [{ id: 'x1', text: 'привычка', enabled: true }, { id: 'x2', text: 'шутка', enabled: false }] } } } };
  const plan = relationsFromKulisy(ku, cast);
  assert.deepEqual(plan.headcanons.map(h => [h.id, h.pair, h.enabled]), [['x1', 'c1|c2', true], ['x2', 'c1|c2', false]]);
});

import { UI_SCALES, MAIN_SCALES, normalizeRelations as normRel } from '../src/core/relations.js';
test('десять шкал окна: четыре основные первыми, все из допустимых; старые пять остаются допустимыми в данных', () => {
  assert.equal(UI_SCALES.length, 10);
  assert.deepEqual(UI_SCALES.slice(0, 4), ['approval', 'hostility', 'friendship', 'love']);
  assert.deepEqual([...MAIN_SCALES], ['approval', 'hostility', 'friendship', 'love']);
  assert.ok(UI_SCALES.every(id => SCALE_IDS.includes(id)));
  for (const old of ['affection', 'family', 'resentment', 'guilt', 'anxiety']) assert.ok(SCALE_IDS.includes(old) && !UI_SCALES.includes(old));
  const r = normRel({ lines: [line('1', 'c1', 'c2', { guilt: 40, love: 10 })] });
  assert.equal(r.lines[0].scales.guilt, 40);                                  // старая шкала с данными не теряется
});
