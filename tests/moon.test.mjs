import test from 'node:test';
import assert from 'node:assert/strict';
import { moonsOf, moonPhase, moonSvg, phaseOf, PHASES } from '../extension/src/core/moon.js';
import { CALENDARS, yearLength } from '../extension/src/core/calendars.js';

const events = (cal, year, days, i = 0, period = {}) => {
  const moon = moonsOf(cal, period)[i];
  const out = { full: 0, new: 0 };
  for (let d = 1; d <= days; d++) { const e = moonPhase(cal, moon, year, d).event; if (e) out[e] += 1; }
  return out;
};

test('у каждого мира свой набор лун: Грейхок две, Эберрон луна месяца, остальные одна', () => {
  assert.equal(moonsOf('harptos', {}).length, 1);
  assert.equal(moonsOf('exandria', {}).length, 1);
  assert.equal(moonsOf('golarion', {}).length, 1);
  assert.deepEqual(moonsOf('greyhawk', {}).map(m => m.cycle), [28, 91]);
  assert.equal(moonsOf('eberron', { type: 'month', ru: 'Зарантир' })[0].ru, 'Зарантир');
  assert.deepEqual(moonsOf('eberron', { type: 'festival' }), []);
  assert.deepEqual(moonsOf('нет', {}), []);
});

test('за год событий столько, сколько целых циклов: по одному полнолунию и новолунию на цикл', () => {
  assert.deepEqual(events('harptos', 1492, 365), { full: 12, new: 12 });
  assert.deepEqual(events('exandria', 800, 328), { full: 10, new: 10 });      // цикл 33: полнолуние между сутками считается один раз
  assert.deepEqual(events('golarion', 4724, 365), { full: 12, new: 12 });
  assert.deepEqual(events('greyhawk', 591, 364, 0), { full: 13, new: 13 });  // Луна, 28 дней
  assert.deepEqual(events('greyhawk', 591, 364, 1), { full: 4, new: 4 });    // Селена, 91 день
});

test('фаза идёт вместе с календарём: следующий день сдвигает долю цикла на 1/цикл, год к году без разрыва', () => {
  const m = moonsOf('harptos', {})[0];
  const a = moonPhase('harptos', m, 1492, 100), b = moonPhase('harptos', m, 1492, 101);
  assert.ok(Math.abs(((b.f - a.f + 1) % 1) - 1 / m.cycle) < 1e-9);
  const lastDay = yearLength(CALENDARS.harptos, 1492);                              // 1492 високосный: 366 дней
  const last = moonPhase('harptos', m, 1492, lastDay), first = moonPhase('harptos', m, 1493, 1);
  assert.ok(Math.abs(((first.f - last.f + 1) % 1) - 1 / m.cycle) < 1e-9);
  assert.ok(moonPhase('harptos', m, 1400, 10).f >= 0 && moonPhase('harptos', m, 1400, 10).f < 1);    // годы до опорного тоже считаются
});

test('Эберрон: луна месяца, новолуние в первый день, полнолуние на пятнадцатый', () => {
  const eb = moonsOf('eberron', { type: 'month', ru: 'Зарантир', id: 'zarantyr' })[0];
  const at = day => moonPhase('eberron', eb, 998, day, day);
  assert.equal(at(1).event, 'new'); assert.equal(at(15).event, 'full'); assert.equal(at(14).event, ''); assert.equal(at(16).event, '');
  assert.equal(at(15).phase.id, 'full'); assert.equal(at(14).phase.id, 'waxing-gibbous'); assert.equal(at(16).phase.id, 'waning-gibbous');
  assert.equal(at(8).phase.id, 'first-quarter'); assert.equal(at(22).phase.id, 'last-quarter'); assert.equal(at(1).phase.id, 'new'); assert.equal(at(28).phase.id, 'waning-crescent'); assert.equal(at(2).phase.id, 'waxing-crescent');
});

test('названия фаз по доле цикла и значок', () => {
  assert.equal(PHASES.length, 8);
  assert.equal(phaseOf(0).id, 'new'); assert.equal(phaseOf(0.5).id, 'full'); assert.equal(phaseOf(0.25).id, 'first-quarter'); assert.equal(phaseOf(0.75).id, 'last-quarter'); assert.equal(phaseOf(0.99).id, 'new');
  assert.ok(!/class="lt"/.test(moonSvg(0.0, 24, 'new')));                     // день новолуния: только тёмный круг
  assert.match(moonSvg(0.5, 24, 'full'), /<circle class="lt"/);                // день полнолуния: круг закрашен целиком
  assert.match(moonSvg(0.25), /<path class="lt"/); assert.match(moonSvg(0.75), /<path class="lt"/);
  assert.notEqual(moonSvg(0.25), moonSvg(0.75));                               // растущая и убывающая освещены с разных сторон
  assert.match(moonSvg(0.25, 40), /width="40"/);
});

