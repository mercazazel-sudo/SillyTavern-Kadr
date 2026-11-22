/**
 * Выделение текста в чате: над выделенным фрагментом ответа появляется плашка «В журнал» и «В тайны».
 *  - «В журнал» добавляет фрагмент записью в выбранный идущий квест (по умолчанию отслеживаемый);
 *  - «В тайны» заводит из фрагмента событие-тайну; знают его те, кто сейчас в кадре (персона и сам рассказчик не в счёт).
 * Работает только по тексту сообщений чата (.mes_text), ничего не меняя в самом сообщении.
 */
import { report } from '../guard.js';

export function startSelection(deps) {
  const { shared, settings } = deps;
  const scene = () => shared.scene;
  const bar = document.createElement('div');
  bar.id = 'sj-selbar';
  bar.hidden = true;
  bar.innerHTML = '<select aria-label="Квест" data-selq></select><button type="button" data-act="journal">В журнал</button><button type="button" data-act="secret">В тайны</button><span class="msg" data-msg></span>';
  document.body.append(bar);
  const sel = bar.querySelector('[data-selq]');
  const msg = bar.querySelector('[data-msg]');
  let text = '';

  const hide = () => { bar.hidden = true; msg.textContent = ''; };
  const quests = () => scene().get().quests.filter(q => q.status === 'active' || q.status === 'paused');

  function show() {
    try {
      if (!settings.enabled || !scene()?.get().hasChat) return hide();
      const s = window.getSelection();
      const value = s?.toString().replace(/\s+/g, ' ').trim() ?? '';
      if (!s || s.isCollapsed || value.length < 6 || value.length > 700) return hide();
      const node = s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement;
      if (!node?.closest?.('.mes_text')) return hide();
      text = value;
      const qs = quests();
      sel.innerHTML = qs.map(q => `<option value="${q.id}"${q.tracked ? ' selected' : ''}>${q.title.replace(/</g, '&lt;')}</option>`).join('') || '<option value="">(нет квестов)</option>';
      sel.hidden = !qs.length;
      const rect = s.getRangeAt(0).getBoundingClientRect();
      bar.hidden = false;
      const w = bar.offsetWidth || 320;
      bar.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2))}px`;
      bar.style.top = `${Math.max(8, rect.top - 44)}px`;
    } catch (error) { report('выделение текста', error); hide(); }
  }
  const onUp = () => setTimeout(show, 10);
  const onClick = event => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    event.preventDefault();
    try {
      const s = scene();
      if (act === 'journal') {
        const qs = quests();
        const id = sel.value || (qs[0]?.id ?? '');
        const ok = id ? s.addEntry(id, text) : false;
        msg.textContent = ok ? 'записано' : 'нет квеста: создайте в «Журнале»';
      } else if (act === 'secret') {
        const info = s.get();
        const witnessIds = info.cast.filter(p => p.present && !p.persona && !info.knowledge.deaths[p.id]).map(p => p.id);
        const id = s.addFact({ text, witnessIds, secret: true });
        msg.textContent = id ? `тайна, знают: ${witnessIds.length}` : 'не вышло';
      }
      setTimeout(hide, 1200);
    } catch (error) { report('запись из выделения', error); msg.textContent = 'ошибка'; }
  };
  const onDown = event => { if (!bar.contains(event.target)) hide(); };
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keyup', onUp);
  document.addEventListener('mousedown', onDown);
  bar.addEventListener('mousedown', event => event.preventDefault());   // нажатие на плашку не снимает выделение
  bar.addEventListener('click', onClick);
  return () => {
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keyup', onUp);
    document.removeEventListener('mousedown', onDown);
    bar.remove();
  };
}
