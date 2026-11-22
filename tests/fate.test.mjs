import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_IDS, MODE_SETS, SET_IDS, modesOf, detectDailyMode, NUDGES, TABLES, rollEvent, HEAT, HEAT_IDS, HEAT_NUDGES, HEAT_ACTS, HEAT_ACT_IDS, normalizeHeat, moveHeat, heatLines, heatPending, normalizeFate, emptyFate, fateLines, FATE_RULE } from '../src/core/fate.js';
import { normalizeState, defaultState } from '../src/core/state.js';
import { buildSceneBlock, enabledLayers } from '../src/core/scene-text.js';
import { resolveTime } from '../src/core/clock.js';

/** Детерминированный «случай»: по очереди отдаёт заданные числа. */
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const present = [{ id: 'c1', name: 'Лилит', persona: true }, { id: 'c2', name: 'Шэдоухарт', persona: false }, { id: 'c3', name: 'Астарион', persona: false }];

test('режимы: Привал не режим, Лагерь и режим и кнопка', () => {
  assert.deepEqual(MODE_IDS, ['path', 'stop', 'camp', 'home', 'work', 'leisure', 'fight', 'intimacy']);
  assert.equal(MODES.some(m => m.id === 'rest'), false);
  assert.equal(NUDGES.rest.mode, '');                    // привал только подсказкой
  assert.equal(NUDGES.camp.mode, 'camp');
  assert.equal(NUDGES.travel.mode, 'path');
  for (const n of Object.values(NUDGES)) assert.match(n.text, /not forced/);   // персону не принуждают
});

test('событие: таблица по режиму, напряжение усиливает опасность и ослабляет удачу', () => {
  const countTag = (tension, tag) => {
    let n = 0;
    for (let i = 0; i < 2000; i++) if (rollEvent({ modeId: 'path', tension, present, random: () => (i + 0.5) / 2000 }).tag === tag) n++;
    return n;
  };
  assert.ok(countTag(4, 'danger') > countTag(0, 'danger'));
  assert.ok(countTag(4, 'boon') < countTag(0, 'boon'));
  const generic = rollEvent({ modeId: '', present, random: () => 0.1 });
  assert.ok(TABLES.generic.some(e => e.id === generic.id));
  assert.ok(Object.keys(TABLES).every(k => TABLES[k].every(e => e.ru && e.en && e.w > 0)));
});

test('рана: цель среди присутствующих, персона по тумблеру, тяжёлое только при lethal', () => {
  const hurt = { modeId: 'fight', tension: 4, present, zones: ['head', 'chest'] };
  const find = (opts, want) => { for (let i = 0; i < 400; i++) { const r = rollEvent({ ...hurt, ...opts, random: () => ((i * 37) % 400 + 0.5) / 400 }); if (r.id === want) return r; } return null; };
  const heavy = find({}, 'hit');
  assert.equal(heavy.harm.sev, 2);                                          // без lethal не выше «ранен»
  assert.ok(['head', 'chest'].includes(heavy.harm.zone));
  assert.equal(rollEvent({ ...hurt, lethal: true, random: seq(0.99, 0.1) }).harm?.sev ?? 2, 2);
  const noPersona = Array.from({ length: 300 }, (_, i) => rollEvent({ ...hurt, includePersona: false, random: () => ((i * 53) % 300 + 0.5) / 300 })).filter(r => r.target);
  assert.ok(noPersona.length > 0 && noPersona.every(r => !r.target.persona));
  assert.equal(rollEvent({ ...hurt, present: [], random: () => 0.9 }).harm, undefined);   // некого задеть: рана не предлагается
});

