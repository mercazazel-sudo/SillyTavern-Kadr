/**
 * Окно «Секретное письмо»: записка рассказчику вне истории. В чат ничего не попадает.
 * Письмо уходит с ближайшим ответом (в том числе с пересозданным) и после него исчезает.
 */
import { esc } from './dom.js';
import { themeFor } from './theme.js';
import { TEMPLATES, LETTER_MAX } from '../core/letter.js';

export function startLetterWindow(deps) {
  const { shared } = deps;
  const overlay = document.createElement('div');
  overlay.id = 'sj-letter';
  overlay.className = 'sj-ovl';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="sj-win sj-narrow" role="dialog" aria-modal="true" aria-label="Секретное письмо" tabindex="-1"></div>';
  document.body.append(overlay);
  const win = overlay.firstElementChild;
  const scene = () => shared.scene;

  let isOpen = false;
  let returnFocus = null;
  let draft = '';

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { close(); return; }
    overlay.dataset.world = info.state.calendar;
    overlay.dataset.cal = themeFor(info.state.calendar);
    const pending = info.letter;
    win.innerHTML = `<div class="sj-wh"><h2>Секретное письмо</h2><span class="sj-sub">только рассказчику, в чат не попадает</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="sj-body">
        ${pending ? `<div class="sj-pendingbox"><div class="sj-lbl">Письмо ждёт следующего ответа</div><div class="sj-pendingtext">${esc(pending)}</div>
          <div class="sj-sub">Уйдёт с ближайшим ответом, в том числе с пересозданным, и исчезнет.</div>
          <button class="sj-btn" data-act="clear">Убрать письмо</button></div>` : ''}
        <label class="sj-lbl" for="sj-letter-text">${pending ? 'Заменить письмо' : 'Что рассказчику нужно знать'}</label>
        <textarea id="sj-letter-text" class="sj-wide" rows="6" maxlength="${LETTER_MAX}" placeholder="Например: не говори за моего персонажа и не торопи близость.">${esc(draft)}</textarea>
        <div class="sj-lbl" style="margin-top:10px">Быстрые правки</div>
        <div class="sj-tpl">${TEMPLATES.map((t, i) => `<button class="sj-chipbtn" data-tpl="${i}">${esc(t)}</button>`).join('')}</div>
        <div class="sj-actions"><button class="sj-btn sj-pri" data-act="send">Отправить на следующий ответ</button><button class="sj-btn" data-act="close">Закрыть</button></div>
        <div class="sj-sub">Письмо уходит модели служебной запиской с пометкой «не часть истории, не упоминай». Сообщением в чате оно не становится.</div>
      </div>`;
  }

  function open() {
    if (!scene()?.get()?.hasChat) return;
    returnFocus = document.activeElement;
    draft = '';
    isOpen = true;
    overlay.hidden = false;
    render();
    win.querySelector('#sj-letter-text')?.focus();
  }
  function close() {
    if (overlay.hidden) return;
    isOpen = false;
    overlay.hidden = true;
    try { returnFocus?.focus?.(); } catch { /* фокус вернуть не вышло */ }
  }

  const onClick = event => {
    if (event.target === overlay) return close();
    const tpl = event.target.closest('[data-tpl]');
    if (tpl) {
      const box = win.querySelector('#sj-letter-text');
      const text = TEMPLATES[Number(tpl.dataset.tpl)];
      box.value = box.value.trim() ? `${box.value.trim()}\n${text}` : text;
      draft = box.value;
      box.focus();
      return;
    }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return close();
    if (act === 'clear') { scene().clearLetter(); render(); return; }
    if (act === 'send') {
      const text = win.querySelector('#sj-letter-text').value.trim();
      if (!text) { win.querySelector('#sj-letter-text').classList.add('sj-bad'); return; }
      scene().setLetter(text);
      close();
    }
  };
  const onInput = event => { if (event.target.id === 'sj-letter-text') { draft = event.target.value; event.target.classList.remove('sj-bad'); } };
  const onKey = event => {
    if (event.key === 'Escape' && isOpen) { event.stopPropagation(); close(); }
    else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target.id === 'sj-letter-text') { event.preventDefault(); win.querySelector('[data-act="send"]')?.click(); }
  };
  overlay.addEventListener('click', onClick);
  overlay.addEventListener('input', onInput);
  overlay.addEventListener('keydown', onKey);

  // письмо убрали или заменили из другого места: покажем актуальное, но не мешаем набору текста
  const unsubscribe = scene()?.subscribe(info => {
    if (!isOpen) return;
    if (!info?.hasChat) return close();
    if (win.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
    render();
  });

  shared.ui = { ...(shared.ui ?? {}), openLetter: open, closeLetter: close };
  return () => {
    unsubscribe?.();
    overlay.removeEventListener('click', onClick);
    overlay.removeEventListener('input', onInput);
    overlay.removeEventListener('keydown', onKey);
    overlay.remove();
    if (shared.ui) { delete shared.ui.openLetter; delete shared.ui.closeLetter; }
  };
}
