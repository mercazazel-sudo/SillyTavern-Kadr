/**
 * Окно «Разбор лорбука»: записи привязанного лорбука делятся на людей (анкеты), места («Карта», ссылка на запись)
 * и остальное (остаётся в лорбуке). Модель или признаки только предлагают, человек правит вид каждой записи и имя,
 * потом жмёт «Добавить». Лорбук не меняется.
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { KIND_RU } from '../core/triage.js';

const ORDER = ['person', 'place', 'other'];

export function startTriageWindow(deps) {
  const { shared } = deps;
  const svc = () => shared.triage;
  const shell = createShell({ id: 'sj-triage', label: 'Разбор лорбука', width: 820 });
  const { win } = shell;
  let stage = 'pick';          // pick: выбор лорбука; scan: идёт разбор; plan: список; done: итог
  let book = '';
  let plan = [];
  let tab = 'person';
  let note = '';
  let progress = '';
  let result = null;

  const counts = () => Object.fromEntries(ORDER.map(k => [k, plan.filter(p => p.kind === k).length]));

  function pickHtml() {
    const s = svc()?.get();
    const list = s?.all ?? [];
    if (!list.length) return '<div class="sj-tri-empty">Новых записей для разбора нет. Если вы привязали лорбук или добавили в него записи, подождите секунду или откройте окно ещё раз.</div>';
    return `<p class="sj-sub">Записи лорбука можно разобрать по людям и местам. Лорбук при этом не меняется.</p>
      <div class="sj-tri-books">${list.map(b => `<div class="sj-tri-book"><div class="tx"><b>${esc(b.book)}</b><small>${b.isNew ? 'новый лорбук' : 'новые записи'}: ${b.fresh} из ${b.total}</small></div>
        <button class="sj-btn sj-pri" data-scan="${esc(b.book)}">Разобрать</button><button class="sj-btn" data-skip="${esc(b.book)}" title="Записи останутся в лорбуке как есть">Оставить</button><button class="sj-btn" data-mute="${esc(b.book)}" title="Больше не предлагать для этого лорбука">Не предлагать</button></div>`).join('')}</div>`;
  }

  function rowHtml(p, i) {
    const showName = p.kind !== 'other';
    return `<div class="sj-tri-row${p.sure ? '' : ' unsure'}" data-i="${i}">
      <div class="tx">${showName ? `<input class="sj-tri-name" data-name="${i}" value="${esc(p.name)}" aria-label="Имя">` : `<b class="sj-tri-title">${esc(p.title)}</b>`}
        <small>${showName ? `${esc(p.title)}${p.parentTitle ? ` · внутри: ${esc(p.parentTitle)}` : ''}` : esc(p.snippet)}</small></div>
      <button class="sj-tri-kind k-${p.kind}" data-cycle="${i}" title="Нажмите, чтобы сменить: человек, место, остальное">${KIND_RU[p.kind]}${p.sure ? '' : ' ?'}</button></div>`;
  }

  function planHtml() {
    const c = counts();
    const rows = plan.map((p, i) => ({ p, i })).filter(x => x.p.kind === tab);
    const tabs = ORDER.map(k => `<button data-tab="${k}" aria-pressed="${tab === k}">${KIND_RU[k]} · ${c[k]}</button>`).join('');
    const hint = { person: 'Станут анкетами второстепенных. Имя можно поправить.', place: 'Появятся на «Карте» со ссылкой на запись: текст остаётся в лорбуке.', other: 'Остаются в лорбуке: правила мира, темы, группы.' }[tab];
    return `${note ? `<div class="sj-sub" style="margin-bottom:8px">${esc(note)}</div>` : ''}
      <div class="sj-tri-tabs" role="tablist">${tabs}</div><div class="sj-sub" style="margin:6px 2px 8px">${hint} Знак «?» значит, что я не уверен.</div>
      <div class="sj-tri-list">${rows.map(x => rowHtml(x.p, x.i)).join('') || '<div class="sj-none" style="padding:10px">Здесь пусто.</div>'}</div>
      <div class="sj-tri-bar"><button class="sj-btn sj-pri" data-apply ${c.person + c.place ? '' : 'disabled'}>Добавить: людей ${c.person}, мест ${c.place}</button><button class="sj-btn" data-back>Назад</button></div>`;
  }

  function doneHtml() {
    const r = result;
    const lines = [`Анкет создано: ${r.cards.created}, обновлено: ${r.cards.updated}.`, `Мест привязано к записям: ${r.places}${r.placesNew ? ` (новых на «Карте»: ${r.placesNew})` : ''}.`];
    return `<ul class="sj-su-done">${lines.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="sj-tri-bar"><button class="sj-btn sj-pri" data-open="openCards">Открыть «Анкеты»</button><button class="sj-btn" data-open="openMap">Открыть «Карту»</button><button class="sj-btn" data-close>Закрыть</button></div>`;
  }

  function render() {
    const body = stage === 'scan' ? `<div class="sj-tri-empty">${esc(progress || 'Читаю записи…')}</div>`
      : stage === 'plan' ? planHtml() : stage === 'done' ? doneHtml() : pickHtml();
    win.innerHTML = `<div class="sj-wh"><h2>Разбор лорбука</h2><span class="sj-sub">${book ? esc(book) : 'люди и места из записей'}</span><button class="sj-btn sj-x" data-close aria-label="Закрыть">×</button></div>
      <div class="sj-trib">${body}</div>`;
  }

  async function startScan(name) {
    book = name; stage = 'scan'; note = ''; progress = 'Читаю записи…'; render();
    try {
      const r = await svc().scan(name, (i, n) => { progress = n ? `Спрашиваю вспомогательную модель: ${Math.min(i + 1, n)} из ${n}` : ''; if (stage === 'scan') render(); });
      plan = r.plan;
      note = r.modelUsed ? (r.failed ? `Часть записей модель не разобрала (${r.failed} пачек): они оценены по признакам.` : '') : 'Вспомогательная модель не подключена: записи оценены по названию и тексту. Проверьте список.';
      tab = counts().person ? 'person' : counts().place ? 'place' : 'other';
      stage = 'plan';
    } catch (error) { note = `Не вышло: ${error?.message ?? error}`; stage = 'pick'; }
    render();
  }

  const onClick = async event => {
    const t = event.target;
    if (t.closest('[data-close]')) return shell.close();
    const sc = t.closest('[data-scan]'); if (sc) return startScan(sc.dataset.scan);
    const sk = t.closest('[data-skip]'); if (sk) { await svc().dismiss(sk.dataset.skip); return render(); }
    const mu = t.closest('[data-mute]'); if (mu) { await svc().mute(mu.dataset.mute); return render(); }
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; return render(); }
    const cy = t.closest('[data-cycle]');
    if (cy) { const p = plan[Number(cy.dataset.cycle)]; if (p) { p.kind = ORDER[(ORDER.indexOf(p.kind) + 1) % ORDER.length]; p.sure = true; if (p.kind !== 'other' && !p.name) p.name = p.title.split(/\s[-–—:]\s/)[0].slice(0, 80); } return render(); }
    if (t.closest('[data-back]')) { stage = 'pick'; return render(); }
    if (t.closest('[data-apply]')) {
      stage = 'scan'; progress = 'Добавляю…'; render();
      try { result = await svc().apply(book, plan); stage = 'done'; } catch (error) { note = `Не вышло: ${error?.message ?? error}`; stage = 'plan'; }
      return render();
    }
    const op = t.closest('[data-open]'); if (op) { shell.close(); shared.ui?.[op.dataset.open]?.(); }
  };
  const onChange = event => {
    const el = event.target.closest?.('[data-name]');
    if (el && plan[Number(el.dataset.name)]) plan[Number(el.dataset.name)].name = el.value.trim().slice(0, 80);
  };
  win.addEventListener('click', onClick);
  win.addEventListener('change', onChange);

  async function open(name = '') {
    const info = shared.scene?.get();
    if (!info?.hasChat) return;
    shell.show(info.state.calendar);
    stage = 'pick'; note = ''; result = null; plan = []; book = '';
    render();
    await svc()?.check();
    if (!shell.isOpen) return;
    const all = svc()?.get().all ?? [];
    if (name && all.some(b => b.book === name)) return startScan(name);
    if (all.length === 1) return startScan(all[0].book);
    render();
  }

  shared.ui = { ...(shared.ui ?? {}), openTriage: open, closeTriage: shell.close };
  return () => {
    win.removeEventListener('click', onClick);
    win.removeEventListener('change', onChange);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openTriage; delete shared.ui.closeTriage; }
  };
}