test('накал: пять зон, шаги по краям не уходят, зона и ведущий ставятся, снятие', () => {
  assert.deepEqual(HEAT_IDS, ['warm', 'hot', 'passion', 'peak', 'calm']);
  assert.equal(moveHeat(null, { delta: -1 }).zone, 'warm');                      // первый шаг из ничего: первая зона
  assert.equal(moveHeat(null, { delta: 1 }).zone, 'warm');
  assert.equal(moveHeat({ zone: 'calm', lead: 'story', nudge: '', nudgeSent: true, notes: [] }, { delta: 1 }).zone, 'calm');
  assert.equal(moveHeat({ zone: 'hot', lead: 'story', nudge: '', nudgeSent: true, notes: [] }, { delta: 1 }).zone, 'passion');
  assert.equal(moveHeat({ zone: 'hot', lead: 'story', nudge: '', nudgeSent: true, notes: [] }, { zone: 'peak' }).zone, 'peak');
  assert.equal(moveHeat(null, { zone: 'взрыв' }).zone, 'warm');
  assert.equal(moveHeat({ zone: 'hot', lead: 'story', nudge: '', nudgeSent: true, notes: [] }, { lead: 'c2' }).lead, 'c2');
  const nudged = moveHeat({ zone: 'hot', lead: 'story', nudge: '', nudgeSent: true, notes: [] }, { nudge: 'bolder' });
  assert.equal(nudged.nudge, 'bolder'); assert.equal(nudged.nudgeSent, false);
  assert.equal(moveHeat(nudged, { nudge: '' }).nudge, '');
  assert.equal(moveHeat(nudged, { clear: true }), null);
});

test('накал: нормализация (в том числе старая лесенка) и строки рассказчику с одноразовым и границами', () => {
  assert.equal(normalizeHeat(null), null);
  assert.equal(normalizeHeat({ zone: 'вздор' }), null);
  assert.equal(normalizeHeat(undefined, { stage: 'kiss', note: 'тихо' }).zone, 'hot');            // старая стадия переезжает на ближайшую зону
  assert.equal(normalizeHeat(undefined, { stage: 'kiss', note: 'тихо' }).notes[0].text, 'тихо');
  assert.equal(normalizeHeat(undefined, { stage: 'after' }).zone, 'calm');
  const h = normalizeHeat({ zone: 'passion', lead: 'c3', nudge: 'slower', nudgeSent: false, notes: [
    { id: 'a', text: 'не касаться спины', kind: 'limit' }, { id: 'b', text: 'говорит вполголоса', kind: 'scene' }, { id: 'c', text: 'шаги за стеной', kind: 'once' },
    { id: 'd', text: 'выключено', kind: 'scene', on: false }, { text: '', kind: 'scene' }, { id: 'e', text: 'вздор', kind: 'нет' }] });
  assert.equal(h.notes.length, 5);
  assert.equal(h.notes.find(n => n.id === 'e').kind, 'scene');
  const lines = heatLines(h, { c3: 'Арвенн' });
  assert.match(lines[0], /^intimate scene, heat: passion \(3\/5\): the act itself/);
  assert.match(lines[0], /never jump to a higher one on your own/);
  assert.equal(lines[1], 'Арвенн takes the lead');
  assert.match(lines[2], /^nudge for this turn: slower/);
  assert.equal(lines.find(l => l.startsWith('notes:')), 'notes: говорит вполголоса; вздор');
  assert.equal(lines.find(l => l.startsWith('limits')), 'limits (always honour): не касаться спины');
  assert.equal(lines.find(l => l.startsWith('this turn only:')), 'this turn only: шаги за стеной');
  assert.equal(heatPending(h), true);
  h.nudgeSent = true; h.notes.find(n => n.kind === 'once').sent = true;
  assert.equal(heatPending(h), false);
  const after = heatLines(h);
  assert.ok(!after.some(l => l.startsWith('nudge') || l.startsWith('this turn only')));             // одноразовое ушло
  assert.ok(after.some(l => l.startsWith('limits')));                                               // граница держится всегда
  assert.deepEqual(heatLines(null), []);
  assert.equal(heatLines({ zone: 'warm', lead: 'turns', nudge: '', nudgeSent: true, notes: [] })[1], 'initiative alternates between the characters');
  assert.ok(HEAT_NUDGES.every(n => n.ru && n.en));
});

