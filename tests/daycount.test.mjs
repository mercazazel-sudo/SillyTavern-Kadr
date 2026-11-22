import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { daysBetween, dayNumber, shiftDate, resolveTime, addMinutes } from '../extension/src/core/clock.js';
import { defaultState, normalizeState, addEvent } from '../extension/src/core/state.js';
import { describeDate, buildSceneBlock, enabledLayers } from '../extension/src/core/scene-text.js';
import { convertKulisy } from '../extension/src/core/kulisy-import.js';
import { yearLength, CALENDARS } from '../extension/src/core/calendars.js';

test('дни между датами: в пределах года, через конец года и назад', () => {
  assert.equal(daysBetween('eberron', { year: 998, doy: 10 }, { year: 998, doy: 15 }), 5);
  assert.equal(daysBetween('eberron', { year: 998, doy: 336 }, { year: 999, doy: 1 }), 1);
  assert.equal(daysBetween('harptos', { year: 1492, doy: 360 }, { year: 1493, doy: 2 }), yearLength(CALENDARS.harptos, 1492) - 360 + 2);
  assert.equal(daysBetween('harptos', { year: 1492, doy: 100 }, { year: 1494, doy: 100 }), yearLength(CALENDARS.harptos, 1492) + yearLength(CALENDARS.harptos, 1493));
  assert.equal(daysBetween('eberron', { year: 999, doy: 3 }, { year: 998, doy: 334 }), -5);
  assert.equal(daysBetween('нет', { year: 1, doy: 1 }, { year: 5, doy: 5 }), 0);
});

test('номер дня истории: день 1 это dayOne, до него 0 и минус', () => {
  const one = { year: 998, doy: 20 };
  assert.equal(dayNumber('eberron', one, { year: 998, doy: 20 }), 1);
  assert.equal(dayNumber('eberron', one, { year: 998, doy: 22 }), 3);
  assert.equal(dayNumber('eberron', one, { year: 998, doy: 19 }), 0);
  assert.equal(dayNumber('eberron', one, { year: 999, doy: 1 }), 336 - 20 + 1 + 1);
});

test('сдвиг даты и обратная задача «сегодня день N»', () => {
  const today = { year: 1492, doy: 236 };
  const dayOne = shiftDate('harptos', today, -(3 - 1));         // сегодня Д3
  assert.deepEqual(dayOne, { year: 1492, doy: 234 });
  assert.equal(dayNumber('harptos', dayOne, today), 3);
  assert.deepEqual(shiftDate('eberron', { year: 998, doy: 2 }, -5), { year: 997, doy: 333 });
});

test('счётчик идёт с наступлением суток и откатывается с сообщением', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 10, minutes: 22 * 60 };
  s.dayOne = { year: 1492, doy: 10 };
  const layers = enabledLayers({}, 'harptos');
  const day = len => describeDate('harptos', resolveTime(s, len), layers, s.dayOne).storyDay;
  assert.equal(day(1), 1);
  addEvent(s, { type: 'skip', at: 1, minutes: 3 * 60 });          // 01:00 следующих суток
  assert.equal(day(2), 2);
  assert.equal(day(1), 1);                                          // сообщение удалено: день вернулся
  addEvent(s, { type: 'skip', at: 2, minutes: 2 * 1440 });
  assert.equal(day(3), 4);
});

test('normalizeState: dayOne по умолчанию равен дате начала, кривой заменяется', () => {
  const s = normalizeState({ calendar: 'harptos', start: { year: 1492, doy: 40, minutes: 600 } });
  assert.deepEqual(s.dayOne, { year: 1492, doy: 40 });
  const ok = normalizeState({ calendar: 'harptos', start: { year: 1492, doy: 40, minutes: 600 }, dayOne: { year: 1492, doy: 234 } });
  assert.deepEqual(ok.dayOne, { year: 1492, doy: 234 });
  const bad = normalizeState({ calendar: 'harptos', start: { year: 1492, doy: 40, minutes: 600 }, dayOne: { year: 1492, doy: 999 } });
  assert.deepEqual(bad.dayOne, { year: 1492, doy: 40 });
  assert.deepEqual(defaultState('exandria').dayOne, { year: 835, doy: 1 });
});

test('блок рассказчику: день истории в строке времени', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 236, minutes: 7 * 60 };
  s.dayOne = { year: 1492, doy: 234 };
  const time = resolveTime(s, 1);
  const block = buildSceneBlock({ state: s, time, layers: enabledLayers({}, 'harptos') });
  assert.match(block, /time: story day 3, 07:00, утро/);
});

test('импорт из Кулис несёт номер дня', () => {
  const ku = { world: { clock: { label: '22 Элесиаса', day: 3, time: '07:00' } }, ui: { calendar: { anchor: '1492-08-20', system: { id: 'harptos-dr' } } } };
  const plan = convertKulisy(ku, 'harptos');
  assert.equal(plan.dayNumber, 3);
  assert.equal(convertKulisy({ world: { clock: { label: '22 Элесиаса', time: '07:00' } } }, 'harptos').dayNumber, null);
  assert.equal(convertKulisy({ world: { clock: { day: 0 } } }, 'harptos').dayNumber, null);
  // как это ляжет в наше состояние
  const dayOne = shiftDate('harptos', { year: plan.date.year, doy: plan.date.doy }, -(plan.dayNumber - 1));
  assert.equal(dayNumber('harptos', dayOne, plan.date), 3);
});

const exportPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'exports', 'local-only-export.json');
test('Нарратор1: после переноса сегодня Д3, а время ещё идёт', { skip: !existsSync(exportPath) }, () => {
  const plan = convertKulisy(JSON.parse(readFileSync(exportPath, 'utf8')).kulisy, 'harptos');
  assert.equal(plan.dayNumber, 3);
  const s = defaultState('harptos');
  s.start = { year: plan.date.year, doy: plan.date.doy, minutes: plan.date.minutes };
  s.dayOne = shiftDate('harptos', plan.date, -(plan.dayNumber - 1));
  const layers = enabledLayers({}, 'harptos');
  assert.equal(describeDate('harptos', resolveTime(s, 1), layers, s.dayOne).storyDay, 3);
  addEvent(s, { type: 'skip', at: 1, minutes: 17 * 60 });          // до полуночи: 07:00 + 17 ч = 24:00 → следующий день
  assert.equal(describeDate('harptos', resolveTime(s, 2), layers, s.dayOne).storyDay, 4);
  assert.equal(addMinutes('harptos', { year: 1492, doy: 236, minutes: 420 }, 17 * 60).doy, 237);
});
