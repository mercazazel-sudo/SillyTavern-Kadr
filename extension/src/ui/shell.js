/**
 * Общая оболочка окон: затемнение, окно по центру, закрытие по Esc, крестику и клику мимо, возврат фокуса,
 * тема мира через data-cal. Само содержимое окно рисует само (render) и вешает свои обработчики на win.
 */
import { themeFor } from './theme.js';

const OPEN_FOLDS = new Set();     // блоки «Уйдёт рассказчику», которые человек раскрыл
const CLOSED_FOLDS = new Set();   // блоки, открытые по умолчанию, которые человек закрыл

export function createShell({ id, label, width = 960, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'sj-ovl2';
  overlay.hidden = true;
  overlay.innerHTML = `<div class="sj-win" role="dialog" aria-modal="true" aria-label="${label}" tabindex="-1" style="--w:${width}px"></div>`;
  document.body.append(overlay);
  const win = overlay.firstElementChild;
  let open = false;
  let returnFocus = null;

  // Блоки «Уйдёт рассказчику» везде сворачиваются стрелочкой: окна рисуют обычный .sj-tell, а оболочка превращает его
  // в раскрывающийся блок (свёрнут по умолчанию; data-open на блоке значит «открыт по умолчанию»). Что человек раскрыл,
  // запоминается и переживает перерисовку окна.
  const foldTells = () => {
    const seen = new Map();
    for (const tell of win.querySelectorAll('.sj-tell:not(.sj-fold)')) {
      const label = tell.querySelector(':scope > .sj-lbl');
      if (!label) continue;
      const title = label.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
      const n = (seen.get(title) ?? 0) + 1;
      seen.set(title, n);
      const key = `${id}|${title}|${n}`;
      const details = document.createElement('details');
      details.className = `${tell.className} sj-fold`;
      details.dataset.fold = key;
      details.open = OPEN_FOLDS.has(key) || (tell.hasAttribute('data-open') && !CLOSED_FOLDS.has(key));
      const summary = document.createElement('summary');
      summary.className = label.className;
      summary.innerHTML = label.innerHTML;
      label.remove();
      details.append(summary, ...tell.childNodes);
      tell.replaceWith(details);
    }
  };
  const observer = new MutationObserver(() => { observer.disconnect(); try { foldTells(); } finally { observer.observe(win, { childList: true, subtree: true }); } });
  observer.observe(win, { childList: true, subtree: true });
  const onToggle = event => {
    const key = event.target?.dataset?.fold;
    if (!key) return;
    if (event.target.open) { OPEN_FOLDS.add(key); CLOSED_FOLDS.delete(key); } else { OPEN_FOLDS.delete(key); CLOSED_FOLDS.add(key); }
  };
  win.addEventListener('toggle', onToggle, true);

  const close = () => {
    if (overlay.hidden) return;
    open = false;
    overlay.hidden = true;
    onClose?.();
    try { returnFocus?.focus?.(); } catch { /* фокус вернуть не вышло */ }
  };
  const onKey = event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } };
  const onBackdrop = event => { if (event.target === overlay) close(); };
  overlay.addEventListener('keydown', onKey);
  overlay.addEventListener('click', onBackdrop);

  return {
    overlay, win,
    get isOpen() { return open; },
    /** Показывает окно; тему мира задаёт calendarId. */
    show(calendarId) {
      returnFocus = document.activeElement;
      overlay.dataset.world = calendarId;
      overlay.dataset.cal = themeFor(calendarId);
      overlay.hidden = false;
      open = true;
    },
    theme(calendarId) { overlay.dataset.world = calendarId; overlay.dataset.cal = themeFor(calendarId); },
    close,
    destroy() {
      observer.disconnect();
      win.removeEventListener('toggle', onToggle, true);
      overlay.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onBackdrop);
      overlay.remove();
    },
  };
}

/** Подключает файл стилей один раз (нужен окну «Состояние»: маски силуэта лежат в data-URI внутри CSS). */
export function loadStylesheetOnce(id, href) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}
