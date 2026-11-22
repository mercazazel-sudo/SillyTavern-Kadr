/**
 * Шторка для телефона: открывается по нажатию на строку сцены, только когда экран узкий.
 * Первый блок: время, дата, погода, место и ручная перемотка. Второй блок: «Кто в кадре», сворачивается.
 * Нажатие на «Состояние» открывает подробное окно.
 */
import { esc } from './dom.js';
import { formatTime, partOfDay, parseDuration } from '../core/clock.js';
import { describeWeather } from '../core/weather.js';
export { isMobileView } from './mobile.js';
import { FEATURES } from '../core/features.js';

const PART_ICON = Object.freeze({ ночь: '🌙', утро: '🌅', день: '☀️', вечер: '🌇' });
export const partIcon = part => PART_ICON[part] ?? '☀️';
/** Сокращённая дата для строки: «22 Ноя». Праздничный день без числа даёт первое слово. */
export function shortDate(name) {
  const parts = String(name ?? '').split(',').map(s => s.trim());
  if (parts.length > 1 && /^\d+$/.test(parts[1])) return `${parts[1]} ${parts[0].slice(0, 3)}`;
  return String(name ?? '').split(/\s+/)[0].slice(0, 6);
}
const UNITS = [['m', 'мин'], ['h', 'ч'], ['d', 'дн']];

const MENU = [
  ['openState', 'Состояние'], ['openJournal', 'Журнал', 'showJournal'], ['openChronicle', 'Архивариус'], ['openMap', 'Карта', 'showMap'],
  ['openRelations', 'Отношения'], ['openFate', 'd20 жизни', 'fate'], ['openCalendar', 'Календарь'], ['openCards', 'Анкеты'],
];

