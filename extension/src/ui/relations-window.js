/**
 * Окно «Отношения»: слева люди (кто в кадре первыми), справа линии выбранного человека: что он чувствует к другим
 * или что чувствуют к нему. Карточка линии раскрывается: шкалы, стадия, воспоминания, напряжения, факторы роста, цель.
 * Читает shared.scene.get(); правки идут через сервис. Рассказчику уходят только линии присутствующих.
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { SCALES, DARK_SCALES, MAIN_SCALES, UI_SCALES, nameOf } from '../core/relations.js';

export function startRelationsWindow(deps) {
  const { shared, settings } = deps;
  const scene = () => shared.scene;
  const shell = createShell({ id: 'sj-relations', label: 'Отношения', width: 1120 });
  const { win } = shell;
  let selected = '';
  let dir = 'out';             // out: что выбранный чувствует; in: что чувствуют к нему (у персоны всегда in)
  let wasPersona = false;
  let open = '';               // id раскрытой линии
  let importNote = '';
  const extra = new Map();     // id линии → шкалы, добавленные кнопкой «+» (живут, пока окно не закрыто)

  const scaleRu = id => SCALES.find(s => s.id === id)?.ru ?? id;
  const sign = v => (v > 0 ? '+' : '') + v;

  /** Шкалы линии: четыре основные всегда, плюс добавленные кнопкой «+» и уже заполненные (в том числе старые, которых в списке «+» нет). */
  function scaleRows(line) {
    const added = extra.get(line.id) ?? new Set();
    const shown = SCALES.filter(s => MAIN_SCALES.includes(s.id) || added.has(s.id) || (line.scales[s.id] ?? 0) !== 0)
      .sort((a, b) => (order(a.id) - order(b.id)));
    const row = s => {
      const v = line.scales[s.id] ?? 0;
      const main = MAIN_SCALES.includes(s.id);
      return `<div class="sj-sc${DARK_SCALES.has(s.id) ? ' dark' : ''}${v < 0 ? ' neg' : ''}${v === 0 ? ' zero' : ''}${line.hidden.includes(s.id) ? ' hid' : ''}"><span class="n">${esc(s.ru)}</span><input type="range" min="-100" max="100" step="5" value="${v}" data-scale="${s.id}" aria-label="${esc(s.ru)}"><output>${sign(v)}</output><button class="sj-st" data-hide="${s.id}" title="не отправлять эту шкалу рассказчику">${line.hidden.includes(s.id) ? 'показ.' : 'скрыть'}</button>${main ? '' : `<button class="sj-st" data-dropscale="${s.id}" title="убрать шкалу из карточки и обнулить" aria-label="Убрать шкалу">✕</button>`}</div>`;
    };
    const shownIds = new Set(shown.map(s => s.id));
    const rest = UI_SCALES.filter(id => !shownIds.has(id));
    const adder = rest.length ? `<div class="sj-add sj-addscale"><select data-addscale aria-label="Добавить шкалу">${rest.map(id => `<option value="${id}">${esc(scaleRu(id))}</option>`).join('')}</select><button class="sj-btn" data-act="addscale" title="Показать ещё одну шкалу">+ шкала</button></div>` : '';
    return `<div class="sj-scrows"><div class="sj-bars">${shown.map(row).join('')}</div>${adder}</div>`;
  }
  const order = id => { const i = UI_SCALES.indexOf(id); return i < 0 ? 100 + SCALES.findIndex(s => s.id === id) : i; };

  function recordsHtml(line, kind, title) {
    const items = line[kind].map(r => `<li class="${r.disabled ? 'off' : ''}"><span class="t">${r.pinned ? '📌 ' : ''}${esc(r.text)}</span> <small>${'●'.repeat(r.intensity)}</small>
      <button class="sj-st" data-rec="pinned" data-kind="${kind}" data-id="${esc(r.id)}" title="закрепить: уходит всегда">${r.pinned ? 'откр.' : 'закреп.'}</button><button class="sj-st" data-rec="disabled" data-kind="${kind}" data-id="${esc(r.id)}" title="не отправлять">${r.disabled ? 'вкл.' : 'выкл.'}</button><button class="sj-st" data-recdel="1" data-kind="${kind}" data-id="${esc(r.id)}" aria-label="Убрать">✕</button></li>`).join('');
    return `<div class="sj-lbl">${title}</div><ul class="sj-rl">${items || '<li class="sj-none">Нет.</li>'}</ul>
      <div class="sj-add"><input data-newrec="${kind}" placeholder="Добавить…" aria-label="${title}"><select data-newint aria-label="Сила" style="width:auto">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === 3 ? ' selected' : ''}>${'●'.repeat(n)}</option>`).join('')}</select><button class="sj-btn" data-act="addrec" data-kind="${kind}">+</button></div>`;
  }

  function editorHtml(line) {
    const factors = line.factors.map((f, i) => `<li><span class="t"><b>${f.direction === 'down' ? '−' : '+'} ${esc(scaleRu(f.scaleId))}:</b> ${esc(f.text)}</span><button class="sj-st" data-delfactor="${i}" aria-label="Убрать">✕</button></li>`).join('');
    return `<div class="sj-led"><div>
      <div class="sj-lbl">Стадия</div><input data-stage value="${esc(line.stage)}" placeholder="например: флирт, союз, холодная война" class="sj-wide" aria-label="Стадия">
      <div class="sj-lbl" style="margin-top:10px">Конечная точка (далёкая цель линии)</div><textarea data-goal rows="2" aria-label="Цель">${esc(line.goal)}</textarea>
      ${recordsHtml(line, 'memories', 'Воспоминания')}${recordsHtml(line, 'tensions', 'Напряжения')}
      <div class="sj-lbl" style="margin-top:10px">Факторы роста</div><ul class="sj-rl">${factors || '<li class="sj-none">Нет.</li>'}</ul>
      <div class="sj-add"><select data-fscale aria-label="Шкала">${UI_SCALES.map(id => `<option value="${id}">${esc(scaleRu(id))}</option>`).join('')}</select><select data-fdir aria-label="Направление" style="width:auto"><option value="up">растёт от</option><option value="down">падает от</option></select></div>
      <div class="sj-add"><input data-ftext placeholder="что двигает чувство" aria-label="Фактор"><button class="sj-btn" data-act="addfactor">+</button></div>
    </div><button class="sj-btn" data-act="delline" style="margin-top:8px">Удалить линию</button></div>`;
  }

  function lineHtml(info, line) {
    const other = dir === 'out' ? line.to : line.from;
    const name = nameOf(other, info.cast, info.relations) || other;
    const sent = info.relationLines.some(l => l.startsWith(`${nameOf(line.from, info.cast, info.relations)}>${nameOf(line.to, info.cast, info.relations)};`));
    const isOpen = open === line.id;
    return `<div class="sj-rcard${isOpen ? ' open' : ''}" data-lid="${esc(line.id)}"><button class="sj-rhead" data-line="${esc(line.id)}" aria-expanded="${isOpen}"><span class="who">${dir === 'out' ? '→' : '←'} ${esc(name)}</span><span class="stage">${esc(line.stage)}</span><span class="more">${isOpen ? 'свернуть ▴' : 'подробнее ▾'}</span><span class="sj-sent${sent ? ' on' : ''}" title="${sent ? 'Уходит рассказчику' : 'Не уходит: кого-то из пары нет в кадре'}">${sent ? '✉' : '·'}</span></button><div class="sj-rbody">${scaleRows(line)}</div>${isOpen ? editorHtml(line) : ''}</div>`;
  }

  function sideHtml(info) {
    const goneIds = info.knowledge.deaths ?? {};
    const rows = [...info.people].sort((a, b) => Number(Boolean(goneIds[a.id])) - Number(Boolean(goneIds[b.id]))).map(p => {
      const dead = Boolean(goneIds[p.id]);
      const n = info.relations.lines.filter(l => (p.persona ? l.to : l.from) === p.id).length;
      return `<button class="sj-q${p.present ? '' : ' away'}${dead ? ' dead' : ''}" data-person="${esc(p.id)}" aria-current="${p.id === selected}"><span class="ic">${dead ? '✕' : p.present ? '●' : '○'}</span><span class="nm">${esc(p.name)}${p.persona ? ' <small>(вы)</small>' : ''}</span><span class="meta">${n ? (p.persona ? `чувств к вам: ${n}` : `чувств: ${n}`) : 'нет линий'}${dead ? ' · умер, не учитывается' : p.present ? '' : ' · не в кадре'}</span></button>`;
    }).join('');
    const plan = scene().previewKulisyRelations?.();
    const kulisy = plan && plan.lines.length
      ? `<div class="sj-import"><div class="sj-sub">У Кулис в этом чате линий: ${plan.lines.length}${plan.freshLines !== plan.lines.length ? `, новых: ${plan.freshLines}` : ''}.</div>${plan.freshLines || plan.freshHeadcanons ? `<div class="sj-sub">${plan.freshHeadcanons ? `Хедканонов к переносу: ${plan.freshHeadcanons}.` : ''}</div><button class="sj-btn sj-pri" data-act="import">Перенести из Кулис</button>` : ''}</div>` : '';
    return `${rows || '<div class="sj-none">Участников нет.</div>'}
      <div class="sj-add" style="margin-top:8px"><input id="sj-newperson" placeholder="Человек вне сцены…" aria-label="Новый человек"><button class="sj-btn" data-act="addperson">+</button></div>
      ${kulisy}${importNote ? `<div class="sj-sub" style="margin-top:6px">${esc(importNote)}</div>` : ''}`;
  }

  function logHtml(info) {
    const entries = [...info.relations.log].reverse().slice(0, 14);
    if (!entries.length) return '';
    const rows = entries.map(e => `<li><span class="t"><small>ответ ${e.at + 1}</small> ${esc(e.label || (e.kind === 'rel' ? 'сдвиг шкалы' : 'состав сцены'))}</span><button class="sj-st" data-undo="${esc(e.id)}" title="Вернуть как было">отменить</button></li>`).join('');
    // блок .sj-tell оболочка окна превращает в раскрывающийся: закрыт по умолчанию, раскрывается стрелочкой
    return `<div class="sj-tell"><div class="sj-lbl">Что изменилось само · ${entries.length}</div><div class="sj-sub" style="margin-bottom:4px">Архивариус применил это по тексту ответов. Если свайпнуть, исправить или удалить ответ, его изменения снимутся сами.</div><ul class="sj-rl">${rows}</ul></div>`;
  }

  function headcanonsHtml(info, person) {
    const mine = info.relations.headcanons.filter(h => h.pair.split('|').includes(person.id));
    const items = mine.map(h => {
      const other = h.pair.split('|').find(id => id !== person.id);
      return `<li class="${h.enabled ? '' : 'off'}"><span class="t"><b>${esc(nameOf(other, info.cast, info.relations) || other)}:</b> ${esc(h.text)}</span><button class="sj-st" data-hc="${esc(h.id)}">${h.enabled ? 'выкл.' : 'вкл.'}</button><button class="sj-st" data-hcdel="${esc(h.id)}" aria-label="Убрать">✕</button></li>`;
    }).join('');
    const others = info.people.filter(p => p.id !== person.id).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    return `<div class="sj-sec"><h3>Хедканоны</h3></div><div class="sj-sub" style="margin-bottom:4px">Устоявшиеся факты о паре: привычки, молчаливые правила. Рассказчик считает их правдой, но не пересказывает.</div>
      <ul class="sj-rl">${items || '<li class="sj-none">Нет.</li>'}</ul>
      <div class="sj-add"><select id="sj-hc-who" aria-label="С кем">${others}</select><input id="sj-hc-text" placeholder="например: держится от неё на расстоянии шага" aria-label="Хедканон"><button class="sj-btn" data-act="addhc">+</button></div>`;
  }

  function trianglesHtml(info) {
    const r = info.relations;
    const optsAt = n => info.people.map((p, i) => `<option value="${esc(p.id)}"${i === n ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    const list = r.triangles.map(t => `<div class="sj-tri${t.resolved ? ' off' : ''}"><span>${esc(nameOf(t.centerId, info.cast, r))} ◂▸ ${esc(nameOf(t.firstId, info.cast, r))}, ${esc(nameOf(t.secondId, info.cast, r))}${t.goal ? ` <small>· ${esc(t.goal.slice(0, 90))}</small>` : ''}</span><button class="sj-st" data-tri="${esc(t.id)}">${t.resolved ? 'вернуть' : 'решён'}</button><button class="sj-st" data-tridel="${esc(t.id)}" aria-label="Убрать">✕</button></div>`).join('');
    return `<div class="sj-sec"><h3>Треугольники</h3></div>${list || '<div class="sj-none">Нет.</div>'}
      <div class="sj-add"><select id="sj-t-c" aria-label="Центр">${optsAt(0)}</select><select id="sj-t-a" aria-label="Первый">${optsAt(1)}</select><select id="sj-t-b" aria-label="Второй">${optsAt(2)}</select><button class="sj-btn" data-act="addtri">+</button></div>
      <div class="sj-sub">Центр, и двое, между кем он выбирает. Уходит рассказчику, когда в кадре двое из трёх.</div>`;
  }

  function pageHtml(info) {
    const person = info.people.find(p => p.id === selected);
    if (!person) return '<div class="sj-empty">Выберите человека слева.</div>';
    const lines = info.relations.lines.filter(l => (dir === 'out' ? l.from : l.to) === person.id);
    const have = new Set(lines.map(l => (dir === 'out' ? l.to : l.from)));
    const options = info.people.filter(p => p.id !== person.id && !have.has(p.id)).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    const note = '';
    return `<div class="sj-qh"><h2>${esc(person.name)}</h2><div class="acts">${person.persona ? '<span class="sj-sub">Что чувствуют к вам</span>' : `<button class="sj-tab" data-dir="out" aria-pressed="${dir === 'out'}">Что чувствует</button><button class="sj-tab" data-dir="in" aria-pressed="${dir === 'in'}">Что чувствуют к нему</button>`}</div></div>${note}
      <div style="margin-top:10px">${lines.map(l => lineHtml(info, l)).join('') || '<div class="sj-none">Линий нет.</div>'}</div>
      ${options ? `<div class="sj-add"><select id="sj-newline" aria-label="Новая линия">${options}</select><button class="sj-btn sj-pri" data-act="addline">${dir === 'out' ? 'Добавить: что чувствует' : 'Добавить: что к нему чувствует'}</button></div>` : ''}
      ${headcanonsHtml(info, person)}${trianglesHtml(info)}${logHtml(info)}
      <div class="sj-tell"><div class="sj-lbl">${settings.enabled && settings.sendRelations ? 'Уйдёт рассказчику' : 'Не отправляется (выключено в настройках)'}</div>${info.relationLines.length ? `<pre>${esc(info.relationLines.join('\n'))}</pre>` : '<div class="sj-sub">Сейчас ничего: нужны линии между теми, кто в кадре.</div>'}</div>`;
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    shell.theme(info.state.calendar);
    if (!info.people.some(p => p.id === selected)) selected = (info.people.find(p => p.present && !p.persona) ?? info.people[0])?.id ?? '';
    const isPersona = Boolean(info.people.find(p => p.id === selected)?.persona);
    if (isPersona) dir = 'in'; else if (wasPersona) dir = 'out';
    wasPersona = isPersona;
    win.innerHTML = `<div class="sj-wh"><h2>Отношения</h2><span class="sj-sub">чувства, стадии, воспоминания</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="sj-jbody"><div class="sj-jside">${sideHtml(info)}</div><div class="sj-jpage">${pageHtml(info)}</div></div>`;
  }

  const q = sel => win.querySelector(sel);
  const onClick = event => {
    const t = event.target;
    const person = t.closest('[data-person]'); if (person) { selected = person.dataset.person; open = ''; return render(); }
    const d = t.closest('[data-dir]'); if (d) { dir = d.dataset.dir; open = ''; return render(); }
    const head = t.closest('[data-line]'); if (head && !t.closest('.sj-led')) { open = open === head.dataset.line ? '' : head.dataset.line; return render(); }
    const drop = t.closest('[data-dropscale]'); if (drop) { const lid = t.closest('[data-lid]').dataset.lid; extra.get(lid)?.delete(drop.dataset.dropscale); scene().setScale(lid, drop.dataset.dropscale, 0); render(); return; }
    const hide = t.closest('[data-hide]'); if (hide) { scene().toggleScaleHidden(t.closest('[data-lid]').dataset.lid, hide.dataset.hide); return; }
    const rec = t.closest('[data-rec]'); if (rec) { scene().toggleRecord(open, rec.dataset.kind, rec.dataset.id, rec.dataset.rec); return; }
    const recDel = t.closest('[data-recdel]'); if (recDel) { scene().removeRecord(open, recDel.dataset.kind, recDel.dataset.id); return; }
    const df = t.closest('[data-delfactor]'); if (df) { scene().removeFactor(open, df.dataset.delfactor); return; }
    const undo = t.closest('[data-undo]'); if (undo) { scene().revertLog(undo.dataset.undo); return; }
    const hc = t.closest('[data-hc]'); if (hc) { scene().toggleHeadcanon(hc.dataset.hc); return; }
    const hcDel = t.closest('[data-hcdel]'); if (hcDel) { scene().removeHeadcanon(hcDel.dataset.hcdel); return; }
    const tri = t.closest('[data-tri]'); if (tri) { scene().toggleTriangle(tri.dataset.tri); return; }
    const triDel = t.closest('[data-tridel]'); if (triDel) { scene().removeTriangle(triDel.dataset.tridel); return; }
    const act = t.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') return shell.close();
    if (act === 'addscale') { const card = t.closest('[data-lid]'); const sel = card.querySelector('[data-addscale]'); const lid = card.dataset.lid; if (sel?.value) { if (!extra.has(lid)) extra.set(lid, new Set()); extra.get(lid).add(sel.value); render(); } return; }
    if (act === 'addline') { const other = q('#sj-newline').value; const id = dir === 'out' ? scene().addLine(selected, other) : scene().addLine(other, selected); if (id) { open = id; render(); } return; }
    if (act === 'delline') { if (window.confirm('Удалить эту линию вместе со шкалами и записями?')) { scene().removeLine(open); open = ''; } return; }
    if (act === 'addrec') {
      const box = t.closest('.sj-add').querySelector('[data-newrec]');
      const level = t.closest('.sj-add').querySelector('[data-newint]').value;
      if (!scene().addRecord(open, t.dataset.kind, box.value, level)) box.classList.add('sj-bad');
      return;
    }
    if (act === 'addfactor') { const box = q('[data-ftext]'); if (!scene().addFactor(open, q('[data-fscale]').value, q('[data-fdir]').value, box.value)) box.classList.add('sj-bad'); return; }
    if (act === 'addperson') { const box = q('#sj-newperson'); const id = scene().addPerson(box.value); if (id) selected = id; else box.classList.add('sj-bad'); return; }
    if (act === 'addhc') { const box = q('#sj-hc-text'); if (!scene().addHeadcanon(selected, q('#sj-hc-who').value, box.value)) box.classList.add('sj-bad'); return; }
    if (act === 'addtri') { if (!scene().addTriangle(q('#sj-t-c').value, q('#sj-t-a').value, q('#sj-t-b').value)) q('#sj-t-b').classList.add('sj-bad'); return; }
    if (act === 'import') {
      const r = scene().importRelationsFromKulisy();
      importNote = r.ok ? `Перенесено линий: ${r.lines}${r.skipped ? `, уже были: ${r.skipped}` : ''}; хедканонов: ${r.headcanons}. С участниками сцены сопоставлено людей: ${r.mapped}.` : 'Кулисы не найдены.';
      render();
    }
  };
  const onInput = event => { const el = event.target; if (el.dataset.scale) { const out = el.closest('.sj-sc')?.querySelector('output'); if (out) out.textContent = sign(Number(el.value)); } };
  const onChange = event => {
    const el = event.target;
    if (el.dataset.scale) scene().setScale(el.closest('[data-lid]').dataset.lid, el.dataset.scale, el.value);
    else if (el.dataset.stage !== undefined) scene().setStage(open, el.value);
    else if (el.dataset.goal !== undefined) scene().setGoal(open, el.value);
  };
  const onKey = event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const el = event.target;
    if (el.dataset?.newrec) { event.preventDefault(); el.closest('.sj-add').querySelector('[data-act="addrec"]').click(); }
    else if (el.dataset?.ftext !== undefined) { event.preventDefault(); q('[data-act="addfactor"]').click(); }
    else if (el.id === 'sj-hc-text') { event.preventDefault(); q('[data-act="addhc"]').click(); }
    else if (el.id === 'sj-newperson') { event.preventDefault(); q('[data-act="addperson"]').click(); }
    else if (el.dataset?.stage !== undefined) el.blur();
  };
  win.addEventListener('click', onClick);
  win.addEventListener('input', onInput);
  win.addEventListener('change', onChange);
  win.addEventListener('keydown', onKey);

  const unsubscribe = scene()?.subscribe(info => {
    if (!shell.isOpen) return;
    if (!info?.hasChat) return shell.close();
    if (win.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    render();
  });

  function openWindow() {
    const info = scene()?.get();
    if (!info?.hasChat) return;
    open = ''; importNote = ''; extra.clear();
    try { scene().syncMainPeople?.(); } catch { /* список основных не подтянулся, окно открывается и так */ }
    shell.show(info.state.calendar);
    render();
    win.focus();
  }

  shared.ui = { ...(shared.ui ?? {}), openRelations: openWindow, closeRelations: shell.close };
  return () => {
    unsubscribe?.();
    win.removeEventListener('click', onClick);
    win.removeEventListener('input', onInput);
    win.removeEventListener('change', onChange);
    win.removeEventListener('keydown', onKey);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openRelations; delete shared.ui.closeRelations; }
  };
}
