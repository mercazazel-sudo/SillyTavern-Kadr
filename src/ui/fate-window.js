/**
 * Окно «d20 жизни»: режим сцены (Путь, Остановка, Лагерь, Бой, Близость), кнопки «Привал / Лагерь / В путь»
 * (одноразовая подсказка: компаньоны сами предлагают), случайное событие, проверка d20 и близость (накал из пяти зон и свои записи).
 * Одноразовое уходит рассказчику с ближайшим ответом. Читает shared.scene.get(), правки идут через сервис.
 */
import { esc } from './dom.js';
import { D20_SVG } from './d20-icon.js';
import { createShell } from './shell.js';
import { MODE_SETS, SET_IDS, modesOf, NUDGES, HEAT, HEAT_IDS, HEAT_NUDGES, HEAT_ACTS, HEAT_NOTE_RU, CHECK_MODE_RU, OUTCOME_RU } from '../core/fate.js';
import { ZONES } from '../core/body.js';

export function startFateWindow(deps) {
  const { shared, settings } = deps;
  const scene = () => shared.scene;
  const shell = createShell({ id: 'sj-fate', label: 'd20 жизни', width: 940 });
  const { win } = shell;
  let showIntimacy = false;
  let showMore = false;           // стрелочка «Ещё» у видов близости раскрыта (помнится между перерисовками)
  let woundNote = '';

  const stateLabel = (sent, pending) => (sent ? 'уже ушло с ответом' : pending ? 'уйдёт рассказчику с ближайшим ответом' : '');

  function modeHtml(info) {
    const f = info.fate;
    const set = MODE_SETS[f.set] ?? MODE_SETS.adventure;
    return `<div class="sj-lbl">Набор режимов</div>
      <div class="sj-add" style="margin:0 0 8px" role="group" aria-label="Набор режимов">${SET_IDS.map(id => `<button class="sj-chip${f.set === id ? ' on' : ''}" data-modeset="${id}" aria-pressed="${f.set === id}">${esc(MODE_SETS[id].ru)}</button>`).join('')}</div>
      <div class="sj-lbl">Режим сцены</div>
      <div class="sj-modes">${modesOf(f.set).map(m => `<button class="sj-mode${f.mode === m.id ? ' on' : ''}" data-mode="${m.id}" aria-pressed="${f.mode === m.id}" title="${esc(m.hint)}"><span aria-hidden="true">${m.icon}</span> ${esc(m.ru)}</button>`).join('')}</div>
      <div class="sj-sub" style="margin:6px 0">Режим держится, пока вы его не смените; рассказчик подстраивает под него темп и детали.</div>
      <div class="sj-lbl" style="margin-top:12px">Предложить рассказчику</div>
      <div class="sj-add" style="margin:0">${set.nudges.map(k => `<button class="sj-btn" data-nudge="${k}" title="${esc(NUDGES[k].mode ? 'Одноразово и включает режим' : 'Одноразово: подсказка рассказчику')}">${esc(NUDGES[k].ru)}</button>`).join('')}</div>
      <div class="sj-sub" style="margin-top:4px">Это подсказка, что персонажи сами тянут сцену туда. Персону не принуждают: она может отказаться.</div>`;
  }

  function eventHtml(info) {
    const e = info.fate.event;
    let body = '<div class="sj-none">События нет.</div>';
    if (e) {
      const harm = e.harm && e.target
        ? `<div class="sj-harm"><span>Может задеть: <b>${esc(e.target.name)}</b> (${esc(e.harm.t)}, ${esc(ZONES[e.harm.zone]?.ru ?? e.harm.zone)}, тяжесть ${e.harm.sev}).</span>${e.harm.done ? ' <i>Записано в «Состояние».</i>' : '<button class="sj-btn sj-pri" data-act="harm">Записать рану?</button>'}</div>` : '';
      body = `<div class="sj-ev"><div class="t">${esc(e.label)}</div><div class="sj-sub">${stateLabel(e.sent, true)}</div>${harm}${woundNote ? `<div class="sj-sub">${esc(woundNote)}</div>` : ''}<button class="sj-btn" data-act="evclear" style="margin-top:6px">Убрать</button></div>`;
    }
    const mode = modesOf(info.fate.set).find(m => m.id === info.fate.mode);
    return `<div class="sj-lbl" style="margin-top:16px">Случайное событие</div>
      <div class="sj-add" style="margin:0 0 8px"><button class="sj-btn sj-pri" data-act="roll">${D20_SVG} Случайное событие</button></div>
      <div class="sj-sub" style="margin-bottom:6px">Таблица: ${mode ? esc(mode.ru) : 'общая'}. Напряжение сейчас: ${esc(info.tension?.ru ?? 'не отслеживается')}; чем выше, тем чаще опасность. Событие уйдёт рассказчику одним предложением и не повторится.</div>${body}`;
  }

  function checkHtml(info) {
    const c = info.fate.check;
    const hint = c => (c.kind === 'skill' ? `Меньше ${c.dc}: не вышло. Не меньше: удалось. Выпала 1: провал, 20: блестяще.` : `Меньше ${c.dc}: ранят. Не меньше: увернулись. Выпала 1: тяжёлая рана.`);
    const kindRu = c => (c.kind === 'skill' ? 'действие' : 'уворот');
    const state = !c ? '<div class="sj-none">Проверки нет. Рассказчик назначит её сам, когда исход зависит от удачи (уворот, обман, скрытность и другое), или назначьте вручную. В интимной сцене проверки не назначаются.</div>'
      : c.roll ? `<div class="sj-ev"><div class="t">${esc(c.label)} (${kindRu(c)}): сложность ${c.dc}, ${esc(CHECK_MODE_RU[c.mode])}</div><div class="sj-sub">Выпало ${c.roll.roll}${c.roll.dice.length > 1 ? ` (кости ${c.roll.dice.join(' и ')})` : ''}: <b>${esc(OUTCOME_RU[c.roll.outcome])}</b>. Результат уйдёт рассказчику с ближайшим ответом.</div><button class="sj-btn" data-act="chkclear" style="margin-top:6px">Убрать</button></div>`
        : `<div class="sj-ev"><div class="t">${esc(c.label)} (${kindRu(c)}): сложность ${c.dc}, ${esc(CHECK_MODE_RU[c.mode])}</div><div class="sj-sub">${hint(c)}</div><div class="sj-add" style="margin:8px 0 0"><button class="sj-btn sj-pri" data-act="chkroll">${D20_SVG} Бросить куб</button><button class="sj-btn" data-act="chkclear">Убрать</button></div></div>`;
    return `<div class="sj-lbl" style="margin-top:16px">Проверка d20 для персоны</div>${state}
      <div class="sj-add"><input data-chklabel placeholder="что проверяем: удар клинка, обман стражника, скрытность…" aria-label="Что"><select data-chkkind aria-label="Вид" style="width:auto"><option value="dodge">уворот (при провале рана)</option><option value="skill">действие (обман, скрытность…)</option></select><input data-chkdc type="number" min="1" max="20" value="12" aria-label="Сложность" style="width:70px"><select data-chkmode aria-label="Режим" style="width:auto">${['normal', 'advantage', 'disadvantage'].map(m => `<option value="${m}">${esc(CHECK_MODE_RU[m])}</option>`).join('')}</select><button class="sj-btn" data-act="chkassign">Назначить</button></div>`;
  }

  const actChip = a => `<button class="sj-chip${(heatNow?.acts ?? []).includes(a.id) ? ' on' : ''}" data-hact="${a.id}" title="${esc(a.hint)}" aria-pressed="${(heatNow?.acts ?? []).includes(a.id)}">${esc(a.ru)}</button>`;
  let heatNow = null;

  function intimacyHtml(info) {
    const f = info.fate;
    const h = f.heat;
    heatNow = h;
    if (!h && f.mode !== 'intimacy' && !showIntimacy) return '<div class="sj-lbl" style="margin-top:16px">Интим</div><button class="sj-btn" data-act="heatstart">Начать сцену: накал</button>';
    const at = HEAT_IDS.indexOf(h?.zone);
    const dial = `<div class="sj-dial" aria-hidden="true"><i style="left:calc(${(Math.max(at, 0) + 0.5) * 20}% - 3px)"></i></div>
      <div class="sj-zones">${HEAT.map((z, i) => `<button class="sj-zone${i === at ? ' on' : ''}" data-heat="${z.id}" title="${esc(z.hint)}"><b>${esc(z.ru)}</b><small>${esc(z.hint)}</small></button>`).join('')}</div>`;
    const npcs = info.cast.filter(p => p.present && !p.persona && !info.knowledge.deaths[p.id]);
    const leads = [{ id: 'story', ru: 'по ходу истории' }, ...npcs.map(n => ({ id: n.id, ru: n.name })), { id: 'turns', ru: 'по очереди' }];
    const notes = (h?.notes ?? []).map(n => `<div class="sj-hn${n.on ? '' : ' off'}"><span>${esc(n.text)}</span><span class="k ${n.kind}">${esc(HEAT_NOTE_RU[n.kind])}</span><button class="sj-st" data-hnote="${esc(n.id)}">${n.on ? 'выкл.' : 'вкл.'}</button><button class="sj-st" data-hnotedel="${esc(n.id)}" aria-label="Убрать">✕</button></div>`).join('');
    return `<div class="sj-lbl" style="margin-top:16px">Интим: накал сцены</div>
      ${dial}
      <div class="sj-add" style="margin-top:10px"><button class="sj-btn" data-act="heatdown">Ниже</button><button class="sj-btn sj-pri" data-act="heatup">Выше</button><button class="sj-btn" data-act="heatcalm">Покой</button><button class="sj-btn" data-act="heatend">Закончить сцену</button></div>
      <div class="sj-sub" style="margin:6px 0">Накал двигаете вы. Рассказчик подстраивает темп и подробности под зону и сам вверх не перескакивает. В интимной сцене d20 не бросается.</div>
      <div class="sj-lbl" style="margin-top:12px">Вид близости</div>
      <div class="sj-add" style="margin:0">${HEAT_ACTS.filter(a => !a.more).map(actChip).join('')}</div>
      <details class="sj-more" data-more${showMore || HEAT_ACTS.some(a => a.more && (h?.acts ?? []).includes(a.id)) ? ' open' : ''}><summary>Ещё</summary><div class="sj-add" style="margin:6px 0 0">${HEAT_ACTS.filter(a => a.more).map(actChip).join('')}</div></details>
      <div class="sj-sub" style="margin:2px 0 0">Можно выбрать несколько. Рассказчик пишет только выбранное и не выходит за зону накала. Свой вариант добавьте записью ниже.</div>
      <div class="sj-lbl" style="margin-top:12px">Кто ведёт</div>
      <div class="sj-add" style="margin:0">${leads.map(l => `<button class="sj-chip${(h?.lead ?? 'story') === l.id ? ' on' : ''}" data-lead="${esc(l.id)}">${esc(l.ru)}</button>`).join('')}</div>
      <div class="sj-lbl" style="margin-top:12px">Подсказка на ход</div>
      <div class="sj-add" style="margin:0">${HEAT_NUDGES.map(n => `<button class="sj-chip${h?.nudge === n.id ? ' on' : ''}" data-hnudge="${n.id}" title="Одноразово: уйдёт с ближайшим ответом">${esc(n.ru)}</button>`).join('')}</div>
      <div class="sj-lbl" style="margin-top:12px">Своя запись</div>
      <div class="sj-add"><input data-hnotetext placeholder="Что учесть: привычка, желание, граница" aria-label="Запись"><select data-hnotekind aria-label="Как долго" style="width:auto"><option value="scene">на всю сцену</option><option value="once">на один ход</option><option value="limit">граница</option></select><button class="sj-btn sj-pri" data-act="hnoteadd">Добавить</button></div>
      <div class="sj-hnotes">${notes || '<div class="sj-none">Записей нет.</div>'}</div>
      <div class="sj-sub" style="margin-top:4px">«На всю сцену» остаётся, пока вы не уберёте. «На один ход» уходит рассказчику один раз. «Граница» уходит всегда, пока включена.</div>`;
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    shell.theme(info.state.calendar);
    const tell = `<div class="sj-tell"><div class="sj-lbl">${settings.enabled && settings.sendFate ? 'Уйдёт рассказчику' : 'Не отправляется (выключено в настройках)'}</div>${info.fateLines.length ? `<pre>${info.fateLines.map(esc).join('\n')}</pre>` : '<div class="sj-sub">Сейчас ничего.</div>'}</div>`;
    const diceOn = settings.fate?.diceCheck !== false;
    win.innerHTML = `<div class="sj-wh"><h2>d20 жизни</h2><span class="sj-sub">режим, события, броски, интим</span><label class="sj-chk sj-tgl sj-fatetgl" title="Рассказчик сам просит бросок d20 (уворот, обман, скрытность), когда исход зависит от удачи. В интимной сцене проверки не бросаются в любом случае."><input type="checkbox" role="switch" data-dicecheck ${diceOn ? 'checked' : ''}><i aria-hidden="true"></i><span>Случайные проверки d20<small>${diceOn ? 'рассказчик просит бросок сам' : 'выключены'}</small></span></label><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div style="padding:12px 18px 16px">${modeHtml(info)}${eventHtml(info)}${info.fate.mode === 'intimacy' || info.fate.heat ? '<div class="sj-sub" style="margin-top:14px">В интимной сцене d20 не бросается.</div>' : checkHtml(info)}${intimacyHtml(info)}${tell}</div>`;
  }

  const onClick = event => {
    const t = event.target;
    const mode = t.closest('[data-mode]'); if (mode) { const cur = scene().get().fate.mode; scene().setMode(cur === mode.dataset.mode ? '' : mode.dataset.mode); return; }
    const modeSet = t.closest('[data-modeset]'); if (modeSet) { scene().setModeSet(modeSet.dataset.modeset); return; }
    const nudge = t.closest('[data-nudge]'); if (nudge) { scene().pressNudge(nudge.dataset.nudge); return; }
    const zone = t.closest('[data-heat]'); if (zone) { scene().setHeat({ zone: zone.dataset.heat }); return; }
    const heatAct = t.closest('[data-hact]'); if (heatAct) { scene().setHeat({ act: heatAct.dataset.hact }); return; }
    const lead = t.closest('[data-lead]'); if (lead) { scene().setHeat({ lead: lead.dataset.lead }); return; }
    const hn = t.closest('[data-hnudge]'); if (hn) { const cur = scene().get().fate.heat?.nudge; scene().setHeat({ nudge: cur === hn.dataset.hnudge ? '' : hn.dataset.hnudge }); return; }
    const note = t.closest('[data-hnote]'); if (note) { scene().toggleHeatNote(note.dataset.hnote); return; }
    const noteDel = t.closest('[data-hnotedel]'); if (noteDel) { scene().removeHeatNote(noteDel.dataset.hnotedel); return; }
    const act = t.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') return shell.close();
    if (act === 'roll') { woundNote = ''; scene().rollFate(); return; }
    if (act === 'chkroll') { scene().rollCheck(); return; }
    if (act === 'chkclear') { scene().clearCheck(); return; }
    if (act === 'chkassign') { const g = sel => win.querySelector(sel); scene().assignCheck({ label: g('[data-chklabel]').value, dc: g('[data-chkdc]').value, mode: g('[data-chkmode]').value, kind: g('[data-chkkind]').value }); return; }
    if (act === 'evclear') { scene().clearEvent(); return; }
    if (act === 'harm') { woundNote = scene().applyHarm() ? '' : 'Не вышло записать рану.'; render(); return; }
    if (act === 'heatstart') { showIntimacy = true; scene().setHeat({ zone: 'warm' }); return; }
    if (act === 'heatup') { scene().setHeat({ delta: 1 }); return; }
    if (act === 'heatdown') { scene().setHeat({ delta: -1 }); return; }
    if (act === 'heatcalm') { scene().setHeat({ zone: 'calm' }); return; }
    if (act === 'heatend') { showIntimacy = false; scene().endIntimacy(); return; }
    if (act === 'hnoteadd') {
      const box = win.querySelector('[data-hnotetext]');
      const kind = win.querySelector('[data-hnotekind]').value;
      if (box.value.trim()) { scene().addHeatNote(box.value, kind); box.value = ''; } else box.classList.add('sj-bad');
    }
  };
  const onKey = event => { if (event.key === 'Enter' && event.target?.dataset?.hnotetext !== undefined) { event.preventDefault(); win.querySelector('[data-act="hnoteadd"]')?.click(); } };
  const onToggle = event => { if (event.target?.matches?.('[data-more]')) showMore = event.target.open; };
  win.addEventListener('toggle', onToggle, true);
  const onChange = event => {
    const el = event.target;
    if (el.dataset?.dicecheck === undefined) return;
    const fate = { ...(settings.fate ?? {}), diceCheck: el.checked };
    scene().setSetting('fate', fate);                                  // сохраняет и пересобирает блок рассказчику
    if (!el.checked) scene().clearCheck();                              // выключили: ожидающая проверка снимается
  };
  win.addEventListener('change', onChange);
  win.addEventListener('click', onClick);
  win.addEventListener('keydown', onKey);
  const unsubscribe = scene()?.subscribe(info => {
    if (!shell.isOpen) return;
    if (!info?.hasChat) return shell.close();
    if (win.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    render();
  });

  function open() {
    const info = scene()?.get();
    if (!info?.hasChat) return;
    woundNote = ''; showIntimacy = false;
    shell.show(info.state.calendar);
    render();
    win.focus();
  }
  shared.ui = { ...(shared.ui ?? {}), openFate: open, closeFate: shell.close };
  return () => {
    unsubscribe?.();
    win.removeEventListener('toggle', onToggle, true);
    win.removeEventListener('change', onChange);
    win.removeEventListener('click', onClick);
    win.removeEventListener('keydown', onKey);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openFate; delete shared.ui.closeFate; }
  };
}
