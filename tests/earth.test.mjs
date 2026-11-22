import test from 'node:test';
import assert from 'node:assert/strict';
import { CALENDARS, locate, weekdayOf, holidaysOf, defaultLayers, yearLength, addDays, seasonOf } from '../extension/src/core/calendars.js';
import { moonsOf, moonPhase } from '../extension/src/core/moon.js';
import { defaultState, normalizeState } from '../extension/src/core/state.js';

const E = CALENDARS.earth;
const doyOf = (y, mo, d) => Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;

test('обычный мир: 12 месяцев, февраль 29 дней в високосный год, даты совпадают с настоящим календарём', () => {
  assert.equal(E.periods(2025).length, 12);
  assert.equal(locate(E, 2024, 60).period.id, 'february');                 // 29 февраля 2024 есть
  assert.equal(locate(E, 2024, 60).day, 29);
  assert.equal(locate(E, 2025, 60).period.id, 'march');                    // в 2025 после 28 февраля сразу март
  assert.equal(locate(E, 2026, doyOf(2026, 12, 31)).day, 31);
  assert.equal(addDays(E, { year: 2025, doy: 365 }, 1).year, 2026);
  assert.equal(addDays(E, { year: 2024, doy: 366 }, 1).year, 2025);
});

test('обычный мир: день недели по настоящему календарю (понедельник = 0)', () => {
  assert.equal(weekdayOf(E, 2026, 1), 3);                                   // 1 января 2026 — четверг
  assert.equal(weekdayOf(E, 2026, doyOf(2026, 3, 8)), 6);                   // 8 марта 2026 — воскресенье
  assert.equal(weekdayOf(E, 2026, doyOf(2026, 7, 4)), 5);                   // 4 июля 2026 — суббота
  assert.equal(weekdayOf(E, 2025, doyOf(2025, 12, 31)), 2);                 // 31 декабря 2025 — среда
  assert.equal(weekdayOf(E, 2024, doyOf(2024, 2, 29)), 3);                  // 29 февраля 2024 — четверг
  assert.equal(weekdayOf(E, 2030, 1), 1);                                   // 1 января 2030 — вторник
  assert.equal(E.week.names[0].ru, 'Понедельник');
});

test('обычный мир: времена года и праздники по слоям-шаблонам', () => {
  assert.equal(seasonOf(E, 2026, doyOf(2026, 1, 15)), 'зима');
  assert.equal(seasonOf(E, 2026, doyOf(2026, 7, 15)), 'лето');
  const layers = defaultLayers(E);
  assert.deepEqual([...layers].sort(), ['ru', 'world']);                    // по умолчанию: Россия и международные
  const jan = E.periods(2026)[0], dec = E.periods(2026)[11];
  const on = (p, set) => holidaysOf(p, set).map(h => `${h.d}:${h.ru}`);
  assert.ok(on(jan, layers).includes('1:Новый год'));
  assert.ok(!on(jan, layers).some(x => x.includes('Богоявление')));         // католические выключены
  assert.ok(on(jan, new Set(['orthodox'])).includes('19:Крещение Господне'));
  assert.ok(on(jan, new Set(['catholic'])).includes('6:Богоявление'));
  assert.ok(on(dec, new Set(['usa'])).includes('25:Рождество'));
  assert.deepEqual(on(dec, new Set()), []);
  // у каждого праздника день внутри месяца, слой существует
  const ids = new Set(E.layers.map(l => l.id));
  for (const p of E.periods(2024)) for (const h of p.holidays) { assert.ok(ids.has(h.layer), h.ru); assert.ok(h.d >= 1 && (h.to ?? h.d) <= p.days, `${p.ru} ${h.ru}`); }
});

test('обычный мир: настоящая Луна по среднему циклу совпадает с календарём 2026 в пределах суток', () => {
  const m = moonsOf('earth', {})[0];
  const ev = (y, mo, d) => moonPhase('earth', m, y, doyOf(y, mo, d)).event;
  assert.equal(ev(2026, 1, 3), 'full');                                      // полнолуние 3 января 2026
  assert.equal(ev(2026, 1, 18), 'new');                                      // новолуние 18 января 2026
  assert.equal(ev(2026, 2, 17), 'new');                                      // новолуние 17 февраля 2026
  assert.equal(moonPhase('earth', m, 2026, doyOf(2026, 1, 10)).phase.id.includes('quarter') || moonPhase('earth', m, 2026, doyOf(2026, 1, 10)).phase.id.includes('gibbous'), true);
  assert.equal(m.note.includes('суток'), true);
});

test('обычный мир: новая история начинается сегодня, остальные миры с опорного года', () => {
  const s = defaultState('earth'), d = new Date();
  assert.equal(s.calendar, 'earth');
  assert.equal(s.start.year, d.getFullYear());
  assert.equal(s.start.doy, doyOf(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  assert.deepEqual(s.dayOne, { year: s.start.year, doy: s.start.doy });
  assert.deepEqual(defaultState('harptos').start, { year: 1492, doy: 1, minutes: 480 });
  assert.equal(normalizeState({ calendar: 'earth' }).calendar, 'earth');
});