test('соседи пика «надкушены»: у новолуния есть светлый серп, у полнолуния тёмная долька, сам пик чистый', () => {
  assert.match(moonSvg(1 / 30.4), /<path class="lt"/);                         // день после новолуния без события: тонкий серп, а не чёрный круг
  assert.match(moonSvg(1 - 1 / 30.4), /<path class="lt"/);                     // день перед новолунием
  assert.match(moonSvg(14 / 30.4), /<path class="lt"/);                        // день перед полнолунием: не весь белый
  assert.match(moonSvg(16 / 30.4), /<path class="lt"/);                        // день после полнолуния
  assert.ok(!/<circle class="lt"/.test(moonSvg(14 / 30.4)) && !/<circle class="lt"/.test(moonSvg(16 / 30.4)));
  // ширина «укуса» у соседей не нулевая: радиус эллипса терминатора не больше 80% радиуса круга
  const rx = Number(/A([\d.]+) 9\.5 0 0 [01] 12 2\.5z/.exec(moonSvg(14 / 30.4))?.[1]);
  assert.ok(rx > 0 && rx <= 9.5 * 0.8 + 0.01);
});

import { locate } from '../extension/src/core/calendars.js';
import { moonHolidaysOn, moonDayKinds } from '../extension/src/core/moon.js';
import { holidaysToday } from '../extension/src/core/scene-text.js';

const HP = CALENDARS.harptos, ALL = new Set(HP.layers.map(l => l.id));
const yearCount = layers => {
  let n = 0;
  for (let doy = 1; doy <= yearLength(HP, 1492); doy++) { const loc = locate(HP, 1492, doy); n += moonHolidaysOn('harptos', layers, 1492, doy, loc.day, loc.period).length; }
  return n;
};

test('праздники «по луне» встают на дни: сумма по дням года равна числу лунных событий, умноженному на число включённых праздников', () => {
  const m = moonsOf('harptos', {})[0], kinds = { full: 0, new: 0, young: 0 };
  for (let doy = 1; doy <= yearLength(HP, 1492); doy++) for (const k of moonDayKinds('harptos', m, 1492, doy)) kinds[k] += 1;
  assert.ok(kinds.full >= 12 && kinds.full <= 13);                          // год из 366 суток: 12 или 13 полнолуний
  assert.equal(yearCount(ALL), 5 * kinds.full + kinds.new + kinds.young);   // пять полнолунных, один новолунный, один «молодой луны»
  assert.equal(yearCount(new Set(['elves'])), 4 * kinds.full + kinds.young);   // эльфы: четыре на полнолуние и Лате’кор
  assert.equal(yearCount(new Set(['drow'])), kinds.full + kinds.new);          // дроу: Ллос на полнолуние и Вхаэраун на новолуние
  assert.equal(yearCount(new Set()), 0);
  assert.equal(moonHolidaysOn('exandria', null, 800, 5, 5, { type: 'month' }).length, 0);   // у других миров таких праздников нет
});

test('молодая луна выпадает на сутки после новолуния', () => {
  const m = moonsOf('harptos', {})[0];
  let checked = 0;
  for (let doy = 1; doy < 365; doy++) {
    if (moonPhase('harptos', m, 1493, doy).event !== 'new') continue;
    assert.ok(moonDayKinds('harptos', m, 1493, doy + 1).includes('young'));
    assert.ok(!moonDayKinds('harptos', m, 1493, doy).includes('young'));
    checked += 1;
  }
  assert.ok(checked >= 11);
});

test('праздники дня для строки сцены и рассказчика включают лунные в полнолуние и не включают в обычный день', () => {
  const m = moonsOf('harptos', {})[0];
  let full = 0, plain = 0;
  for (let doy = 1; doy <= 365; doy++) {
    const names = holidaysToday('harptos', { year: 1493, doy }, ALL).map(h => h.ru);
    const ev = moonPhase('harptos', m, 1493, doy).event;
    if (ev === 'full') { assert.ok(names.includes('Полуночная игра (Эревен Иллесер)')); full += 1; }
    else if (ev === '' && !moonDayKinds('harptos', m, 1493, doy).length) { assert.ok(!names.includes('Полуночная игра (Эревен Иллесер)')); plain += 1; }
  }
  assert.ok(full >= 11 && plain > 200);
});

test('новолуние и полнолуние называются ровно одним днём, соседние дни это прибывающая и убывающая луна', () => {
  const m = moonsOf('harptos', {})[0];
  const days = { new: 0, full: 0, 'first-quarter': 0, 'last-quarter': 0 }, byDay = [];
  for (let doy = 1; doy <= 366; doy++) { const ph = moonPhase('harptos', m, 1492, doy); byDay.push(ph.phase.id); if (ph.phase.id in days) days[ph.phase.id] += 1; }
  assert.ok(days.full >= 12 && days.full <= 13 && days.new >= 12 && days.new <= 13);                       // по одному дню на каждый цикл
  assert.ok(days['first-quarter'] >= 12 && days['last-quarter'] >= 12);                                    // четверти тоже по одному дню
  for (let i = 1; i < byDay.length - 1; i++) {
    if (byDay[i] === 'full') { assert.equal(byDay[i - 1], 'waxing-gibbous'); assert.equal(byDay[i + 1], 'waning-gibbous'); }
    if (byDay[i] === 'new') { assert.equal(byDay[i - 1], 'waning-crescent'); assert.equal(byDay[i + 1], 'waxing-crescent'); }
  }
  assert.equal(PHASES.map(p => p.ru).join('|'), 'Новолуние|Молодая луна|Первая четверть|Прибывающая|Полнолуние|Убывающая|Последняя четверть|Старая луна');
});
