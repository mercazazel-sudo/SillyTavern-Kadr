import test from 'node:test';
import assert from 'node:assert/strict';
import { detectWeatherChange, narrationOnly } from '../extension/src/core/weather-detect.js';

const kind = text => detectWeatherChange(text)?.kind ?? null;

test('начало осадков', () => {
  assert.equal(kind('Вдруг пошёл дождь, крупные капли застучали по крыше.'), 'rain');
  assert.equal(kind('Через минуту хлынул ливень.'), 'rain');
  assert.equal(kind('Дождь начался так внезапно, что все вздрогнули.'), 'rain');
  assert.equal(kind('Начал накрапывать дождик.'), 'rain');
  assert.equal(kind('Закапало. Потом заморосило сильнее.'), 'rain');
});

test('гроза, снег, туман, ветер, тучи', () => {
  assert.equal(kind('Где-то вдалеке грянул гром.'), 'storm');
  assert.equal(kind('Над городом разразилась гроза.'), 'storm');
  assert.equal(kind('Повалил густой снег.'), 'snow');
  assert.equal(kind('Начался снегопад, и улица побелела.'), 'snow');
  assert.equal(kind('С реки опустился туман.'), 'fog');
  assert.equal(kind('Туман окутал берег.'), 'fog');
  assert.equal(kind('Налетел холодный ветер.'), 'wind');
  assert.equal(kind('Ветер усилился и завыл в проводах.'), 'wind');
  assert.equal(kind('Небо затянуло тучами.'), 'cloudy');
});

test('прекращение и прояснение', () => {
  assert.equal(kind('Дождь наконец прекратился.'), 'clear');
  assert.equal(kind('Ливень стих так же быстро, как начался.'), 'clear');
  assert.equal(kind('Выглянуло солнце.'), 'clear');
  assert.equal(kind('Небо прояснилось, тучи разошлись.'), 'clear');
  assert.equal(kind('Туман рассеялся.'), 'clear');
});

test('побеждает самое позднее событие в тексте', () => {
  assert.equal(kind('Пошёл дождь. Через час он стих, и выглянуло солнце.'), 'clear');
  assert.equal(kind('Выглянуло солнце. А к вечеру пошёл дождь.'), 'rain');
});

test('отрицание, условие и речь героев не считаются', () => {
  assert.equal(kind('Если пойдёт дождь, мы останемся здесь.'), null);
  assert.equal(kind('Дождь так и не пошёл.'), null);
  assert.equal(kind('— Кажется, пошёл дождь, — сказала она.'), null);
  assert.equal(kind('Она сказала: «Смотри, хлынул ливень!»'), null);
  assert.equal(kind('Он смотрел на небо, не веря, что не пошёл дождь.'), null);
  assert.equal(kind('Просто тихий вечер у камина.'), null);
  assert.equal(kind(''), null);
  assert.equal(kind(null), null);
});

test('narrationOnly убирает речь', () => {
  const text = '— Идёт дождь!\nОн кивнул. «Хлынул ливень», подумал он. Дождь стих.';
  const out = narrationOnly(text);
  assert.ok(!out.includes('Идёт'));
  assert.ok(!out.includes('Хлынул'));
  assert.ok(out.includes('Дождь стих'));
});

test('ё и е не различаются', () => {
  assert.equal(kind('ПОШЁЛ ДОЖДЬ'), 'rain');
  assert.equal(kind('пошел дождь'), 'rain');
});