test('состояние: нормализация и строки рассказчику; одноразовое гасится', () => {
  assert.deepEqual(normalizeFate('мусор'), emptyFate());
  assert.deepEqual(normalizeState({ calendar: 'harptos' }).fate, emptyFate());
  const f = normalizeFate({ mode: 'camp', stage: { stage: 'kiss' },
    event: { kind: 'roll', label: 'опасность: засада', text: 'a small ambush', sent: false, target: { id: 'c2', name: 'Шэдоухарт' }, harm: { t: 'удар', sev: 9, zone: 'head' } } });
  assert.equal(f.heat.zone, 'hot');                                       // старая лесенка переехала на накал
  assert.equal(f.event.harm.sev, 3);
  assert.equal(normalizeFate({ mode: 'взрыв' }).mode, '');
  const lines = fateLines(f);
  assert.match(lines[0], /^scene mode: camp — camp for the night/);
  assert.match(lines[1], /^intimate scene, heat: hot \(2\/5\)/);
  assert.match(lines[lines.length - 1], /^fate event: a small ambush \(possible harm: удар to Шэдоухарт\)/);
  f.event.sent = true;
  assert.equal(fateLines(f).filter(l => l.startsWith('fate event')).length, 0);   // одноразовое ушло, режим и накал держатся
  assert.match(fateLines({ ...emptyFate(), event: { kind: 'nudge', text: 'they propose a rest', sent: false } })[0], /^companions: they propose a rest/);
  assert.deepEqual(fateLines(emptyFate()), []);
  assert.match(fateLines({ ...emptyFate(), mode: 'intimacy' })[1], /heat is not set/);
  assert.ok(!fateLines({ ...emptyFate(), heat: normalizeHeat({ zone: 'warm' }) }, { diceCheck: true }).some(l => l.startsWith('d20 check')));   // в интиме d20 не просят
  assert.ok(fateLines(emptyFate(), { diceCheck: true }).some(l => l.startsWith('d20 check')));
});

test('блок рассказчику: строки судьбы и правила', () => {
  const s = defaultState('harptos');
  const block = buildSceneBlock({ shortRules: false, state: s, time: resolveTime(s, 1), layers: enabledLayers({}, 'harptos'), fateLines: fateLines({ ...emptyFate(), mode: 'fight' }) });
  assert.match(block, /scene mode: fight/);
  assert.ok(block.includes(`fate rules: ${FATE_RULE}`));
  assert.doesNotMatch(buildSceneBlock({ shortRules: false, state: s, time: resolveTime(s, 1), layers: enabledLayers({}, 'harptos') }), /fate/);
});

import { detectAutoMode, HIGH_MODES } from '../src/core/fate.js';

