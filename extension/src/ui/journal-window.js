/**
 * Окно «Журнал»: квесты в духе Baldur's Gate. Слева список квестов с фильтрами, справа страница квеста:
 * цель, зацепки (у каждой своя судьба), лента записей с игровой датой и то, что уйдёт рассказчику.
 * Читает shared.scene.get(); все изменения идут через сервис, он же откатывает вместе с чатом.
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { eyeLog as readEyeLog } from './eye-log.js';
import { CALENDARS, locate } from '../core/calendars.js';
import { dayNumber, formatTime, partOfDay } from '../core/clock.js';
import { STATUS_RU, LEAD_RU, isOpenStatus, sortedEntries, openLeads } from '../core/journal.js';

const FILTERS = [['active', 'Идущие'], ['done', 'Выполненные'], ['closed', 'Провалены и брошены'], ['all', 'Все']];
const matches = (q, f) => f === 'all' || (f === 'active' ? isOpenStatus(q.status) : f === 'done' ? q.status === 'done' : q.status === 'failed' || q.status === 'dropped');
const LEAD_MARK = { open: '○', work: '◐', done: '✓', dead: '✕' };

export function startJournalWindow(deps) {
  const { shared } = deps;
  const scene = () => shared.scene;
  const shell = createShell({ id: 'sj-journal', label: 'Журнал', width: 1040 });
  const { win } = shell;
  let filter = 'active';
  let selected = '';
  let view = 'quests';         // 'quests' | 'eye': раздел «Наблюдения Ока» (журнал удалённого свидетеля, только чтение)

  /** Журнал наблюдений: накопительная тайна удалённого свидетеля (Око → Вестор). Ведёт летописец, модели отсюда ничего не уходит. */
  const eyeLog = info => readEyeLog(info, deps.settings);
  function eyeSideHtml(info) {
    const log = eyeLog(info);
    if (!log.on && !log.rows.length) return '';
    return `<button class="sj-q act" data-eye="1" aria-current="${view === 'eye'}"><span class="ic">◉</span><span class="nm">Наблюдения Ока</span><span class="meta">${log.rows.length ? `записей: ${log.rows.length}` : 'пока пусто'}</span></button>`;
  }
  function eyeHtml(info) {
    const log = eyeLog(info);
    const used = log.rows.join('\n').length;
    const rows = [...log.rows].reverse().map((t, i) => `<li class="sj-en ${i === 0 ? 'new' : 'old'}"><div class="x">${esc(t)}</div></li>`).join('');
    const who = log.watcher ? esc(log.watcher) : 'наблюдатель';
    return `<div class="sj-qh"><h2>Наблюдения Ока</h2></div>
      <div class="sj-goal"><span class="sj-lbl">Кто видит</span>${who}. Пока Око в комнате с героями, архивариус дописывает сюда, что оно увидело и услышало. Новые записи сверху.</div>
      <div class="sj-sec"><h3>Записи</h3></div><ul class="sj-tl">${rows || '<li class="sj-none">Око пока ничего не видело.</li>'}</ul>
      <div class="sj-tell"><div class="sj-lbl">${!(log.on && deps.settings.enabled && deps.settings.sendKnowledge) ? 'Не отправляется (выключено в настройках)' : log.send ? `Рассказчику включено вручную: уходит, только пока ${who} в кадре` : 'Рассказчику не уходит (включается вручную в «Тайны» → «Наблюдения Ока»)'}</div><div class="sj-sub">Остальным героям эти записи не показываются. Записей: ${log.rows.length}, ничего не вытесняется. В Вестники идёт вся память Ока всегда.</div></div>`;
  }
  let editing = null;          // { kind: 'goal' | 'title' | 'note' | 'new', id? }
  let importNote = '';

  function dateHtml(info, entry) {
    if (!entry.date) return '<span class="sj-sub">дата неизвестна</span>';
    const cal = CALENDARS[info.state.calendar];
    const loc = locate(cal, entry.date.year, entry.date.doy);
    const name = loc ? (loc.period.type === 'festival' ? loc.period.ru : `${loc.period.ru}, ${loc.day}`) : '?';
    const day = dayNumber(info.state.calendar, info.state.dayOne, entry.date);
    const time = entry.minutes !== null && entry.minutes !== undefined ? ` · ${partOfDay(entry.minutes)}, ${formatTime(entry.minutes)}` : '';
    return `<span class="sj-dayn">Д${day}</span> <b>${esc(name)}</b>${time}`;
  }

  function sideHtml(info) {
    const list = info.quests.filter(q => matches(q, filter));
    const icon = q => (q.tracked ? '◆' : q.status === 'done' ? '✓' : q.status === 'failed' ? '✕' : q.status === 'dropped' ? '–' : q.status === 'paused' ? '⏸' : '○');
    const rows = list.map(q => {
      const open = openLeads(q).length;
      const cls = isOpenStatus(q.status) ? 'act' : q.status === 'done' ? 'fin' : 'bad';
      return `<button class="sj-q ${cls}" data-q="${esc(q.id)}" aria-current="${q.id === selected}"><span class="ic">${icon(q)}</span><span class="nm">${esc(q.title)}</span>
        <span class="meta">${q.unseen ? '<span class="upd">обновлён</span> · ' : ''}${isOpenStatus(q.status) ? (open ? `открытых зацепок: ${open}` : 'без открытых зацепок') : STATUS_RU[q.status]}</span></button>`;
    }).join('');
    const plan = scene().previewKulisyQuests?.();
    const kulisy = plan && plan.fresh.length
      ? `<div class="sj-import"><div class="sj-sub">У Кулис в этом чате квестов: ${plan.total}${plan.total !== plan.fresh.length ? `, новых для журнала: ${plan.fresh.length}` : ''}.</div><button class="sj-btn sj-pri" data-act="import">Перенести из Кулис</button></div>` : '';
    const creating = editing?.kind === 'new'
      ? `<div class="sj-newq"><input id="sj-nq-title" placeholder="Название квеста" aria-label="Название"><input id="sj-nq-goal" placeholder="Цель, одной фразой" aria-label="Цель"><div class="sj-actions"><button class="sj-btn sj-pri" data-act="nq-save">Создать</button><button class="sj-btn" data-act="nq-cancel">Отмена</button></div></div>`
      : '<button class="sj-btn" data-act="nq-open" style="margin-top:8px;width:100%">+ Новый квест</button>';
    return `<div class="sj-filters">${FILTERS.map(([k, n]) => `<button class="sj-tab" data-f="${k}" aria-pressed="${view === 'quests' && k === filter}">${n}</button>`).join('')}</div>
      ${eyeSideHtml(info)}
      ${rows || '<div class="sj-none" style="padding:8px">Здесь пусто.</div>'}${creating}${kulisy}${importNote ? `<div class="sj-sub" style="margin-top:6px">${esc(importNote)}</div>` : ''}`;
  }

  function pageHtml(info) {
    const q = info.quests.find(x => x.id === selected);
    if (!q) return '<div class="sj-empty">Выберите квест слева или создайте новый.</div>';
    const open = isOpenStatus(q.status);
    const acts = open
      ? `<button class="sj-btn sj-pri" data-act="st-done">Выполнен</button><button class="sj-btn" data-act="st-failed">Провален</button><button class="sj-btn" data-act="${q.status === 'paused' ? 'st-active' : 'st-paused'}">${q.status === 'paused' ? 'Вернуть в работу' : 'Отложить'}</button><button class="sj-btn" data-act="st-dropped">Бросить</button>`
      : '<button class="sj-btn sj-pri" data-act="st-active">Вернуть в работу</button>';
    const track = open ? `<button class="sj-btn" data-act="track" title="Этот квест виден в строке сцены">${q.tracked ? '◆ отслеживается' : '◇ отслеживать'}</button>` : '';
    const title = editing?.kind === 'title' && editing.id === q.id
      ? `<input id="sj-edit-title" class="sj-wide" value="${esc(q.title)}" aria-label="Название"><button class="sj-btn sj-pri" data-act="title-save">Сохранить</button>`
      : `<h2>${esc(q.title)}<span class="sj-stat ${q.status}">${STATUS_RU[q.status]}</span> <button class="sj-st" data-act="title-edit" title="переименовать" aria-label="Переименовать">✎</button></h2>`;
    const goal = editing?.kind === 'goal' && editing.id === q.id
      ? `<div class="sj-goal"><span class="sj-lbl">Цель</span><textarea id="sj-edit-goal" rows="2" class="sj-wide">${esc(q.goal)}</textarea><div class="sj-actions"><button class="sj-btn sj-pri" data-act="goal-save">Сохранить</button><button class="sj-btn" data-act="edit-cancel">Отмена</button></div></div>`
      : `<div class="sj-goal"><span class="sj-lbl">Цель <button class="sj-st" data-act="goal-edit" title="править" aria-label="Править цель">✎</button></span>${q.goal ? esc(q.goal) : '<span class="sj-sub">не задана</span>'}</div>`;
    const leads = q.leads.map(l => {
      const noteEdit = editing?.kind === 'note' && editing.id === q.id && editing.leadId === l.id;
      return `<div class="sj-ld ${l.state}"><span class="mk">${LEAD_MARK[l.state]}</span><span class="t">${esc(l.t)}</span>
        <span class="row"><button class="sj-st" data-lead="${esc(l.id)}" title="щёлк: сменить состояние">${LEAD_RU[l.state]}</button><button class="sj-st" data-note="${esc(l.id)}" title="примечание" aria-label="Примечание">✎</button><button class="sj-st" data-dellead="${esc(l.id)}" aria-label="Убрать зацепку">✕</button></span>
        ${noteEdit ? `<span class="o"><input id="sj-edit-note" class="sj-wide" value="${esc(l.note)}" placeholder="Чем кончилось, что известно" aria-label="Примечание"><button class="sj-btn sj-pri" data-act="note-save" data-lead="${esc(l.id)}">Сохранить</button></span>` : l.note ? `<span class="o">${esc(l.note)}</span>` : ''}</div>`;
    }).join('');
    const entries = sortedEntries(q).map((e, i) => `<li class="sj-en ${i === 0 ? 'new' : 'old'}"><div class="d">${dateHtml(info, e)} <button class="sj-st sj-delen" data-delen="${esc(e.id)}" aria-label="Убрать запись">✕</button></div><div class="x">${esc(e.t)}</div></li>`).join('');
    const sent = info.questLines.filter(line => line.startsWith(`quest[${q.title}]`));
    return `<div class="sj-qh">${title}<div class="acts">${track}${acts}</div></div>
      <div class="sj-chips">${q.place ? `<span class="sj-chip">${esc(q.place)}</span>` : ''}${q.who.map(w => `<span class="sj-chip">${esc(w)}</span>`).join('')}</div>
      ${goal}
      <div class="sj-sec"><h3>Зацепки</h3></div><div class="sj-leads">${leads || '<div class="sj-none">Пока нет.</div>'}</div>
      <div class="sj-add"><input id="sj-newlead" placeholder="Новая зацепка: кто или что может помочь…" aria-label="Новая зацепка"><button class="sj-btn" data-act="addlead">Добавить</button></div>
      <div class="sj-sec"><h3>Записи</h3></div><ul class="sj-tl">${entries || '<li class="sj-none">Записей нет.</li>'}</ul>
      <div class="sj-add"><input id="sj-newentry" placeholder="Добавить запись вручную…" aria-label="Новая запись"><button class="sj-btn sj-pri" data-act="addentry">Записать</button></div>
      <div class="sj-tell"><div class="sj-lbl">${deps.settings.enabled && deps.settings.sendQuests && q.status === 'active' ? 'Уйдёт рассказчику' : 'Не отправляется (уходят только идущие квесты)'}</div>${sent.length ? `<pre>${esc(sent.join('\n'))}</pre>` : ''}</div>`;
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    shell.theme(info.state.calendar);
    if (!info.quests.find(q => q.id === selected)) {
      const first = info.quests.find(q => matches(q, filter)) ?? info.quests[0];
      selected = first?.id ?? '';
    }
    win.innerHTML = `<div class="sj-wh"><h2>Журнал</h2><span class="sj-sub">${esc(info.date.name)} · ${info.date.year} ${esc(info.date.era)}${info.date.storyDay != null ? ` · Д${info.date.storyDay}` : ''}</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="sj-jbody"><div class="sj-jside">${sideHtml(info)}</div><div class="sj-jpage">${view === 'eye' ? eyeHtml(info) : pageHtml(info)}</div></div>`;
  }

  const val = sel => win.querySelector(sel)?.value ?? '';
  const onClick = event => {
    const t = event.target;
    if (t.closest('[data-eye]')) { view = 'eye'; editing = null; return render(); }
    const f = t.closest('[data-f]');
    if (f) { view = 'quests'; filter = f.dataset.f; const info = scene().get(); const first = info.quests.find(q => matches(q, filter)); if (first) selected = first.id; return render(); }
    const qb = t.closest('[data-q]');
    if (qb) { view = 'quests'; selected = qb.dataset.q; editing = null; scene().markQuestSeen(selected); return render(); }
    const lead = t.closest('[data-lead]');
    if (lead && !lead.dataset.act) { scene().setLeadState(selected, lead.dataset.lead); return; }
    const note = t.closest('[data-note]'); if (note) { editing = { kind: 'note', id: selected, leadId: note.dataset.note }; return render(); }
    const dl = t.closest('[data-dellead]'); if (dl) { scene().removeLead(selected, dl.dataset.dellead); return; }
    const de = t.closest('[data-delen]'); if (de) { scene().removeEntry(selected, de.dataset.delen); return; }
    const act = t.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') return shell.close();
    if (act === 'nq-open') { editing = { kind: 'new' }; render(); win.querySelector('#sj-nq-title')?.focus(); return; }
    if (act === 'nq-cancel' || act === 'edit-cancel') { editing = null; return render(); }
    if (act === 'nq-save') {
      const title = win.querySelector('#sj-nq-title');
      const id = scene().addQuest({ title: title.value, goal: val('#sj-nq-goal') });
      if (!id) { title.classList.add('sj-bad'); return; }
      editing = null; selected = id; filter = 'active'; return render();
    }
    if (act === 'import') { const r = scene().importQuestsFromKulisy(); importNote = r.ok ? `Перенесено квестов: ${r.imported}${r.skipped ? `, уже были в журнале: ${r.skipped}` : ''}.` : 'Кулисы не найдены.'; filter = 'all'; return render(); }
    if (act.startsWith('st-')) { scene().setQuestStatus(selected, act.slice(3)); if (!isOpenStatus(act.slice(3))) filter = 'all'; return; }
    if (act === 'track') { scene().toggleTrack(selected); return; }
    if (act === 'title-edit') { editing = { kind: 'title', id: selected }; render(); win.querySelector('#sj-edit-title')?.focus(); return; }
    if (act === 'title-save') { scene().setQuestText(selected, { title: val('#sj-edit-title') }); editing = null; return render(); }
    if (act === 'goal-edit') { editing = { kind: 'goal', id: selected }; render(); win.querySelector('#sj-edit-goal')?.focus(); return; }
    if (act === 'goal-save') { scene().setQuestText(selected, { goal: val('#sj-edit-goal') }); editing = null; return render(); }
    if (act === 'note-save') { scene().setLeadNote(selected, t.closest('[data-lead]').dataset.lead, val('#sj-edit-note')); editing = null; return render(); }
    if (act === 'addlead') { const box = win.querySelector('#sj-newlead'); if (!scene().addLead(selected, box.value)) box.classList.add('sj-bad'); return; }
    if (act === 'addentry') { const box = win.querySelector('#sj-newentry'); if (!scene().addEntry(selected, box.value)) box.classList.add('sj-bad'); }
  };
  const onKey = event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const id = event.target.id;
    const click = sel => { event.preventDefault(); win.querySelector(sel)?.click(); };
    if (id === 'sj-newlead') click('[data-act="addlead"]');
    else if (id === 'sj-newentry') click('[data-act="addentry"]');
    else if (id === 'sj-nq-title' || id === 'sj-nq-goal') click('[data-act="nq-save"]');
    else if (id === 'sj-edit-title') click('[data-act="title-save"]');
    else if (id === 'sj-edit-note') click('[data-act="note-save"]');
  };
  win.addEventListener('click', onClick);
  win.addEventListener('keydown', onKey);

  // события чата приходят по ходу игры: пока человек печатает в окне, не перерисовываем
  const unsubscribe = scene()?.subscribe(info => {
    if (!shell.isOpen) return;
    if (!info?.hasChat) return shell.close();
    if (win.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    render();
  });

  function open() {
    const info = scene()?.get();
    if (!info?.hasChat) return;
    editing = null; importNote = ''; view = 'quests';
    const tracked = info.quests.find(q => q.tracked);
    const first = tracked ?? info.quests.find(q => isOpenStatus(q.status));
    if (first) { selected = first.id; filter = 'active'; } else if (info.quests.length) { selected = info.quests[0].id; filter = 'all'; }
    shell.show(info.state.calendar);
    render();
    win.focus();
  }

  shared.ui = { ...(shared.ui ?? {}), openJournal: open, closeJournal: shell.close };
  return () => {
    unsubscribe?.();
    win.removeEventListener('click', onClick);
    win.removeEventListener('keydown', onKey);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openJournal; delete shared.ui.closeJournal; }
  };
}
