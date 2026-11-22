/**
 * Пульт: колонка кнопок-иконок у правого края экрана (прикреплена к экрану, не двигается). Каждая кнопка открывает свой
 * раздел расширения; название и пояснение видны в подсказке. «Обстановка» и «Секретное письмо» отсюда убраны: у них есть
 * свои места (строка у поля ввода и её кнопки).
 */
import { report } from '../guard.js';
import { themeFor } from './theme.js';
import { FEATURES } from '../core/features.js';
import { onMobileChange } from './mobile.js';

const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

const ALL_ITEMS = [
  { id: 'state', label: 'Состояние', hint: 'кто в кадре, раны', open: 'openState', icon: svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>') },
  { id: 'journal', label: 'Журнал', hint: 'квесты, зацепки, записи', open: 'openJournal', icon: svg('<path d="M8 4H5v13a3 3 0 0 0 3 3"/><g class="pg"><path d="M8 5h8a2 2 0 0 1 2 2v12H8z"/><path d="M10.5 9h5M10.5 12h5M10.5 15h3"/></g><g class="fp"><path d="M8 5h8a2 2 0 0 1 2 2v12H8z"/><path d="M10.5 9h5M10.5 12h5"/></g><g class="bk"><path d="M8 4h8a3 3 0 0 1 3 3v13H8z"/><path d="M11 8h5"/></g>') },
  { id: 'chronicle', label: 'Архивариус', hint: 'предложения по ответам', open: 'openChronicle', icon: svg('<g class="qw"><path d="M20 4c-8 0-13 4-14 11l-1 5 5-1c7-1 10-6 10-15z"/><path d="M5 20l9-9"/></g><path class="ql" pathLength="1" d="M5 21.5c1.4-1.6 2.8 1.6 4.2 0s2.8 1.6 4.2 0 2.8 1.6 4.2 0"/>') },
  { id: 'map', label: 'Карта', hint: 'места, приметы, перемены', open: 'openMap', icon: svg('<path class="mp1" d="M3 6l6-2v14l-6 2z"/><path class="mp2" d="M9 4l6 2v14l-6-2z"/><path class="mp3" d="M15 6l6-2v14l-6 2z"/>') },
  { id: 'relations', label: 'Отношения', hint: 'чувства, стадии, воспоминания', open: 'openRelations', icon: svg('<g class="pa"><circle cx="8" cy="8" r="3.2"/><path d="M3.5 19c0-3.2 2-5.2 4.5-5.2s4.5 2 4.5 5.2"/></g><g class="pb"><circle cx="16.5" cy="9" r="2.8"/><path d="M12.5 19c0-2.8 1.6-4.6 4-4.6 2.3 0 4 1.8 4 4.6"/></g>') },
  { id: 'secrets', label: 'Тайны', hint: 'кто что знает, знакомства, погибшие', open: 'openSecrets', icon: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path class="sh" d="M8 11V8a4 4 0 0 1 8 0v3"/>') },
  { id: 'fate', label: 'd20 жизни', hint: 'режим, события, броски, интим', open: 'openFate', icon: svg('<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M12 7.2l4.6 8H7.4z"/><path d="M12 2.5v4.7M20.2 7.25L12 7.2M3.8 7.25L12 7.2M20.2 7.25l-3.6 7.95M3.8 7.25l3.6 7.95M20.2 16.75l-3.6-1.55M3.8 16.75l3.6-1.55M12 21.5l4.6-6.3M12 21.5l-4.6-6.3"/>') },
  { id: 'calendar', label: 'Календарь', hint: 'сетка месяца, праздники', open: 'openCalendar', icon: svg('<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4z"/><g class="cl"><path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><text class="d d1" x="12" y="17.5" text-anchor="middle">14</text><text class="d d2" x="12" y="17.5" text-anchor="middle">15</text><text class="d d3" x="12" y="17.5" text-anchor="middle">16</text></g><path d="M9 3v4M15 3v4"/>') },
  { id: 'cards', label: 'Анкеты', hint: 'анкеты персонажей и мест', open: 'openCards', mobileOnly: true, icon: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.4-1.6 1.4-2.4 2.5-2.4s2.1.8 2.5 2.4M14 10h4M14 13h4"/>') },
  { id: 'settings', label: 'Настройки', hint: 'модель, лорбуки, что уходит рассказчику, запросы', open: 'openSettings', icon: svg('<path d="M10.21 4.82L10.44 2.12L13.56 2.12L13.79 4.82L15.81 5.66L17.88 3.91L20.09 6.12L18.34 8.19L19.18 10.21L21.88 10.44L21.88 13.56L19.18 13.79L18.34 15.81L20.09 17.88L17.88 20.09L15.81 18.34L13.79 19.18L13.56 21.88L10.44 21.88L10.21 19.18L8.19 18.34L6.12 20.09L3.91 17.88L5.66 15.81L4.82 13.79L2.12 13.56L2.12 10.44L4.82 10.21L5.66 8.19L3.91 6.12L6.12 3.91L8.19 5.66z"/><circle cx="12" cy="12" r="3"/>') },
];
const ITEMS = ALL_ITEMS.filter(item => (item.id !== 'fate' || FEATURES.fate) && (item.id !== 'secrets' || FEATURES.secrets));

export function startHub(deps) {
  const { settings, shared } = deps;
  const root = document.createElement('div');
  root.id = 'sj-hub';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Кадр: разделы');
  root.hidden = true;
  const fab = '<button type="button" class="sj-hubfab" aria-label="Кадр: разделы" aria-expanded="false">К</button>';
  root.innerHTML = fab + '<div class="sj-hubgrid">' + ITEMS.map(item => `<button type="button" class="sj-hubicon${item.mobileOnly ? ' sj-mobonly' : ''}" data-open="${item.open}" aria-label="${item.label}" title="${item.hint}"><span class="pill"><span class="pillin"><span class="lb">${item.label}</span></span></span><span class="ic">${item.icon}</span></button>`).join('') + '</div>';
  document.body.append(root);

  // телефон: пульт сворачивается в кнопку «К», по нажатию снизу выезжает лист с разделами
    // цвета листа и кнопки «К» берём у строки сцены, чтобы шторка, пульт и окна были одного цвета
  const syncColors = () => {
    const strip = document.getElementById('sj-strip');
    if (!strip) return;
    const cs = getComputedStyle(strip);
    for (const v of ['--panel', '--panel2', '--line', '--text', '--muted', '--accent']) { const val = cs.getPropertyValue(v); if (val) root.style.setProperty(v, val); }
  };
  // кнопку «К» можно взять пальцем и перетащить: место запоминается
  const POS_KEY = 'sj-hub-fab-pos';
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { pos = null; }
  const applyPos = () => {
    if (!pos || !root.dataset.mobile || root.classList.contains('sj-sheet')) { for (const k of ['left', 'top', 'right', 'bottom']) root.style.removeProperty(k); return; }
    const x = Math.min(Math.max(pos.x, 4), window.innerWidth - 52), y = Math.min(Math.max(pos.y, 4), window.innerHeight - 52);
    root.style.setProperty('left', `${x}px`, 'important'); root.style.setProperty('top', `${y}px`, 'important');
    root.style.setProperty('right', 'auto', 'important'); root.style.setProperty('bottom', 'auto', 'important');
  };
  const setSheet = on => { if (on) syncColors(); root.classList.toggle('sj-sheet', on); root.querySelector('.sj-hubfab')?.setAttribute('aria-expanded', String(on)); applyPos(); };
  const stopMobile = onMobileChange(on => { if (on) root.dataset.mobile = '1'; else { delete root.dataset.mobile; setSheet(false); } applyPos(); try { refresh(shared.scene?.get()); } catch { /* пульт ещё собирается */ } });
  const fabEl = root.querySelector('.sj-hubfab');
  let drag = null, moved = false;
  fabEl.addEventListener('pointerdown', e => {
    if (!root.dataset.mobile) return;
    const r = root.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, on: false };
    try { fabEl.setPointerCapture(e.pointerId); } catch { /* без захвата тоже работает */ }
  });
  fabEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.on = true; moved = true;
    pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
    applyPos();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.on) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* без памяти браузера */ } setTimeout(() => { moved = false; }, 60); }
    drag = null;
  };
  fabEl.addEventListener('pointerup', endDrag);
  fabEl.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', applyPos);
  const onClick = event => {
    if (event.target.closest('.sj-hubfab')) { if (moved) return; return setSheet(!root.classList.contains('sj-sheet')); }
    if (event.target === root && root.classList.contains('sj-sheet')) return setSheet(false);
    const item = event.target.closest('[data-open]');
    if (!item) return;
    setSheet(false);
    try { shared.ui?.[item.dataset.open]?.(); } catch (error) { report('открытие раздела', error); }
  };
  root.addEventListener('click', onClick);

  // пульт виден, когда открыт чат и расширение включено
  const refresh = info => {
    // телефон: без кнопки «К» меню остаётся доступным из шторки (кнопка «Меню»), поэтому сам пульт не скрываем
    root.hidden = !(settings.enabled && info?.hasChat && (settings.hub !== false || root.dataset.mobile));
    root.classList.toggle('sj-nofab', settings.hub === false);
    // цвета пульта как у окон: по миру чата или по выбранной палитре (смена цвета в настройках находит его по data-world)
    syncColors();
    // разделы, которые человек отключил в настройках, пропадают из меню
    root.querySelector('[data-open="openJournal"]')?.classList.toggle('sj-off', settings.showJournal === false);
    root.querySelector('[data-open="openMap"]')?.classList.toggle('sj-off', settings.showMap === false);
    if (info?.state?.calendar) { root.dataset.world = info.state.calendar; root.dataset.cal = themeFor(info.state.calendar); }
  };
  const unsubscribe = shared.scene?.subscribe(refresh);
  refresh(shared.scene?.get());
  shared.ui = { ...(shared.ui ?? {}), openMenu: () => { if (root.dataset.mobile) setSheet(true); } };

  return () => {
    unsubscribe?.();
    if (shared.ui) delete shared.ui.openMenu;
    stopMobile();
    window.removeEventListener('resize', applyPos);
    root.removeEventListener('click', onClick);
    root.remove();
  };
}
