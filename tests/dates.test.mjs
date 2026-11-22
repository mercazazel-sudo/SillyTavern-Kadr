import test from 'node:test';
import assert from 'node:assert/strict';
import { CALENDARS, locate } from '../extension/src/core/calendars.js';
import { formatDateText, parseDateText } from '../extension/src/core/dates.js';

const H = CALENDARS.harptos, E = CALENDARS.earth;
const at = (cal, year, doy) => { const l = locate(cal, year, doy); return `${l.period.id}:${l.day}`; };
const ok = (cal, text, def) => { const r = parseDateText(cal, text, def); assert.ok(!r.error, `${text}: ${r.error}`); return `${r.year} ${at(cal, r.year, r.doy)}`; };

test('дата словами и обратно', () => {
  assert.equal(formatDateText(H, 1492, 1), '1 Хаммер 1492');
  assert.equal(formatDateText(E, 2026, 325), '21 Ноябрь 2026');
  const r = parseDateText(H, formatDateText(H, 1492, 123), 1492);
  assert.equal(r.doy, 123);
  const f = parseDateText(H, formatDateText(H, 1492, 31), 1492);                  // праздничный день Середина зимы
  assert.equal(f.doy, 31);
});

test('ввод руками: имя месяца в любой форме, номера, разделители, год по умолчанию', () => {
  assert.equal(ok(H, '1 Хаммер 1492', 1000), '1492 hammer:1');
  assert.equal(ok(H, 'хаммер 5 1492', 1000), '1492 hammer:5');
  assert.equal(ok(H, 'Хаммер, 5, 1492 ЛД', 1000), '1492 hammer:5');
  assert.equal(ok(H, '14 альтуриака', 1492), '1492 alturiak:14');                  // родительный падеж
  assert.equal(ok(H, 'Хаммер 5', 1492), '1492 hammer:5');                          // год по умолчанию
  assert.equal(ok(H, 'Хаммер 1500', 1492), '1500 hammer:1');                       // одно большое число после имени: год
  assert.equal(ok(E, '21.11.2026', 1999), '2026 november:21');
  assert.equal(ok(E, '21 ноября', 2026), '2026 november:21');                       // падеж через псевдоним
  assert.equal(ok(E, '9 мая 2025 н. э.', 2026), '2025 may:9');
  assert.equal(ok(E, '1 май', 2026), '2026 may:1');
  assert.equal(ok(E, '1 март', 2026), '2026 march:1');                              // «ма…» не путает май и март
  assert.equal(ok(E, '29 февраля 2024', 2026), '2024 february:29');
  assert.equal(ok(E, '3.4', 2026), '2026 march:3'.replace('march', 'april'));      // день.месяц без года
  assert.equal(ok(H, 'середина зимы 1492', 1), '1492 midwinter:1');                // праздничный день без числа
});

test('ввод руками: ошибки понятны, ничего не угадывается', () => {
  assert.match(parseDateText(E, '', 2026).error, /Введите/);
  assert.match(parseDateText(E, '30 февраля 2026', 2026).error, /28 дн/);           // в 2026 году 28
  assert.equal(parseDateText(E, '29 февраля 2024', 2026).error, undefined);
  assert.match(parseDateText(E, '29 февраля 2025', 2026).error, /28 дн/);
  assert.match(parseDateText(E, '5 абракадабра', 2026).error, /Не нашёл месяц/);
  assert.match(parseDateText(E, '5 13 2026', 2026).error, /номер 13/);
  assert.match(parseDateText(E, '5', 2026).error, /хотя бы день и месяц/);
  assert.match(parseDateText(H, 'щитовой сход 1491', 1492).error, /нет «Щитовой сход»/);          // 1491 не кратен 4
  assert.equal(parseDateText(H, 'щитовой сход 1492', 1492).error, undefined);
});