test('режим сам: Лагерь, Город, Приключение, Бой; ручной режим не трогается; Бой и Близость главнее остальных', () => {
  const d = o => { const r = detectAutoMode({ text: '', place: '', level: 0, mode: '', auto: false, back: null, ...o }); return r && { mode: r.mode, auto: r.auto }; };
  assert.deepEqual(d({ text: 'И вот они в лагере, у догорающего костра, Лилит залезла в палатку.' }), { mode: 'camp', auto: true });
  assert.deepEqual(d({ place: 'Побережье Мечей › Лагерь' }), { mode: 'camp', auto: true });
  assert.deepEqual(d({ place: 'Побережье Мечей › Палатка Лилит', text: 'Тихо.' }), { mode: 'camp', auto: true });
  assert.equal(d({ text: 'И вот они в лагере.', mode: 'camp', auto: true }), null);
  assert.deepEqual(d({ text: 'Утром отряд свернул лагерь и двинулся в путь по дороге.', mode: 'camp', auto: true, place: 'Побережье Мечей › Лагерь' }), { mode: 'path', auto: true });
  assert.deepEqual(d({ text: 'Утром отряд свернул лагерь.', mode: 'camp', auto: true, place: 'Побережье Мечей' }), { mode: '', auto: false });
  assert.deepEqual(d({ text: 'Они шли по лесной тропе всё утро.' }), { mode: 'path', auto: true });
  assert.deepEqual(d({ text: 'Наконец они вошли в деревню и зашли в таверну.' }), { mode: 'stop', auto: true });
  assert.equal(d({ text: 'И вот они в лагере у костра.', mode: 'path', auto: false }), null);        // выбранное вручную обычные режимы не трогают
  assert.equal(d({ text: 'Идут по дороге.', mode: 'camp', auto: false }), null);
  assert.equal(d({ text: 'Ничего особенного.' }), null);
  // Бой главнее: в лагере начался бой (лагерь запоминается), остыл: лагерь вернулся
  const start = detectAutoMode({ text: 'У костра.', combat: true, level: 4, mode: 'camp', auto: false, place: 'Лагерь' });
  assert.deepEqual(start, { mode: 'fight', auto: true, back: { mode: 'camp', auto: false } });          // даже поверх выбранного вручную Лагеря
  assert.equal(detectAutoMode({ text: 'Ещё бой.', combat: true, level: 4, mode: 'fight', auto: true, back: start.back }), null);
  assert.deepEqual(detectAutoMode({ text: 'Тихо.', level: 1, mode: 'fight', auto: true, back: start.back }), { mode: 'camp', auto: false, back: null });
  assert.deepEqual(detectAutoMode({ text: 'Тихо.', level: 1, mode: 'fight', auto: true, back: null }), { mode: '', auto: false, back: null });
  assert.equal(detectAutoMode({ text: 'Тихо.', level: 1, mode: 'fight', auto: false }), null);           // боем, выбранным вручную, автоматика не управляет
  // Близость главнее обычных: слова про лагерь, город и дорогу её не вытесняют; бой её не перебивает
  for (const text of ['Они в лагере у костра.', 'Идут по дороге.', 'Вошли в таверну.']) assert.equal(detectAutoMode({ text, mode: 'intimacy', auto: false }), null);
  assert.equal(detectAutoMode({ text: 'Шум.', combat: true, level: 4, mode: 'intimacy', auto: false }), null);
  assert.equal(normalizeFate({ mode: 'camp', auto: true }).auto, true);
  assert.equal(normalizeFate({ mode: '', auto: true }).auto, false);
  assert.deepEqual(normalizeFate({ mode: 'fight', back: { mode: 'camp', auto: true } }).back, { mode: 'camp', auto: true });
  assert.equal(normalizeFate({ mode: 'fight', back: { mode: 'intimacy' } }).back, null);                 // запоминается только обычный режим
  assert.equal(MODES.find(m => m.id === 'path').ru, 'Приключение');
  assert.equal(MODES.find(m => m.id === 'stop').ru, 'Город');
  assert.deepEqual(HIGH_MODES, ['fight', 'intimacy']);
});

import { parseCheck, rollCheck, checkDirective, CHECK_INSTRUCTION } from '../src/core/fate.js';

test('проверка кубом: строка рассказчика, исходы, преимущество и помеха', () => {
  assert.deepEqual(parseCheck('Клинок летит в тебя.\n[[КУБ: удар клинка | сложность 14 | помеха]]'), { label: 'удар клинка', dc: 14, mode: 'disadvantage', kind: 'dodge' });
  assert.deepEqual(parseCheck('[[куб: стрела | сложность 30 | преимущество]]'), { label: 'стрела', dc: 20, mode: 'advantage', kind: 'dodge' });
  assert.equal(parseCheck('[[КУБ: падение | сложность 0]]').dc, 1);
  assert.equal(parseCheck('[[КУБ: падение | сложность 9]]').mode, 'normal');
  assert.equal(parseCheck('обычный текст'), null);
  const seq = (...n) => { let i = 0; return () => (n[i++] - 1) / 20 + 0.001; };
  assert.equal(rollCheck({ dc: 12, random: seq(11) }).outcome, 'hit');           // меньше сложности: ранен
  assert.equal(rollCheck({ dc: 12, random: seq(12) }).outcome, 'dodge');         // равно: уворот
  assert.equal(rollCheck({ dc: 12, random: seq(1) }).outcome, 'crit-hit');       // 1: тяжёлая рана
  assert.equal(rollCheck({ dc: 12, random: seq(1) }).sev, 2);
  assert.equal(rollCheck({ dc: 20, random: seq(20) }).outcome, 'crit-dodge');
  assert.equal(rollCheck({ dc: 12, mode: 'advantage', random: seq(3, 15) }).roll, 15);
  assert.equal(rollCheck({ dc: 12, mode: 'disadvantage', random: seq(3, 15) }).roll, 3);
  assert.match(checkDirective({ label: 'удар', mode: 'normal', dc: 12 }, rollCheck({ dc: 12, random: seq(5) })), /LANDS/);
});

