import test from 'node:test';
import assert from 'node:assert/strict';
import { CALENDARS, ORDER, yearLength } from '../extension/src/core/calendars.js';
import { addMinutes, resolveTime, partOfDay, skipMinutes, parseDuration, formatTime, validDate } from '../extension/src/core/clock.js';
import { defaultState, normalizeState, trimTimeline, hasStep, addEvent, lastIndex } from '../extension/src/core/state.js';
import { buildSceneBlock, describeDate, holidaysToday, enabledLayers } from '../extension/src/core/scene-text.js';

test('длины годов сходятся с данными', () => {
  assert.equal(yearLength(CALENDARS.exandria, 835), 328);
  assert.equal(yearLength(CALENDARS.eberron, 998), 336);
  assert.equal(yearLength(CALENDARS.greyhawk, 576), 364);
  assert.equal(yearLength(CALENDARS.harptos, 1492), 366);
  assert.equal(yearLength(CALENDARS.harptos, 1493), 365);
  assert.equal(yearLength(CALENDARS.golarion, 4724), 366);
  assert.equal(yearLength(CALENDARS.earth, 2025), 365);
  assert.equal(yearLength(CALENDARS.earth, 2024), 366);
  assert.equal(yearLength(CALENDARS.earth, 2100), 365);      // кратен 100, не кратен 400
  assert.equal(yearLength(CALENDARS.earth, 2000), 366);      // кратен 400
  assert.equal(ORDER.length, 6);
});

test('время переходит через полночь и через конец года', () => {
  const t = addMinutes('eberron', { year: 998, doy: 336, minutes: 23 * 60 + 50 }, 20);
  assert.deepEqual(t, { year: 999, doy: 1, minutes: 10 });
  const back = addMinutes('eberron', { year: 999, doy: 1, minutes: 10 }, -20);
  assert.deepEqual(back, { year: 998, doy: 336, minutes: 23 * 60 + 50 });
});

test('подпись времени суток по границам', () => {
  const cases = [[0, 'ночь'], [4 * 60 + 59, 'ночь'], [5 * 60, 'утро'], [10 * 60 + 59, 'утро'], [11 * 60, 'день'], [16 * 60 + 59, 'день'], [17 * 60, 'вечер'], [21 * 60 + 59, 'вечер'], [22 * 60, 'ночь'], [23 * 60 + 59, 'ночь']];
  for (const [m, p] of cases) assert.equal(partOfDay(m), p, `${m} мин`);
});

test('быстрые прыжки: до утра и до вечера', () => {
  assert.equal(skipMinutes('morning', { minutes: 17 * 60 + 40 }), 12 * 60 + 20);      // 17:40 -> 06:00 следующего дня
  assert.equal(skipMinutes('morning', { minutes: 3 * 60 }), 3 * 60);                    // 03:00 -> 06:00 этого дня
  assert.equal(skipMinutes('evening', { minutes: 9 * 60 }), 8 * 60);
  assert.equal(skipMinutes('d1', { minutes: 0 }), 1440);
  assert.equal(skipMinutes('нет такого', { minutes: 0 }), 0);
});

test('разбор длительности', () => {
  assert.equal(parseDuration('2 дня 4 часа'), 2 * 1440 + 240);
  assert.equal(parseDuration('90 мин'), 90);
  assert.equal(parseDuration('3д'), 3 * 1440);
  assert.equal(parseDuration('+5ч'), 300);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('куда-то'), null);
  assert.equal(parseDuration(''), null);
});

test('лента: время откатывается вместе с удалением сообщения', () => {
  const s = defaultState('harptos');                         // 08:00, день 1
  addEvent(s, { type: 'step', at: 1, minutes: 10 });
  addEvent(s, { type: 'step', at: 3, minutes: 10 });
  addEvent(s, { type: 'skip', at: 3, minutes: 120 });
  assert.equal(formatTime(resolveTime(s, 4).minutes), '10:20');
  assert.equal(formatTime(resolveTime(s, 3).minutes), '08:10');   // сообщение 3 удалено
  assert.equal(resolveTime(s, 0).minutes, 8 * 60);
  assert.equal(trimTimeline(s, 3), true);
  assert.equal(s.timeline.length, 1);
});

