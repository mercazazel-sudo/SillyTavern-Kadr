import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTension, detectTension, describeTension, LEVELS, clampLevel } from '../extension/src/core/tension.js';
import { buildLetterBlock, cleanLetter, TEMPLATES, LETTER_MAX } from '../extension/src/core/letter.js';
import { defaultState, normalizeState, addEvent } from '../extension/src/core/state.js';
import { resolveTime } from '../extension/src/core/clock.js';
import { buildSceneBlock, enabledLayers } from '../extension/src/core/scene-text.js';

const step = at => ({ type: 'step', at, minutes: 10 });
const tens = (at, level, source = 'manual') => ({ type: 'tension', at, level, source });

test('пять ступеней от зелёного к красному', () => {
  assert.equal(LEVELS.length, 5);
  assert.deepEqual(LEVELS.map(l => l.ru), ['спокойно', 'настороженно', 'неспокойно', 'тревожно', 'опасно']);
  assert.equal(clampLevel(99), 4);
  assert.equal(clampLevel(-3), 0);
  assert.equal(clampLevel('2'), 2);
});

test('напряжение: ручная установка, остывание по ответам, откат вместе с сообщением', () => {
  const s = defaultState('harptos');
  assert.equal(resolveTension(s, 5).level, 0);
  addEvent(s, tens(1, 4));
  assert.equal(resolveTension(s, 2).level, 4);
  for (const at of [2, 3, 4, 5, 6, 7]) addEvent(s, step(at));
  assert.equal(resolveTension(s, 4).level, 4);                    // прошло ответов 2 и 3: ещё держится
  assert.equal(resolveTension(s, 5).level, 3);                    // третий ответ: остыло на ступень
  assert.equal(resolveTension(s, 5).source, 'decay');
  assert.equal(resolveTension(s, 8).level, 2);                    // ещё три ответа
  assert.equal(resolveTension(s, 8, { decayEvery: 0 }).level, 4); // остывание выключено
  assert.equal(resolveTension(s, 1).level, 0);                    // сообщение 1 удалено: события нет
});

test('порядок событий считается по сообщениям, а не по порядку записи', () => {
  const s = defaultState('harptos');
  for (const at of [1, 2, 3, 4, 5]) addEvent(s, step(at));
  addEvent(s, tens(1, 3, 'text'));                                // правка сообщения 1 дописана в ленту последней
  // по сообщениям: шаг 1, напряжение 3, шаги 2,3,4 (остыло до 2), шаг 5. По порядку записи вышло бы 3
  assert.equal(resolveTension(s, 6, { decayEvery: 3 }).level, 2);
});

test('строка для рассказчика: на спокойно молчит', () => {
  assert.equal(describeTension({ level: 0 }), '');
  assert.equal(describeTension(null), '');
  assert.match(describeTension({ level: 3 }), /^3\/4 alarmed — /);
});

test('сдвиг по тексту: повышение, понижение, речь не считается', () => {
  assert.equal(detectTension('Он обнажил меч и шагнул вперёд.')?.level, 4);
  assert.equal(detectTension('Началась драка, стол опрокинулся.')?.level, 4);
  assert.equal(detectTension('Из леса донёсся крик.')?.level, 3);
  assert.equal(detectTension('Они бросились бежать от погони.')?.level, 3);
  assert.equal(detectTension('Где-то хрустнула ветка, и она насторожилась.')?.level, 2);
  assert.equal(detectTension('Он осторожно прислушался.')?.level, 1);
  assert.equal(detectTension('Она улыбнулась и расслабилась у костра.')?.kind, 'down');
  assert.equal(detectTension('Просто тихий разговор о погоде.'), null);
  assert.equal(detectTension('— Он обнажил меч! — крикнула она.'), null);
  assert.equal(detectTension('«Нас убьют», — подумала она.'), null);
  assert.equal(detectTension('Он не обнажил меч, а убрал руку.'), null);
  assert.equal(detectTension(''), null);
  assert.equal(detectTension(null), null);
});

test('самая высокая ступень из найденных побеждает', () => {
  assert.equal(detectTension('Раздался крик, и стражник обнажил меч.')?.level, 4);
});

test('письмо: чистка, блок, лимит, шаблоны', () => {
  assert.equal(buildLetterBlock(''), '');
  assert.equal(buildLetterBlock('   '), '');
  const block = buildLetterBlock('  Не торопи сближение.  ');
  assert.match(block, /OUT-OF-CHARACTER NOTE/);
  assert.match(block, /Не торопи сближение\./);
  assert.match(block, /Never mention, quote or acknowledge/);
  assert.equal(cleanLetter('x'.repeat(LETTER_MAX + 500)).length, LETTER_MAX);
  assert.equal(cleanLetter(null), '');
  assert.ok(TEMPLATES.length >= 5 && TEMPLATES.every(t => typeof t === 'string' && t.length > 10));
});

test('normalizeState: письмо и события напряжения', () => {
  const s = normalizeState({ calendar: 'harptos', letter: '  ждёт  ', timeline: [
    { type: 'tension', at: 1, level: 3, source: 'text' },
    { type: 'tension', at: 2, level: 99 },
    { type: 'tension', at: 3, level: 'abc' },
    { type: 'tension', at: -1, level: 2 },
  ] });
  assert.equal(s.letter, 'ждёт');
  assert.equal(s.timeline.length, 2);
  assert.equal(s.timeline[1].level, 4);
  assert.equal(s.timeline[0].source, 'text');
  assert.equal(normalizeState(null).letter, '');
});

test('время не страдает от событий напряжения; блок содержит напряжение', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 14, minutes: 600 };
  addEvent(s, tens(0, 3));
  assert.equal(resolveTime(s, 1).minutes, 600);
  const time = resolveTime(s, 1);
  const layers = enabledLayers({}, 'harptos');
  const block = buildSceneBlock({ state: s, time, layers, tension: resolveTension(s, 1) });
  assert.match(block, /tension: 3\/4 alarmed/);
  assert.doesNotMatch(buildSceneBlock({ state: s, time, layers, tension: { level: 0 } }), /tension/);
});