test('проверка кубом: состояние нормализуется, инструкция рассказчику по настройке', () => {
  const f = normalizeFate({ check: { id: 'x', label: 'удар', dc: 99, mode: 'вздор', roll: { dice: [4], roll: 4, outcome: 'hit', sev: 1 } } });
  assert.equal(f.check.dc, 20); assert.equal(f.check.mode, 'normal'); assert.equal(f.check.roll.outcome, 'hit');
  assert.equal(normalizeFate({ check: { dc: 'abc' } }).check, null);
  assert.equal(normalizeFate({ check: { dc: 10, roll: { dice: [1], roll: 1, outcome: 'взрыв' } } }).check.roll, null);
  assert.equal(fateLines(normalizeFate({})).some(l => /КУБ/.test(l)), false);
  assert.equal(fateLines(normalizeFate({}), { diceCheck: true }).some(l => /КУБ/.test(l)), true);
});

import { rollCheck as rollCheckCore } from '../src/core/fate.js';
test('проверка кубом принимает выпавшие кубики: 1d20 обычный, 2d20 с преимуществом (лучший) и помехой (худший)', () => {
  const r = (mode, dice, dc = 12) => rollCheckCore({ dc, mode, dice, random: () => 0.5 });
  assert.deepEqual(r('normal', [15]), { dice: [15], roll: 15, outcome: 'dodge', sev: 0 });
  assert.deepEqual(r('normal', [7]), { dice: [7], roll: 7, outcome: 'hit', sev: 1 });
  assert.equal(r('normal', [1]).outcome, 'crit-hit'); assert.equal(r('normal', [20]).outcome, 'crit-dodge');
  assert.deepEqual(r('advantage', [5, 17]), { dice: [5, 17], roll: 17, outcome: 'dodge', sev: 0 });
  assert.deepEqual(r('disadvantage', [5, 17]), { dice: [5, 17], roll: 5, outcome: 'hit', sev: 1 });
  // кубики не по режиму или кривые игнорируются: бросок идёт как раньше
  assert.equal(r('normal', [5, 17]).dice.length, 1);
  assert.equal(r('advantage', [5]).dice.length, 2);
  assert.equal(r('normal', [0]).roll, 11); assert.equal(r('normal', ['7']).roll, 11); assert.equal(r('normal', [21]).roll, 11);   // random 0.5 -> 11
});

import { detectAutoMode as dam } from '../src/core/fate.js';
test('чужой лагерь (Лагерь гоблинов) не включает режим «Лагерь»; свой лагерь и привал включают', () => {
  assert.equal(dam({ text: 'Вы торгуетесь у костра в лагере.', place: 'Лагерь гоблинов' }), null);
  assert.equal(dam({ text: 'Он вышел к воротам.', place: 'Гоблинский лагерь' }), null);
  assert.equal(dam({ text: 'Тишина.', place: 'Лагерь' })?.mode, 'camp');
  assert.equal(dam({ text: 'Тишина.', place: 'Наш лагерь' })?.mode, 'camp');
  assert.equal(dam({ text: 'Отряд разбил лагерь на ночь.', place: 'Роща' })?.mode, 'camp');
  assert.equal(dam({ text: 'Они сидят в лагере у огня.', place: '' })?.mode, 'camp');
  assert.deepEqual(dam({ text: 'Шум.', place: 'Лагерь гоблинов', mode: 'camp', auto: true }), { mode: '', auto: false, back: null });
});