test('на сообщение один шаг; set перекрывает всё прежнее', () => {
  const s = defaultState('exandria');
  addEvent(s, { type: 'step', at: 1, minutes: 10 });
  assert.equal(hasStep(s, 1), true);
  assert.equal(hasStep(s, 2), false);
  addEvent(s, { type: 'set', at: 2, year: 835, doy: 100, minutes: 600 });
  addEvent(s, { type: 'step', at: 3, minutes: 30 });
  assert.deepEqual(resolveTime(s, 5), { year: 835, doy: 100, minutes: 630 });
  assert.equal(lastIndex(0), 0);
  assert.equal(lastIndex(7), 6);
});

test('проверка даты', () => {
  assert.equal(validDate('eberron', 998, 336, 0), true);
  assert.equal(validDate('eberron', 998, 337, 0), false);
  assert.equal(validDate('harptos', 1492, 366, 1439), true);
  assert.equal(validDate('harptos', 1493, 366, 0), false);
  assert.equal(validDate('нет', 1, 1, 0), false);
});

test('normalizeState отбрасывает мусор и держит рабочий вид', () => {
  assert.deepEqual(normalizeState(null).timeline, []);
  const dirty = {
    calendar: 'golarion', start: { year: 4725, doy: 999, minutes: 5000 },
    timeline: [{ type: 'step', at: 1, minutes: 10 }, { type: 'взрыв', at: 1 }, { type: 'set', at: 2, year: 4725, doy: 400, minutes: 0 }, null, { type: 'skip', at: -4, minutes: 5 }],
    place: 'Город › Таверна',
  };
  const s = normalizeState(dirty);
  assert.equal(s.calendar, 'golarion');
  assert.deepEqual(s.start, { year: 4725, doy: 1, minutes: 480 });   // кривая опорная точка заменена
  assert.equal(s.timeline.length, 1);
  assert.equal(s.place, 'Город › Таверна');
  assert.equal(normalizeState({ calendar: 'нет' }).calendar, 'harptos');
});

test('блок для рассказчика: время, дата, праздник, место', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 14, minutes: 17 * 60 + 40 };        // Хаммер 14
  s.place = 'Побережье Мечей › Глубоководье › Зевающий Портал';
  const layers = enabledLayers({}, 'harptos');                     // по умолчанию: Глубоководье, дроу, эльфы
  const text = buildSceneBlock({ state: s, time: resolveTime(s, 1), layers });
  assert.match(text, /time: story day 14, 17:40, вечер/);
  assert.match(text, /date: Хаммер, 14, 1492 ЛД, зима/);
  assert.match(text, /place: Побережье Мечей/);
  assert.doesNotMatch(text, /holiday today/);                       // 14 Хаммера праздников нет
  // Альтуриак 14 = день 30 + 1 (Середина зимы) + 14 = 45 -> «Великое веселье» (Глубоководье)
  s.start = { year: 1492, doy: 45, minutes: 600 };
  const t2 = buildSceneBlock({ state: s, time: resolveTime(s, 1), layers });
  assert.match(t2, /holiday today: Великое веселье/);
  assert.doesNotMatch(buildSceneBlock({ state: s, time: resolveTime(s, 1), layers, sendHolidays: false }), /holiday/);
});

test('праздничный день Харптоса и слои', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 31, minutes: 0 };                    // Середина зимы
  const on = enabledLayers({}, 'harptos');
  const d = describeDate('harptos', resolveTime(s, 1), on);
  assert.equal(d.festival, true);
  assert.equal(d.name, 'Середина зимы');
  assert.ok(d.holidays.some(h => h.en.includes('Masked Lord')));    // слой «Дроу» включён по умолчанию
  const none = enabledLayers({ layers: { harptos: [] } }, 'harptos');
  assert.equal(holidaysToday('harptos', { year: 1492, doy: 31, minutes: 0 }, none).length, 0);
});

test('Эберрон: двухдневный праздник по промежутку', () => {
  // Сифероз 18–19: месяц 10, дни 252+18 = 270, 271
  const t = (doy) => holidaysToday('eberron', { year: 998, doy, minutes: 0 }, enabledLayers({}, 'eberron'));
  assert.equal(t(9 * 28 + 18).length, 1);
  assert.equal(t(9 * 28 + 19).length, 1);
  assert.equal(t(9 * 28 + 20).length, 0);
});
