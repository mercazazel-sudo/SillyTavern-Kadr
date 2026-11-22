/**
 * Окно «Календарь»: сетка месяца выбранного мира (у каждой системы своя неделя, праздничные дни, слои праздников),
 * лента года, выбор дня и кнопка «сделать сегодняшним». Читает shared.scene.get().
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { CALENDARS, ORDER, locate, weekdayOf, holidaysOf, moonHolidays, layerCounts, yearLength } from '../core/calendars.js';
import { dayNumber, formatTime, partOfDay } from '../core/clock.js';
import { moonsOf, moonPhase, moonSvg, moonHolidaysOn, PHASE_HOLIDAY_RU } from '../core/moon.js';

export function startCalendarWindow(deps) {
  const { shared, settings } = deps;
  let holOpen = true;              // блок «Праздники месяца» развёрнут; выбор помнится между перерисовками
  let editingNote = '';            // ключ праздника, чьё описание сейчас правят
  const scene = () => shared.scene;
  const shell = createShell({ id: 'sj-calendar', label: 'Календарь', width: 1020 });
  const { win } = shell;
  let view = { year: 0, index: 0 };   // что листаем
  let sel = null;                      // выбранный день { year, doy }

  const layerColor = (cal, id) => (cal.layers ?? []).find(l => l.id === id)?.color ?? cal.accent;
  const startDoy = (cal, year, index) => cal.periods(year).slice(0, index).reduce((s, p) => s + p.days, 0) + 1;

  function cellHtml(info, p, index, day) {
    const cal = info.calendar, doy = startDoy(cal, view.year, index) + day - 1;
    const all = holidaysOf(p, info.layers);
    const lunar = moonHolidaysOn(info.state.calendar, info.layers, view.year, doy, day, p);   // «по луне» с фазой, выпавшие на этот день
    const starts = [...all.filter(h => h.d === day), ...lunar];
    const inRange = all.filter(h => h.to && day > h.d && day <= h.to);
    const touching = [...starts, ...inRange];
    const colors = [...new Set(touching.map(h => layerColor(cal, h.layer)))].slice(0, 3);
    const isToday = info.time.year === view.year && info.time.doy === doy;
    const isSel = sel && sel.year === view.year && sel.doy === doy;
    const first = starts[0];
    const bar = inRange.length ? `<i class="sj-rng" style="background:${layerColor(cal, inRange[0].layer)}"></i>` : '';
    return `<button class="sj-cell${isToday ? ' today' : ''}${isSel ? ' sel' : ''}" data-doy="${doy}" title="${esc(touching.map(h => `${h.ru} (${h.en})`).join('; '))}">
      <span class="n">${day}</span>${colors.length ? `<span class="sj-dots">${colors.map(c => `<i style="background:${c}"></i>`).join('')}</span>` : ''}
      ${first ? `<span class="hn" style="color:${layerColor(cal, first.layer)}">${esc(first.ru)}${starts.length > 1 ? ` +${starts.length - 1}` : ''}</span>` : ''}${bar}</button>`;
  }

  function gridHtml(info, p, index) {
    const cal = info.calendar, len = cal.week.len;
    if (p.type === 'festival' && cal.week.mode === 'tenday') {
      const doy = startDoy(cal, view.year, index);
      const isToday = info.time.year === view.year && info.time.doy === doy;
      return `<div class="sj-fest"><div class="big">${esc(p.ru)}</div><div class="note">${esc(p.note ?? '')}</div>
        <div class="note">Праздничный день стоит вне декад и вне месяцев${index > 0 ? `, идёт сразу за месяцем «${esc(cal.periods(view.year)[index - 1].ru)}»` : ''}</div>
        <button class="sj-cell${isToday ? ' today' : ''}${sel && sel.doy === doy && sel.year === view.year ? ' sel' : ''}" data-doy="${doy}" style="min-height:0;margin-top:10px">${isToday ? 'сегодня' : 'выбрать этот день'}</button></div>`;
    }
    const head = cal.week.mode === 'tenday'
      ? Array.from({ length: len }, (_, i) => `<div class="sj-dow">${i + 1}</div>`).join('')
      : cal.week.names.map(n => `<div class="sj-dow">${esc(n.ru)}<small>${esc(n.en)}</small></div>`).join('');
    const lead = cal.week.mode === 'tenday' ? 0 : weekdayOf(cal, view.year, startDoy(cal, view.year, index)) % len;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="sj-cell blank"></div>';
    for (let d = 1; d <= p.days; d++) cells += cellHtml(info, p, index, d);
    return `<div class="sj-cgrid" style="grid-template-columns:repeat(${len},1fr)">${head}${cells}</div>`;
  }

  /** Лунная полоса под сеткой: фаза каждой луны мира на каждый день показанного месяца (идёт вместе с календарём). */
  function moonHtml(info, p, index) {
    const id = info.state.calendar, moons = moonsOf(id, p);
    if (!moons.length) return '';
    const first = startDoy(info.calendar, view.year, index);
    const rows = moons.map(moon => {
      const cells = Array.from({ length: p.days }, (_, i) => {
        const day = i + 1, doy = first + i, ph = moonPhase(id, moon, view.year, doy, day);
        const isToday = info.time.year === view.year && info.time.doy === doy, isSel = sel && sel.year === view.year && sel.doy === doy;
        const note = ph.event === 'full' ? ' · самая светлая ночь' : ph.event === 'new' ? ' · самая тёмная ночь' : '';
        return `<button class="sj-mn${ph.event ? ` ev-${ph.event}` : ''}${isToday ? ' today' : ''}${isSel ? ' sel' : ''}" data-doy="${doy}" title="${day}: ${esc(ph.phase.ru)}${note}">${moonSvg(ph.f, 22, ph.event)}<i>${day}</i></button>`;
      }).join('');
      return `<div class="sj-moonrow"><div class="sj-moonlb">${esc(moon.ru)}<small>цикл ${String(+moon.cycle.toFixed(1)).replace('.', ',')} дн.</small></div><div class="sj-moons">${cells}</div></div>`;
    }).join('');
    return `<div class="sj-moonband"><h4>${moons.length > 1 ? 'Луны' : 'Луна'} <small>${esc(moons[0].note ?? 'условно: длина цикла и точка отсчёта не из канона')}</small></h4>${rows}<div class="sj-sub">Рамка и свечение — полнолуние, пунктир — новолуние. Фазы идут вместе с календарём сами.</div></div>`;
  }

  const noteKey = (info, h) => `${info.state.calendar}|${h.ru}`;
  const ownNote = (info, h) => String(settings.holidayNotes?.[noteKey(info, h)] ?? '').trim();

  /** Карточка праздника месяца: число, название, слой, описание и «Подробнее» (слой, источник, когда, своё описание). */
  function holidayCard(info, h, p) {
    const cal = info.calendar;
    const layer = (cal.layers ?? []).find(l => l.id === h.layer);
    const color = layerColor(cal, h.layer);
    const key = noteKey(info, h), own = ownNote(info, h);
    const when = h.moon || h.phase
      ? `${h.phase ? `каждое ${PHASE_HOLIDAY_RU[h.phase]}` : 'по луне'}${h.dText ? `: в этом месяце ${h.dText}` : ''}`
      : (h.to ? `с ${h.d} по ${h.to} ${p.ru}` : `${h.d} ${p.ru}`);
    const badge = h.moon && !h.dText ? '☾' : (h.dText ?? `${h.d}${h.to ? '–' + h.to : ''}`);
    const text = own || h.note || '';
    const chips = `<span class="sj-hchip" style="--lc:${color}">${esc(layer?.ru ?? 'праздник')}</span>${h.phase ? `<span class="sj-hchip moon">${esc(PHASE_HOLIDAY_RU[h.phase])}</span>` : ''}${h.weak ? '<span class="sj-hchip weak" title="Дата найдена в единственном источнике">один источник</span>' : ''}`;
    const editor = editingNote === key
      ? `<div class="sj-hedit"><textarea data-hnote rows="3" placeholder="Что это за праздник, как его отмечают">${esc(own)}</textarea><div class="sj-hbtns"><button class="sj-btn sj-pri" type="button" data-hsave="${esc(key)}">Сохранить</button><button class="sj-btn" type="button" data-hcancel>Отмена</button>${own ? `<button class="sj-btn" type="button" data-hclear="${esc(key)}">Убрать своё</button>` : ''}</div></div>`
      : `<button class="sj-st" type="button" data-hedit="${esc(key)}">${own ? 'Править своё описание' : 'Добавить своё описание'}</button>`;
    return `<article class="sj-hc" style="--lc:${color}"><div class="sj-hd" title="${esc(when)}">${esc(badge)}</div><div class="sj-hb">
        <h5>${esc(h.ru)}${h.en ? ` <span class="en">${esc(h.en)}</span>` : ''}</h5>
        <div class="sj-hm">${chips}</div>
        ${text ? `<p>${esc(text)}</p>` : '<p class="none">В источнике описания нет, остались название и дата.</p>'}
        <details class="sj-hmore"><summary>Подробнее</summary><dl>
          <dt>Когда</dt><dd>${esc(when)}</dd>
          ${layer ? `<dt>Слой</dt><dd>${esc(layer.ru)}${layer.note ? `: ${esc(layer.note)}` : ''}</dd>` : ''}
          ${h.note && own ? `<dt>Из справки</dt><dd>${esc(h.note)}</dd>` : ''}
          ${layer?.src ? `<dt>Источник</dt><dd>${esc(layer.src)}</dd>` : ''}
          ${h.weak ? '<dt>Внимание</dt><dd>Дата взята из единственного источника: сверьте с вашей кампанией.</dd>' : ''}
        </dl>${editor}</details></div></article>`;
  }

  /** Праздники месяца под лунной полосой: карточки, по слоям видно цветом. */
  function holidaysHtml(info, list, p) {
    if (!list.length) return '';
    return `<details class="sj-hol" data-holbox${holOpen ? ' open' : ''}><summary><h4>Праздники месяца <small>${list.length}</small></h4></summary><div class="sj-hgrid">${list.map(h => holidayCard(info, h, p)).join('')}</div></details>`;
  }

  function lineHtml(info, list, withDay = true) {
    const cal = info.calendar;
    return list.map(h => `<li class="sj-hl"><span class="dot" style="background:${layerColor(cal, h.layer)}"></span><span>${!h.moon && withDay ? `<b>${h.dText ?? `${h.d}${h.to ? '–' + h.to : ''}`}</b> ` : ''}${esc(h.ru)}${h.weak ? ' <em class="weak">один источник</em>' : ''}<br><small>${esc(h.en)}${h.phase ? ` · ${PHASE_HOLIDAY_RU[h.phase]}` : ''}</small>${h.note ? `<br><span class="nt">${esc(h.note)}</span>` : ''}</span></li>`).join('');
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    const cal = info.calendar;
    shell.theme(info.state.calendar);
    if (!view.year || !cal.periods(view.year)[view.index]) { const loc = locate(cal, info.time.year, info.time.doy); view = { year: info.time.year, index: loc?.index ?? 0 }; }
    if (!sel) sel = { year: info.time.year, doy: info.time.doy };
    const periods = cal.periods(view.year);
    const p = periods[Math.min(view.index, periods.length - 1)];
    const total = yearLength(cal, view.year);
    const season = p.type === 'month' ? (p.seasonFn ? p.seasonFn(p, 1) : p.season) : p.season;
    const lunarDays = new Map();      // праздники «по луне»: в какие дни этого периода выпадают
    for (let d = 1; d <= p.days; d++) for (const h of moonHolidaysOn(info.state.calendar, info.layers, view.year, startDoy(cal, view.year, view.index) + d - 1, d, p)) { if (!lunarDays.has(h.ru)) lunarDays.set(h.ru, { ...h, days: [] }); lunarDays.get(h.ru).days.push(d); }
    const lunarList = [...lunarDays.values()].map(h => ({ ...h, d: h.days[0], dText: h.days.join(', ') }));
    const monthHol = p.type === 'month' ? [...holidaysOf(p, info.layers), ...lunarList].sort((a, b) => a.d - b.d) : [];
    const moons = p.type === 'month' ? moonHolidays(cal, info.layers).filter(h => !h.phase) : [];      // без фазы остаются списком без даты
    const counts = layerCounts(cal, view.year);

    // выбранный день: подпись, день истории, праздники
    const selLoc = locate(cal, sel.year, sel.doy);
    const selHol = selLoc ? [...holidaysOf(selLoc.period, info.layers).filter(h => !h.moon && h.d <= selLoc.day && selLoc.day <= (h.to ?? h.d)), ...moonHolidaysOn(info.state.calendar, info.layers, sel.year, sel.doy, selLoc.day, selLoc.period)] : [];
    const selDay = dayNumber(info.state.calendar, info.state.dayOne, sel);
    const selName = selLoc ? (selLoc.period.type === 'festival' ? selLoc.period.ru : `${selLoc.period.ru}, ${selLoc.day}`) : '?';
    const selIsToday = sel.year === info.time.year && sel.doy === info.time.doy;
    const selMoons = selLoc ? moonsOf(info.state.calendar, selLoc.period).map(moon => { const ph = moonPhase(info.state.calendar, moon, sel.year, sel.doy, selLoc.day); return `<div class="sj-moonsel">${moonSvg(ph.f, 18, ph.event)}<span>${esc(moon.ru)}: <b>${esc(ph.phase.ru)}</b></span></div>`; }).join('') : '';

    const layersHtml = (cal.layers ?? []).length
      ? `<div class="sj-lays2" role="group" aria-label="Слои праздников">${cal.layers.map(l => `<label class="sj-layc" style="--lc:${esc(l.color)}" title="${esc(l.note ?? '')}"><input type="checkbox" data-layer="${esc(l.id)}" ${info.layers.has(l.id) ? 'checked' : ''}><span class="sw"></span>${esc(l.ru)} <small>${counts[l.id] ?? 0}</small></label>`).join('')}</div>` : '';

    const ribbon = periods.map((x, i) => {
      const w = (x.days / total) * 100;
      const mark = info.time.year === view.year && locate(cal, view.year, info.time.doy)?.index === i ? '<i class="mark"></i>' : '';
      return `<button class="sj-seg2${x.type === 'festival' ? ' fest' : ''}${i === view.index ? ' view' : ''}" data-i="${i}" style="${x.type === 'festival' ? `width:${Math.max(w, 1.6)}%` : `flex:${x.days} 1 0`}" title="${esc(x.ru)} · ${x.days} дн.">${x.type === 'month' ? esc(x.ru.slice(0, 4)) : ''}${mark}</button>`;
    }).join('');

    win.innerHTML = `
      <div class="sj-wh"><h2>Календарь</h2><span class="sj-sub">${esc(cal.world)}</span><label class="sj-worldsel" title="Мир этого чата. Всё, что в нём ведётся, остаётся за ним и вернётся при возврате.">Мир <select id="sj-cal-world" aria-label="Мир">${ORDER.map(id => `<option value="${id}"${id === info.state.calendar ? ' selected' : ''}>${esc(CALENDARS[id].ru)}</option>`).join('')}</select></label><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="sj-calhead">
        <div><div class="sj-calnow">Сегодня: <b>${esc(info.date.name)}</b>, ${info.date.year} ${esc(info.date.era)}${info.date.storyDay != null ? ` · <span class="sj-dayn">Д${info.date.storyDay}</span>` : ''}</div>
          <div class="sj-sub">${formatTime(info.time.minutes)}, ${partOfDay(info.time.minutes)}${info.date.season ? ' · ' + esc(info.date.season) : ''} · день года ${info.date.doy} из ${info.date.yearDays}</div></div>
        <div class="sj-nav"><button class="sj-btn" data-act="prev" aria-label="Назад">‹</button><span class="sj-yr" title="${esc(cal.era.full)}">${view.year} ${esc(cal.era.ru)}</span><button class="sj-btn" data-act="next" aria-label="Вперёд">›</button><button class="sj-btn" data-act="today">сегодня</button></div>
      </div>
      ${layersHtml}
      <div class="sj-calbody">
        <div class="sj-ctitle"><h3>${esc(p.ru)} <span class="en">${esc(p.en)}</span></h3><div class="sj-sub">${[p.epithet, season, p.type === 'month' ? p.days + ' дн.' : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
        <div class="sj-cmain">
          ${gridHtml(info, p, view.index)}
          <div class="sj-ribbon">${ribbon}</div><div class="sj-ribcap"><span>начало года</span><span>${total} дн. · периодов: ${periods.length}</span><span>конец года</span></div>
          ${moonHtml(info, p, view.index)}
        </div>
        <div class="sj-cside">
          <div class="sj-info sj-selcard${selIsToday ? ' today' : ''}">
            <div class="sj-selhead"><h4>Выбранный день</h4><span class="sj-seltag">${selIsToday ? 'сегодня' : 'не сегодня'}</span></div>
            <div class="sj-selname"><span class="d">${esc(selName)}</span><span class="y">${sel.year}</span><span class="sj-dayn">Д${selDay}</span></div>
            ${selMoons ? `<div class="sj-selmoons">${selMoons}</div>` : ''}
            ${selHol.length ? `<ul class="sj-selhol">${lineHtml(info, selHol, false)}</ul>` : '<div class="sj-selnone">праздников нет</div>'}
            ${selIsToday ? '' : '<button class="sj-btn sj-pri sj-selmake" data-act="makeToday" title="Время суток останется прежним">Сделать сегодняшним днём</button>'}</div>
          ${moons.length ? `<details class="sj-info"><summary>По луне, без даты · ${moons.length}</summary><ul>${lineHtml(info, moons)}</ul></details>` : ''}
        </div>
      </div>
      ${holidaysHtml(info, monthHol, p)}`;
    alignSide();
  }

  /** Плашка справа начинается на одной линии с первой строкой ячеек, под строкой дней недели. */
  function alignSide() {
    try {
      const side = win.querySelector('.sj-cside'), cell = win.querySelector('.sj-cgrid .sj-cell');
      if (!side || !cell || getComputedStyle(side).marginTop === undefined) return;
      side.style.marginTop = '0px';
      const delta = cell.getBoundingClientRect().top - side.getBoundingClientRect().top;
      side.style.marginTop = delta > 0 && delta < 120 && win.querySelector('.sj-calbody')?.offsetWidth > 800 ? `${Math.round(delta)}px` : '';
    } catch { /* без выравнивания окно работает */ }
  }

  const move = dir => {
    const info = scene().get(); const cal = info.calendar;
    let index = view.index + dir, year = view.year;
    if (index < 0) { year -= 1; index = cal.periods(year).length - 1; }
    else if (index >= cal.periods(year).length) { year += 1; index = 0; }
    view = { year, index };
  };

  const onClick = event => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return shell.close();
    if (act === 'prev') { move(-1); return render(); }
    if (act === 'next') { move(1); return render(); }
    if (act === 'today') { view = { year: 0, index: 0 }; sel = null; return render(); }
    if (act === 'makeToday') {
      const info = scene().get();
      if (sel && scene().setTime({ year: sel.year, doy: sel.doy, minutes: info.time.minutes })) { view = { year: 0, index: 0 }; sel = null; }
      return render();
    }
    const hedit = event.target.closest('[data-hedit]'); if (hedit) { editingNote = hedit.dataset.hedit; return render(); }
    const hcancel = event.target.closest('[data-hcancel]'); if (hcancel) { editingNote = ''; return render(); }
    const hsave = event.target.closest('[data-hsave]');
    if (hsave) {
      const box = win.querySelector('[data-hnote]');
      settings.holidayNotes = settings.holidayNotes && typeof settings.holidayNotes === 'object' ? settings.holidayNotes : {};
      const text = String(box?.value ?? '').trim().slice(0, 1200);
      if (text) settings.holidayNotes[hsave.dataset.hsave] = text; else delete settings.holidayNotes[hsave.dataset.hsave];
      try { deps.save?.(); } catch { /* сохранится при следующей записи */ }
      editingNote = ''; return render();
    }
    const hclear = event.target.closest('[data-hclear]');
    if (hclear) { delete settings.holidayNotes?.[hclear.dataset.hclear]; try { deps.save?.(); } catch { /* позже */ } editingNote = ''; return render(); }
    const cell = event.target.closest('[data-doy]');
    if (cell) { sel = { year: view.year, doy: Number(cell.dataset.doy) }; return render(); }
    const seg = event.target.closest('[data-i]');
    if (seg) { view.index = Number(seg.dataset.i); return render(); }
  };
  const onChange = event => {
    const el = event.target;
    if (el.id === 'sj-cal-world') {
      if (window.confirm('Сменить мир? Время, отношения, тайны, анкеты и всё остальное, что велось в этом мире, сохранится и вернётся, когда вы вернётесь в него. В новом мире история начнётся с чистого листа.')) { view = { year: 0, index: 0 }; sel = null; scene().setCalendar(el.value); } else render();
      return;
    }
    if (!el.dataset?.layer) return;
    const info = scene().get();
    const next = new Set(info.layers);
    if (el.checked) next.add(el.dataset.layer); else next.delete(el.dataset.layer);
    scene().setLayers(info.state.calendar, next);   // подписка перерисует окно
  };
  const onToggle = event => { if (event.target?.matches?.('[data-holbox]')) holOpen = event.target.open; };
  win.addEventListener('toggle', onToggle, true);
  win.addEventListener('click', onClick);
  win.addEventListener('change', onChange);

  const unsubscribe = scene()?.subscribe(info => {
    if (!shell.isOpen) return;
    if (!info?.hasChat) return shell.close();
    render();
  });

  function open() {
    const info = scene()?.get();
    if (!info?.hasChat) return;
    view = { year: 0, index: 0 };
    sel = null;
    shell.show(info.state.calendar);
    render();
    win.focus();
  }

  shared.ui = { ...(shared.ui ?? {}), openCalendar: open, closeCalendar: shell.close };
  return () => {
    unsubscribe?.();
    win.removeEventListener('toggle', onToggle, true);
    win.removeEventListener('click', onClick);
    win.removeEventListener('change', onChange);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openCalendar; delete shared.ui.closeCalendar; }
  };
}