test('d20 жизни: проверка-действие (обман, скрытность): исходы, подсказка, вид по умолчанию и в состоянии', () => {
  assert.deepEqual(parseCheck('Стражник щурится.\n[[КУБ: обмануть стражника | сложность 14 | преимущество | действие]]'), { label: 'обмануть стражника', dc: 14, mode: 'advantage', kind: 'skill' });
  assert.equal(parseCheck('[[КУБ: пройти незамеченной | сложность 12 | обычно | навык]]').kind, 'skill');
  assert.equal(parseCheck('[[КУБ: клинок | сложность 12 | обычно | уворот]]').kind, 'dodge');
  assert.equal(parseCheck('[[КУБ: клинок | сложность 12]]').kind, 'dodge');                      // прежний формат остаётся уворотом
  const seq = (...n) => { let i = 0; return () => (n[i++] - 1) / 20 + 0.001; };
  const skill = (dc, ...rolls) => rollCheck({ dc, kind: 'skill', random: seq(...rolls) });
  assert.equal(skill(12, 11).outcome, 'fail'); assert.equal(skill(12, 12).outcome, 'success');
  assert.equal(skill(12, 1).outcome, 'crit-fail'); assert.equal(skill(12, 20).outcome, 'crit-success');
  assert.equal(skill(12, 1).sev, 0);                                                              // попытка ран не наносит
  assert.match(checkDirective({ label: 'обман', mode: 'normal', dc: 12 }, skill(12, 5)), /FAILS/);
  assert.match(checkDirective({ label: 'обман', mode: 'normal', dc: 12 }, skill(12, 15)), /SUCCEEDS/);
  const f = normalizeFate({ check: { id: 'y', kind: 'skill', label: 'обман', dc: 10, mode: 'normal', roll: { dice: [3], roll: 3, outcome: 'fail', sev: 0 } } });
  assert.equal(f.check.kind, 'skill'); assert.equal(f.check.roll.outcome, 'fail');
  assert.equal(normalizeFate({ check: { dc: 10, kind: 'вздор' } }).check.kind, 'dodge');
  assert.match(CHECK_INSTRUCTION, /never in an intimate scene/);
  assert.match(CHECK_INSTRUCTION, /действие/);
});

test('накал: вид близости выбирается кнопками (несколько), нормализуется и уходит рассказчику', () => {
  assert.deepEqual(HEAT_ACT_IDS, ['petting', 'vaginal', 'oral', 'anal', 'masturbation', 'fingering', 'frottage', 'intercrural', 'mammary']);
  assert.deepEqual(HEAT_ACTS.filter(a => a.more).map(a => a.id), ['fingering', 'frottage', 'intercrural', 'mammary']);   // за стрелочкой
  assert.ok(HEAT_ACTS.every(a => a.ru && a.en && a.hint));
  assert.ok(!HEAT_ACT_IDS.includes('caress'));                              // ласки уже есть в зоне накала «Жар»
  let h = moveHeat(null, { zone: 'hot' });
  assert.deepEqual(h.acts, []);
  h = moveHeat(h, { act: 'oral' }); h = moveHeat(h, { act: 'petting' });
  assert.deepEqual(h.acts, ['petting', 'oral']);                             // порядок как в списке, не как нажимали
  h = moveHeat(h, { act: 'oral' });
  assert.deepEqual(h.acts, ['petting']);                                     // повторное нажатие снимает
  assert.deepEqual(moveHeat(h, { act: 'вздор' }).acts, ['petting']);
  assert.deepEqual(normalizeHeat({ zone: 'hot', acts: ['vaginal', 'oral', 'oral', 'нет', 'classic'] }).acts, ['vaginal', 'oral']);
  assert.deepEqual(normalizeHeat({ zone: 'hot' }).acts, []);
  const line = heatLines(h).find(l => l.startsWith('kind of intimacy'));
  assert.match(line, /hands on intimate areas, clothed or not; no penetration, no oral/);
  assert.ok(!heatLines(moveHeat(null, { zone: 'warm' })).some(l => l.startsWith('kind of intimacy')));   // ничего не выбрано: строки нет
  h.nudgeSent = true;
  assert.ok(heatLines(h).some(l => l.startsWith('kind of intimacy')));       // вид держится все ходы, не одноразовый
});

