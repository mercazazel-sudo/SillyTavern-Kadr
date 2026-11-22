import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWeather, resolveWeather, tempAt, dayKey, seasonFor, KINDS, KIND_IDS, CLIMATE_IDS, describeWeather } from '../src/core/weather.js';
import { defaultState, normalizeState, addEvent } from '../src/core/state.js';
import { resolveTime } from '../src/core/clock.js';
import { buildSceneBlock, enabledLayers } from '../src/core/scene-text.js';

test('погода детерминирована: та же дата и климат дают то же самое', () => {
  const a = generateWeather('harptos', 1492, 40, 'temperate');
  const b = generateWeather('harptos', 1492, 40, 'temperate');
  assert.deepEqual(a, b);
  const salted = new Set(Array.from({ length: 30 }, (_, i) => generateWeather('harptos', 1492, 40, 'temperate', 's' + i).kind));
  assert.ok(salted.size > 1, 'соль должна менять результат');
});

test('любая погода из списка, температура числом, и климат меняет картину', () => {
  const kinds = new Set();
  for (const climate of CLIMATE_IDS) {
    for (let doy = 1; doy <= 366; doy++) {
      const w = generateWeather('harptos', 1492, doy, climate);
      assert.ok(KIND_IDS.includes(w.kind), `${climate}: ${w.kind}`);
      assert.ok(Number.isFinite(w.tempC));
      kinds.add(w.kind);
    }
  }
  assert.equal(kinds.size, KIND_IDS.length, 'за год во всех климатах выпадают все виды погоды');
});

test('климаты: в пустыне нет снега, на севере зимой холоднее, в тропиках тепло', () => {
  const sample = (climate, season) => {
    const out = [];
    for (let doy = 1; doy <= 366; doy++) if (seasonFor('harptos', 1492, doy) === season) out.push(generateWeather('harptos', 1492, doy, climate));
    return out;
  };
  assert.equal(sample('desert', 'зима').some(w => w.kind === 'snow'), false);
  const avg = list => list.reduce((s, w) => s + w.tempC, 0) / list.length;
  assert.ok(avg(sample('north', 'зима')) < avg(sample('temperate', 'зима')) - 5);
  assert.ok(avg(sample('tropics', 'зима')) > avg(sample('temperate', 'зима')) + 5);
  assert.ok(sample('temperate', 'зима').filter(w => w.kind === 'snow').every(w => w.tempC <= 0), 'снег только при температуре не выше нуля');
});

test('экзандрия без сезонов: сезон берётся по доле года', () => {
  assert.equal(seasonFor('exandria', 835, 5), 'зима');
  assert.equal(seasonFor('exandria', 835, 150), 'лето');
  assert.ok(['зима', 'весна', 'лето', 'осень'].includes(seasonFor('exandria', 835, 300)));
});

test('температура в течение суток: ночью холоднее, днём теплее', () => {
  assert.equal(tempAt(10, 2 * 60), 7);
  assert.equal(tempAt(10, 8 * 60), 9);
  assert.equal(tempAt(10, 13 * 60), 12);
  assert.equal(tempAt(10, 19 * 60), 10);
});

test('ручная погода перекрывает расчётную только в свой день и откатывается с сообщением', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 40, minutes: 600 };
  const time = resolveTime(s, 5);
  const auto = resolveWeather(s, time, 5);
  assert.equal(auto.manual, false);
  addEvent(s, { type: 'weather', at: 4, day: dayKey(1492, 40), kind: 'fog', tempC: 3, text: '' });
  const manual = resolveWeather(s, time, 5);
  assert.deepEqual([manual.kind, manual.tempC, manual.manual], ['fog', 3, true]);
  // другой день: ручная правка не действует
  const other = resolveWeather(s, { year: 1492, doy: 41, minutes: 600 }, 5);
  assert.equal(other.manual, false);
  // сообщение 4 удалено (в чате осталось 4 сообщения: индексы 0..3): правка откатилась
  assert.equal(resolveWeather(s, time, 4).manual, false);
  // выключено в настройках
  assert.equal(resolveWeather(s, time, 5, false), null);
});

test('normalizeState: события погоды очищаются, климат проверяется', () => {
  const dirty = { calendar: 'harptos', climate: 'ад', timeline: [
    { type: 'weather', at: 1, day: '1492:40', kind: 'snow', tempC: 999, text: 'x'.repeat(200) },
    { type: 'weather', at: 1, day: 'вчера', kind: 'snow' },
    { type: 'weather', at: 1, day: '1492:40', kind: 'метеорит' },
    { type: 'weather', at: 2, day: '1492:41', kind: 'rain', tempC: null },
  ] };
  const s = normalizeState(dirty);
  assert.equal(s.climate, 'temperate');
  assert.equal(s.timeline.length, 2);
  assert.equal(s.timeline[0].tempC, 70);
  assert.equal(s.timeline[0].text.length, 60);
  assert.equal(s.timeline[1].tempC, null);
});

test('погода в блоке рассказчика и в подписи', () => {
  const s = defaultState('harptos');
  s.start = { year: 1492, doy: 14, minutes: 17 * 60 };
  addEvent(s, { type: 'weather', at: 0, day: dayKey(1492, 14), kind: 'rain', tempC: 4, text: '' });
  const time = resolveTime(s, 1);
  const w = resolveWeather(s, time, 1);
  const block = buildSceneBlock({ state: s, time, layers: enabledLayers({}, 'harptos'), weather: w });
  assert.match(block, /weather outdoors: дождь, \+4°C/);
  assert.doesNotMatch(buildSceneBlock({ state: s, time, layers: enabledLayers({}, 'harptos'), weather: null }), /weather/);
  assert.equal(describeWeather({ kind: 'clear', tempC: -3, text: '' }), 'ясно, -3°C');
  assert.equal(describeWeather({ kind: 'rain', tempC: 6, text: 'моросит' }), 'моросит, +6°C');
  assert.equal(describeWeather(null), '');
  assert.equal(KINDS.rain.icon, '☂');
});
