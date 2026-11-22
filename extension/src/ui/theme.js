/**
 * Цвет окон. По умолчанию окна красятся в цвета своего мира (data-cal = id календаря). «Выбор цвета» в настройках перекрывает это:
 * одна из палитр миров или «свой цвет» (одна заданная пользователем краска, из неё считается вся палитра). Выбранное применяется во всех
 * окнах, какой бы мир ни был в чате. Пусто = цвет по миру. Мир окна хранится в data-world, чтобы смена цвета перекрашивала открытые окна.
 */
import { CALENDARS, ORDER } from '../core/calendars.js';

/** Название палитры и мир, из которого она взята. */
export const THEME_NAMES = Object.freeze({ harptos: 'Янтарь', exandria: 'Море', golarion: 'Медь', eberron: 'Сталь', greyhawk: 'Мох', earth: 'Небо' });
export const THEME_WORLDS = Object.freeze({ harptos: 'Фаэрун', exandria: 'Экзандрия', golarion: 'Голарион', eberron: 'Эберрон', greyhawk: 'Грейхок', earth: 'Обычный мир' });
/** Цвета палитр миров (те же, что в style.css): для карточек выбора. */
export const PALETTES = Object.freeze({
  harptos: { panel: '#211a12', panel2: '#2b2217', line: '#4a3b25', text: '#efe3c8', muted: '#a8977a', accent: '#c8a24a' },
  exandria: { panel: '#121c26', panel2: '#182533', line: '#243649', text: '#dfe9f1', muted: '#86a0b3', accent: '#5fa8b8' },
  golarion: { panel: '#26190f', panel2: '#32221a', line: '#5a3a28', text: '#f0e0c8', muted: '#b59a80', accent: '#b5654a' },
  eberron: { panel: '#181a20', panel2: '#20232b', line: '#343843', text: '#e6e3dc', muted: '#8f939f', accent: '#7d6fb0' },
  greyhawk: { panel: '#182014', panel2: '#1f2a1a', line: '#34452d', text: '#e3ead6', muted: '#92a283', accent: '#6f9a5a' },
  earth: { panel: '#16191e', panel2: '#1e2228', line: '#363c46', text: '#e7eaee', muted: '#98a2ae', accent: '#6aa9e0' },
});
export const DEFAULT_CUSTOM = '#c8a24a';
export const CUSTOM = 'custom';

export const isHex = v => /^#[0-9a-f]{6}$/i.test(String(v ?? ''));

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s * 100, l * 100];
}
const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Вся палитра из одного цвета: тёмный фон с оттенком этого цвета, светлый текст и сам цвет как акцент (он подтягивается в читаемые границы яркости). */
export function themeFromAccent(hex) {
  const [h, s, l] = hexToHsl(isHex(hex) ? hex : DEFAULT_CUSTOM);
  const bg = clamp(s * 0.3, 8, 26);
  return {
    panel: hsl(h, bg, 10), panel2: hsl(h, bg, 14), line: hsl(h, bg, 26), page: hsl(h, bg, 8),
    text: hsl(h, bg + 8, 91), muted: hsl(h, bg + 2, 64), accent: hsl(h, clamp(s, 35, 85), clamp(l, 48, 70)),
  };
}

let chosen = '';
let customColor = DEFAULT_CUSTOM;
/** Запоминает выбор из настроек: id палитры мира, 'custom' (с цветом) или пусто («по миру»). Неизвестное сбрасывается в «по миру». */
export function setTheme(id, color) {
  if (isHex(color)) customColor = color.toLowerCase();
  chosen = id === CUSTOM ? CUSTOM : (CALENDARS[id] ? id : '');
  rootVars();
}
export const getTheme = () => chosen;
export const getColor = () => customColor;
/** Какая палитра нужна окну мира world. */
export const themeFor = world => chosen || world;
/** Цвета палитры для показа: у палитр миров готовые, у «своего цвета» считаются из него. */
export const paletteOf = id => (id === CUSTOM ? themeFromAccent(customColor) : PALETTES[id] ?? null);

/** Переменные «своего цвета» лежат на корне документа, окна читают их через [data-cal="custom"] в style.css. */
function rootVars() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  if (chosen !== CUSTOM) { for (const k of ['panel', 'panel2', 'line', 'page', 'text', 'muted', 'accent']) root.removeProperty(`--sj-c-${k}`); return; }
  for (const [k, v] of Object.entries(themeFromAccent(customColor))) root.setProperty(`--sj-c-${k}`, v);
}
/** Перекрашивает все открытые окна, строку сцены и пульт. */
export function applyTheme() {
  rootVars();
  for (const el of document.querySelectorAll('[data-world]')) el.dataset.cal = themeFor(el.dataset.world);
}
/** Палитры для выбора: [{ id, ru, world, ...цвета }]. */
export const themeList = () => ORDER.map(id => ({ id, ru: THEME_NAMES[id] ?? CALENDARS[id].ru, world: THEME_WORLDS[id] ?? CALENDARS[id].ru, ...PALETTES[id] }));
