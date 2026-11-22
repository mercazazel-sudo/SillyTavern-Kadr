import test from 'node:test';
import assert from 'node:assert/strict';
import { heuristicKind, nameFromTitle, triageCandidates, parseTriage, buildPlan, freshOf, buildTriageRequest } from '../src/core/triage.js';

const e = (uid, comment, content = 'Some text.') => ({ uid, comment, content, key: [], disable: false });

test('быстрая оценка: люди, места, правила', () => {
  assert.equal(heuristicKind('Anna - Village Baker', 'Anna is a baker. She is kind. Her bread. He loves her.').kind, 'person');
  assert.equal(heuristicKind('Boris - Carpenter & Mill Owner', 'Age: 45. Appearance: broad.').kind, 'person');
  assert.equal(heuristicKind('Greenfield Village', 'Greenfield is a small village in the valley.').kind, 'place');
  assert.equal(heuristicKind('The Inherited Farmhouse', 'The farmhouse is located at the edge.').kind, 'place');
  assert.equal(heuristicKind('RULE - Instinct Never Overrides Consent', 'Never force. Always ask.').kind, 'other');
  assert.equal(heuristicKind('Beastfolk Medicine & Healthcare Access', 'Clinics are rare.').kind, 'other');
  assert.equal(heuristicKind('Law & Civil Rights', 'Beastfolk have rights.').kind, 'other');
});

test('имя Millie не принимается за мельницу', () => {
  assert.notEqual(heuristicKind('Millie - Barmaid', 'She pours drinks. Her laugh. She waves.').kind, 'place');
});

test('имя из названия', () => {
  assert.equal(nameFromTitle('Anna - Village Baker'), 'Anna');
  assert.equal(nameFromTitle('Boris - Carpenter & Mill Owner'), 'Boris');
  assert.equal(nameFromTitle('Дейм Айлин (Dame Ailyn)'), 'Дейм Айлин');
  assert.equal(nameFromTitle('Greenfield Village', 'place'), 'Greenfield Village');
});

test('кандидаты: анкеты в формате, выключенные, пустые и привязанные пропускаются', () => {
  const list = [e(1, '[ Astarion ] - Basic Info'), e(2, 'Greenfield Village'), { ...e(3, 'Off'), disable: true }, e(4, 'Empty', ' '), e(5, 'Anna - Baker'), e(6, '[Секрет: X]')];
  const got = triageCandidates(list, { linkedTitles: new Set(['anna - baker']) });
  assert.deepEqual(got.map(x => x.uid), ['2']);
});

test('ответ модели: проверка и родитель', () => {
  const batch = triageCandidates([e(1, 'Greenfield Village'), e(2, 'Anna - Baker'), e(3, 'Mill')]);
  const v = parseTriage({ items: [{ n: 1, kind: 'place', name: 'Greenfield', parent: null }, { n: 2, kind: 'person', name: 'Anna' }, { n: 3, kind: 'place', name: 'Mill', parent: 1 }, { n: 9, kind: 'person', name: 'Ghost' }, { n: 2, kind: 'bad' }] }, batch);
  assert.equal(v['2'].kind, 'other');            // последний повтор перезаписывает: неверный вид превращается в other
  assert.equal(v['3'].parentUid, '1');
  assert.equal(Object.keys(v).length, 3);
});

test('план: модель главнее эвристики; без модели работает эвристика', () => {
  const cand = triageCandidates([e(1, 'Greenfield Village', 'It is a small village in the valley.'), e(2, 'The Late Grandfather', 'He died. His farm. He was kind. His wife.')]);
  const none = buildPlan(cand);
  assert.equal(none[0].kind, 'place');
  const withModel = buildPlan(cand, { 1: { kind: 'place', name: 'Greenfield', parentUid: '' }, 2: { kind: 'person', name: 'The Late Grandfather', parentUid: '' } });
  assert.equal(withModel[1].kind, 'person');
  assert.equal(withModel[1].byModel, true);
});

test('новые записи по списку виденных', () => {
  const cand = triageCandidates([e(1, 'A one'), e(2, 'B two'), e(3, 'C three')]);
  assert.deepEqual(freshOf(cand, ['1', '2']).map(x => x.uid), ['3']);
  assert.equal(buildTriageRequest(cand).length, 2);
});