export function createShade({ strip, shared, settings = {} }) {
  const root = document.createElement('div');
  root.className = 'sj-shade-root';
  root.hidden = true;
  root.innerHTML = '<div class="sj-shade-scrim"></div><div class="sj-shade" role="dialog" aria-label="Обстановка"></div>';
  document.body.append(root);
  const panel = root.querySelector('.sj-shade');
  let unit = 'h', amount = '2', whoOpen = false;

  const isOpen = () => !root.hidden;
  const close = () => { root.hidden = true; strip.classList.remove('sj-shade-on'); };

  function place() {
    const r = strip.getBoundingClientRect();
    const cs = getComputedStyle(strip);
    for (const v of ['--panel', '--panel2', '--line', '--text', '--muted', '--accent', '--rad', '--head']) root.style.setProperty(v, cs.getPropertyValue(v));
    root.dataset.cal = strip.dataset.cal ?? '';
    panel.style.bottom = Math.max(8, innerHeight - r.top + 6) + 'px';
    panel.style.maxHeight = Math.max(160, r.top - 16) + 'px';
  }

  function faces() {
    return [...strip.querySelectorAll('.sj-avs .sj-av:not(.more)')].map(el => ({
      id: el.dataset.av,
      name: String(el.getAttribute('title') ?? '').replace(/ \((вы|умер)\)$/, ''),
      me: el.classList.contains('me'),
      dead: el.classList.contains('dead'),
      html: el.innerHTML,
    }));
  }

  function render() {
    const info = shared.scene?.get();
    if (!info?.hasChat) { close(); return; }
    const part = partOfDay(info.time.minutes);
    const { date, state } = info;
    const place = state.place ? state.place.split('›').map(s => s.trim()).filter(Boolean).join(' › ') : '';
    const people = faces();
    panel.innerHTML = `
      <div class="sj-sh-card">
        <div class="sj-sh-big"><b>${formatTime(info.time.minutes)}</b><span>${partIcon(part)} ${esc(part)}</span>${date.storyDay != null ? `<i class="sj-sh-dn">Д${date.storyDay}</i>` : ''}</div>
        <div class="sj-sh-grid">
          <div><small>Дата</small>${esc(date.name)}, ${date.year} ${esc(date.era)}</div>
          <div><small>Погода</small>${info.weather ? esc(describeWeather(info.weather)) : '—'}</div>
          <div class="wide"><small>Место</small>${place ? esc(place) : '<span class="sj-sh-none">не задано</span>'}</div>
        </div>
        <div class="sj-sh-wind"><span>Перемотать на</span><input id="sj-sh-n" inputmode="numeric" value="${esc(amount)}" aria-label="Сколько"><select id="sj-sh-u" aria-label="Единица">${UNITS.map(([v, ru]) => `<option value="${v}"${v === unit ? ' selected' : ''}>${ru}</option>`).join('')}</select><button type="button" data-go>Вперёд</button></div>
      </div>
      <div class="sj-sh-card">
        <div class="sj-sh-acc" data-who role="button" tabindex="0"><h5>Кто в кадре</h5><span>${people.length}</span><i>${whoOpen ? '▴' : '▾'}</i></div>
        ${people.length ? (whoOpen
          ? `<div class="sj-sh-list">${people.map(p => `<div class="sj-sh-who" data-av="${esc(p.id)}" role="button" tabindex="0"><span class="sj-av${p.me ? ' me' : ''}${p.dead ? ' dead' : ''}">${p.html}</span><div>${esc(p.name)}${p.me ? '<small>вы</small>' : p.dead ? '<small>умер</small>' : ''}</div></div>`).join('')}</div>`
          : `<div class="sj-sh-faces">${people.map(p => `<div class="sj-sh-face" data-av="${esc(p.id)}" role="button" tabindex="0"><span class="sj-av${p.me ? ' me' : ''}${p.dead ? ' dead' : ''}">${p.html}</span><span class="sj-sh-nm">${esc(p.name)}</span></div>`).join('')}</div>`)
          : '<div class="sj-sh-none" style="padding-top:6px">Никого не отмечено</div>'}
        <button type="button" class="sj-sh-state" data-state>Состояние</button>
      </div>
      ${settings.hub === false ? `<div class="sj-sh-menu">${MENU.filter(([, , flag]) => flag !== 'fate' ? (!flag || settings[flag] !== false) : FEATURES.fate).map(([open, ru]) => `<button type="button" data-sopen="${open}">${ru}</button>`).join('')}</div>` : ''}
      <div class="sj-sh-row2"><button type="button" class="sj-sh-full" data-scene>Обстановка</button><button type="button" class="sj-sh-full" data-sopen="openSettings">Настройки</button></div>`;
  }

  function goForward() {
    const n = panel.querySelector('#sj-sh-n'), u = panel.querySelector('#sj-sh-u');
    amount = n.value; unit = u.value;
    const minutes = parseDuration(`${amount}${UNITS.find(x => x[0] === unit)[1]}`);
    if (minutes && minutes > 0) shared.scene?.skip(minutes);
  }

  const onClick = event => {
    const t = event.target;
    if (t.closest('.sj-shade-scrim')) return close();
    if (t.closest('[data-go]')) return goForward();
    if (t.closest('[data-who]')) { whoOpen = !whoOpen; return render(); }
    const av = t.closest('[data-av]');
    if (av) { close(); return shared.ui?.openState?.(av.dataset.av); }
    if (t.closest('[data-state]')) { close(); return shared.ui?.openState?.(); }
    const op = t.closest('[data-sopen]');
    if (op) { close(); return shared.ui?.[op.dataset.sopen]?.(); }
    if (t.closest('[data-scene]')) { close(); return shared.ui?.openScene?.(); }
  };
  const onKey = event => {
    if (event.key === 'Escape' && isOpen()) close();
    else if (event.key === 'Enter' && event.target?.id === 'sj-sh-n') goForward();
  };
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  const unsubscribe = shared.scene?.subscribe(() => { if (isOpen()) { place(); render(); } });

  return {
    isOpen,
    toggle() { if (isOpen()) return close(); render(); place(); root.hidden = false; strip.classList.add('sj-shade-on'); },
    close,
    destroy() { unsubscribe?.(); root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); root.remove(); },
  };
}