test('наборы режимов: приключение и обычная жизнь, Драка вместо Боя, Интим общий, переключение', () => {
  assert.deepEqual(SET_IDS, ['adventure', 'daily']);
  assert.deepEqual(modesOf('adventure').map(m => m.ru), ['Приключение', 'Город', 'Лагерь', 'Бой', 'Интим']);
  assert.deepEqual(modesOf('daily').map(m => m.ru), ['Дом', 'Работа', 'Отдых', 'Драка', 'Интим']);
  assert.equal(modesOf('daily').find(m => m.id === 'fight').id, 'fight');                           // тот же режим под другим именем: Бой и Драка главнее остальных
  assert.match(modesOf('daily').find(m => m.id === 'fight').rule, /no weapons unless/);
  assert.equal(modesOf('daily').find(m => m.id === 'intimacy').ru, modesOf('adventure').find(m => m.id === 'intimacy').ru);   // интим тот же
  assert.deepEqual(modesOf('мусор').map(m => m.id), MODE_SETS.adventure.modes);                     // неизвестный набор: приключенческий
  for (const set of Object.values(MODE_SETS)) for (const k of set.nudges) { assert.ok(NUDGES[k]); assert.match(NUDGES[k].text, /not forced/); }
  assert.equal(normalizeFate({ set: 'daily', mode: 'home' }).set, 'daily');
  assert.equal(normalizeFate({ set: 'вздор' }).set, 'adventure');
  assert.equal(emptyFate().set, 'adventure');
  assert.equal(fateLines({ ...emptyFate(), set: 'daily', mode: 'work' })[0].startsWith('scene mode: work'), true);
  for (const id of ['home', 'work', 'leisure', 'brawl']) {
    assert.ok(TABLES[id].length >= 5);
    const hit = rollEvent({ modeId: id, random: () => 0.5 });
    assert.ok(hit && hit.en);
  }
});

test('обычная жизнь: Дом, Работа, Отдых по месту и словам; Драка по боевым действиям; ручной режим не трогается', () => {
  assert.equal(detectDailyMode({ text: 'Тишина.', place: 'Квартира Арвенна' })?.mode, 'home');
  assert.equal(detectDailyMode({ text: 'Тишина.', place: 'Город › Офис на третьем этаже' })?.mode, 'work');
  assert.equal(detectDailyMode({ text: 'Тишина.', place: 'Кафе у набережной' })?.mode, 'leisure');
  assert.equal(detectDailyMode({ text: 'Они вернулись домой поздно.', place: '' })?.mode, 'home');
  assert.equal(detectDailyMode({ text: 'Тишина.', place: 'Кафе', mode: 'work', auto: false }), null);              // ручной режим держится
  assert.equal(detectDailyMode({ text: 'Тишина.', place: 'Кафе', mode: 'work', auto: true })?.mode, 'leisure');    // авто-режим сменяется
  const fight = detectDailyMode({ text: 'Он ударил.', combat: true, mode: 'home', auto: false });
  assert.equal(fight.mode, 'fight'); assert.deepEqual(fight.back, { mode: 'home', auto: false });
  assert.equal(detectDailyMode({ text: 'Шум.', combat: true, mode: 'intimacy' }), null);                           // Интим главнее
  assert.deepEqual(detectDailyMode({ text: 'Тихо.', place: '', level: 0, mode: 'fight', auto: true, back: { mode: 'home', auto: false } }), { mode: 'home', auto: false, back: null });
  assert.equal(detectDailyMode({ text: 'Просто день.', place: 'Улица' }), null);
});
