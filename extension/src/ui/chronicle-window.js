/**
 * Окно «Архивариус»: предложения вспомогательной модели по ответам рассказчика. «Записать» вносит правку в журнал
 * или отношения, «Нет» убирает. Кнопка «Разобрать последний ответ» запускает все задачи, минуя фильтры.
 * Ниже блок «Сжатие контекста»: сводка «что было», её граница, глубокое сжатие и настройки (служба digest-service).
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { report } from '../guard.js';

const KIND_RU = { entry: 'Запись', lead: 'Зацепка', quest: 'Новый квест', rel: 'Отношения', arrive: 'В кадре', leave: 'В кадре', newperson: 'Новый герой', item: 'Вещи', body: 'Тело', place: 'Место', know: 'Знания' };

export function startChronicleWindow(deps) {
  const { shared } = deps;
  const shell = createShell({ id: 'sj-chronicle', label: 'Архивариус', width: 1000 });
  const { win } = shell;

  /** Статус сжатия одной строкой. */
  function digestStat(d) {
    if (!d) return '';
    if (d.busy) return d.note || 'Сжимаю…';
    if (d.error) return d.error;
    const cut = d.lastCut?.n ? `В последнем запросе вырезано сообщений: ${d.lastCut.n}, около ${Math.round(d.lastCut.chars / 3.5)} токенов.` : (d.lastCut?.why ? `Последний запрос: ${d.lastCut.why}.` : '');
    return `${d.covered ? `Сводка покрывает сообщения до № ${d.covered}, ${d.words} слов.` : 'Сводки ещё нет.'} ${d.note ? d.note + ' ' : ''}${cut}`.trim();
  }
  /** Блок «Сжатие контекста»: старые разобранные сообщения сворачиваются в сводку и не уходят основной модели. */
  function digestHtml() {
    const d = shared.digest?.get();
    if (!d) return '';
    const c = d.cfg;
    return `<div class="sj-lbl" style="margin-top:14px">Сжатие контекста</div>
      <div class="sj-sub" style="margin-bottom:6px">Когда Архивариус разобрал ответы, старые сообщения сворачиваются в короткую сводку «что было» и перестают уходить основной модели. Последние сообщения остаются как есть. В самом чате ничего не удаляется и не прячется.</div>
      <label class="sj-chk"><input type="checkbox" data-dig="enabled" ${c.enabled ? 'checked' : ''}><span>Сжимать контекст (нужна вспомогательная модель Архивариуса)</span></label>
      <label class="sj-chk"><input type="checkbox" data-dig="markHidden" ${c.markHidden ? 'checked' : ''}><span>Скрывать сжатые сообщения в чате (значок «скрыто», как у /hide)</span></label>
      <label class="sj-chk"><span>Оставлять последних</span><input type="number" data-dignum="keep" min="2" max="30" value="${c.keep}" style="width:64px"><span>сообщений как есть</span></label>
      <label class="sj-chk"><span>Сжимать пачкой от</span><input type="number" data-dignum="batch" min="2" max="30" value="${c.batch}" style="width:64px"><span>сообщений (чем больше, тем реже запросы)</span></label>
      <label class="sj-chk"><span>Длина сводки до</span><input type="number" data-dignum="words" min="100" max="1200" step="50" value="${c.words}" style="width:72px"><span>слов</span></label>
      <label class="sj-chk"><span>Сводка покрывает сообщения до №</span><input type="number" data-digupto min="0" value="${d.covered}" style="width:80px"><span>(0 — ничего; для сводки, написанной вручную)</span></label>
      <div class="sj-sub" id="sj-digstat" style="margin:4px 0">${esc(digestStat(d))}</div>
      <div class="sj-add"><button class="sj-btn" data-act="digrun" title="Сжать всё, что уже разобрано и старше последних сообщений">Сжать сейчас</button><button class="sj-btn" data-act="digcond" title="Давние события в сводке остаются ключевыми моментами, недавние почти как есть: сводка становится вдвое короче">Сжать контекст</button>${d.canUndo ? '<button class="sj-btn" data-act="digundo">Отменить сжатие</button>' : ''}<button class="sj-btn" data-act="digreset" title="Стереть сводку: весь чат снова пойдёт в запрос целиком">Сбросить сводку</button></div>
      <div class="sj-tell"><div class="sj-lbl">Сводка, которая уходит рассказчику</div>
        <textarea data-digtext rows="8" style="width:100%" placeholder="Сводки пока нет">${esc(d.text)}</textarea>
        <div class="sj-add"><button class="sj-btn sj-pri" data-act="digsave">Сохранить правку</button></div></div>`;
  }

  function render() {
    const info = shared.scene?.get();
    const ch = shared.chronicle?.get();
    if (!info?.hasChat || !ch) { shell.close(); return; }
    shell.theme(info.state.calendar);
    const rows = ch.proposals.map(p => `<div class="sj-prop"><span class="k">${KIND_RU[p.kind] ?? p.kind}</span><span class="t">${esc(p.label)}</span><span class="b"><button class="sj-btn sj-pri" data-ok="${esc(p.id)}">Записать</button><button class="sj-btn" data-no="${esc(p.id)}">Нет</button></span></div>`).join('');
    win.innerHTML = `<div class="sj-wh"><h2>Архивариус</h2><span class="sj-sub">${ch.ready ? (ch.auto ? 'разбирает ответы сам' : 'только по кнопке') : 'модель не настроена'}</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div style="padding:12px 18px 16px">
        <div class="sj-add" style="margin:0 0 10px"><button class="sj-btn sj-pri" data-act="run" ${ch.busy || !ch.ready ? 'disabled' : ''}>${ch.busy ? 'Разбираю' : 'Разобрать последний ответ'}</button>${ch.proposals.length > 1 ? '<button class="sj-btn" data-act="all">Записать всё</button><button class="sj-btn" data-act="clear">Очистить</button>' : ''}</div>
        ${ch.ready ? '' : '<div class="sj-sub" style="margin-bottom:8px">Выберите вспомогательную модель в окне «Настройки», блок «Архивариус».</div>'}
        ${ch.note ? `<div class="sj-sub">${esc(ch.note)}</div>` : ''}
        <div style="margin-top:10px">${rows || '<div class="sj-none">Предложений нет.</div>'}</div>
        ${digestHtml()}
        <div class="sj-sub" style="margin-top:10px">Запросы и ошибки: «Настройки» → «Данные».</div>
        ${historyHtml()}
      </div>`;
  }

  const KIND_SHORT = { rel: 'отношения', cast: 'состав', item: 'вещи', body: 'тело', place: 'место', know: 'знания', moment: 'моменты', quest: 'журнал' };
  const KUL_SHORT = { 'memory.add': 'воспоминание', 'tension.add': 'напряжение', 'scale.delta': 'шкала', 'event.add': 'событие', 'item.add': 'вещь', 'item.update': 'вещь', 'condition.add': 'состояние', 'condition.remove': 'состояние−', 'wardrobe.set': 'одежда', 'location.update': 'место', 'location.add': 'место', 'acquaintance.set': 'знакомство', 'death.set': 'гибель', 'quest.step': 'квест', 'quest.update': 'квест', 'learned.add': 'узнал' };
  const SKIP_KUL = new Set(['heat.set', 'scene.set', 'clock.set', 'weather.set']);
  function historyHtml() {
    const rows = shared.chronicle.history(12);
    if (!rows.length) return '';
    const ours = o => Object.entries(o).map(([k, n]) => `${KIND_SHORT[k] ?? k}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    const kul = k => { if (!k) return '<span class="sj-sub">нет данных</span>'; const items = Object.entries(k.types).filter(([t]) => !SKIP_KUL.has(t)).map(([t, n]) => `${KUL_SHORT[t] ?? t}${n > 1 ? ` ×${n}` : ''}`); return items.length ? esc(items.join(', ')) : '<span class="sj-sub">—</span>'; };
    const body = rows.map(r => `<tr><td>#${r.index + 1}</td><td>${Object.keys(r.ours).length ? esc(ours(r.ours)) : '<span class="sj-sub">—</span>'}${r.run ? ` <small class="sj-sub">· ${esc(r.run.tasks.join('+') || '—')}, ${(r.run.ms / 1000).toFixed(1)} с${r.run.error ? ', ошибка' : ''}</small>` : ''}</td><td>${kul(r.kulisy)}</td></tr>`).join('');
    const oursCovered = rows.filter(r => Object.keys(r.ours).length).length, kulCovered = rows.filter(r => r.kulisy && Object.entries(r.kulisy.types).some(([t]) => !SKIP_KUL.has(t))).length;
    return `<div class="sj-sec"><h3>Как он отработал: наш Архивариус и Кулисы по последним ответам</h3></div>
      <div class="sj-sub" style="margin-bottom:6px">Записи есть у нас на ${oursCovered} из ${rows.length} ответов, у Кулис на ${kulCovered}. У нас записи только по тому, что нашлось в тексте (бывают пустые ответы), в скобках время и ошибки запуска (только пока страница не перезагружена).</div>
      <table class="sj-hist"><thead><tr><th>Ответ</th><th>Наш Архивариус</th><th>Кулисы</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  const onClick = event => {
    const t = event.target;
    const ok = t.closest('[data-ok]'); if (ok) return void shared.chronicle.apply(ok.dataset.ok);
    const no = t.closest('[data-no]'); if (no) return void shared.chronicle.dismiss(no.dataset.no);
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'close') shell.close();
    else if (act === 'run') shared.chronicle.run(undefined, { force: true });
    else if (act === 'all') shared.chronicle.applyAll();
    else if (act === 'clear') shared.chronicle.clear();
    else if (act === 'digrun') shared.digest?.run({ force: true });
    else if (act === 'digcond') shared.digest?.condense().then(() => render());
    else if (act === 'digundo') { shared.digest?.undoCondense(); render(); }
    else if (act === 'digreset') { shared.digest?.reset(); render(); }
    else if (act === 'digsave') shared.digest?.setText(win.querySelector('[data-digtext]')?.value ?? '');
  };
  win.addEventListener('click', onClick);
  const typing = () => win.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  const unsubscribe = shared.chronicle?.subscribe(() => { if (shell.isOpen && !typing()) render(); });
  const unDigest = shared.digest?.subscribe(d => { const el = win.querySelector('#sj-digstat'); if (el) el.textContent = digestStat(d); else if (shell.isOpen && !typing()) render(); });
  const onChange = event => {
    const el = event.target;
    try {
      if (el.dataset?.digupto !== undefined) { shared.digest?.setUpto(el.value); render(); }
      else if (el.dataset?.dig) shared.digest?.setOption({ [el.dataset.dig]: el.checked });
      else if (el.dataset?.dignum) shared.digest?.setOption({ [el.dataset.dignum]: Number(el.value) });
    } catch (e) { report('сжатие контекста', e); }
  };
  win.addEventListener('change', onChange);

  function open() {
    const info = shared.scene?.get();
    if (!info?.hasChat) return;
    shell.show(info.state.calendar);
    render();
    win.focus();
  }
  shared.ui = { ...(shared.ui ?? {}), openChronicle: open, closeChronicle: shell.close };
  return () => {
    unsubscribe?.();
    unDigest?.();
    win.removeEventListener('change', onChange);
    win.removeEventListener('click', onClick);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openChronicle; delete shared.ui.closeChronicle; }
  };
}
