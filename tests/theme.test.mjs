import test from 'node:test';
import assert from 'node:assert/strict';
import { isHex, themeFromAccent, setTheme, getTheme, getColor, themeFor, paletteOf, themeList, PALETTES, CUSTOM } from '../src/ui/theme.js';
import { ORDER } from '../src/core/calendars.js';

test('палитры: для каждого мира есть цвета, имена и мир для карточки', () => {
  assert.deepEqual(themeList().map(x => x.id), ORDER);
  for (const x of themeList()) { assert.ok(x.ru && x.world && x.panel && x.accent, x.id); assert.ok(isHex(PALETTES[x.id].accent)); }
});

test('выбор цвета: по миру, палитра мира, свой цвет; неизвестное сбрасывается', () => {
  setTheme('');
  assert.equal(getTheme(), ''); assert.equal(themeFor('harptos'), 'harptos');              // по миру: цвет мира чата
  setTheme('eberron');
  assert.equal(themeFor('harptos'), 'eberron'); assert.equal(themeFor('earth'), 'eberron');  // палитра перекрывает любой мир
  setTheme('нет такой');
  assert.equal(getTheme(), '');
  setTheme(CUSTOM, '#E06080');
  assert.equal(getTheme(), CUSTOM); assert.equal(getColor(), '#e06080'); assert.equal(themeFor('earth'), CUSTOM);
  setTheme(CUSTOM, 'не цвет');
  assert.equal(getColor(), '#e06080');                                                     // кривой цвет не принимается, остаётся прежний
  assert.equal(paletteOf(CUSTOM).accent, themeFromAccent('#e06080').accent);
  assert.equal(paletteOf('earth'), PALETTES.earth);
  setTheme('');
});

test('палитра из одного цвета: тёмный фон с оттенком цвета, светлый текст, акцент в читаемой яркости', () => {
  const light = ['#ffffff', '#000000', '#808080', '#ff0000', '#3355ff', '#ffee00'];
  for (const c of light) {
    const p = themeFromAccent(c);
    for (const k of ['panel', 'panel2', 'line', 'page', 'text', 'muted', 'accent']) assert.match(p[k], /^hsl\(\d+ \d+% \d+%\)$/, `${c} ${k}`);
    const l = k => Number(/(\d+)%\)$/.exec(p[k])[1]);
    assert.ok(l('panel') < l('panel2') && l('panel2') < l('line'), c);                   // слои светлеют от фона к границе
    assert.ok(l('text') >= 85 && l('muted') >= 55, c);                                   // текст читается на тёмном
    assert.ok(l('accent') >= 48 && l('accent') <= 70, `${c} accent ${p.accent}`);        // даже чёрный и белый получают видимый акцент
  }
  assert.deepEqual(themeFromAccent('мусор'), themeFromAccent('#c8a24a'));               // неверный цвет заменяется стандартным
  assert.equal(isHex('#ABCDEF'), true); assert.equal(isHex('#abc'), false);
});
