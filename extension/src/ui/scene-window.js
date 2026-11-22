/**
 * Окно «Обстановка»: время (прыжки и точная установка), место, настройки и то, что уйдёт рассказчику.
 * Открывается кликом по строке сцены. Читает shared.scene.get(), действия отдаёт сервису.
 */
import { report } from '../guard.js';
import { esc } from './dom.js';
import { photoFor } from './photo.js';
import { themeFor } from './theme.js';
import { TIERS } from '../core/body.js';
import { formatTime, partOfDay, parseDuration } from '../core/clock.js';
import { KINDS, CLIMATES, describeWeather } from '../core/weather.js';
import { LEVELS } from '../core/tension.js';
import { blockStats } from '../core/scene-text.js';

export function startSceneWindow(deps) {
  const { shared, settings } = deps;
  const overlay = document.createElement('div');
  overlay.id = 'sj-overlay';
  overlay.className = 'sj-drawer';   // не окно поверх всего, а шторка прямо над полоской сцены в чате
  overlay.hidden = true;
  overlay.innerHTML = '<div class="sj-win" role="region" aria-label="Обстановка" tabindex="-1"></div>';
  const win = overlay.firstElementChild;
  /** Ставит шторку над полоской сцены (полоска появляется чуть позже окон, поэтому место ищется при открытии). */
  const mount = () => {
    const strip = document.getElementById('sj-strip');
    const host = strip?.parentElement ?? document.getElementById('form_sheld');
    if (host) { if (overlay.parentElement !== host || overlay.nextElementSibling !== strip) host.insertBefore(overlay, strip ?? document.getElementById('send_form')); }
    else if (!overlay.isConnected) document.body.append(overlay);
  };

  let isOpen = false;
  let dirty = false;
  let draft = null;           // черновик формы «поставить дату»: { year, period, day, time }
  let wxOpen = false;         // форма погоды раскрыта
  let returnFocus = null;

  const scene = () => shared.scene;
  const periodsOf = (calendar, year) => calendar.periods(year);
  const doyOf = (calendar, year, periodIndex, day) => {
    const periods = periodsOf(calendar, year);
    const p = periods[Math.min(Math.max(periodIndex, 0), periods.length - 1)];
    const before = periods.slice(0, periods.indexOf(p)).reduce((sum, x) => sum + x.days, 0);
    return before + Math.min(Math.max(day, 1), p.days);
  };

  function formHtml(info) {
    const calendar = info.calendar;
    if (!draft) draft = { year: info.time.year, period: -1, day: 1, time: formatTime(info.time.minutes) };
    const periods = periodsOf(calendar, draft.year);
    if (draft.period < 0 || draft.period >= periods.length) {
      const now = periodsOf(calendar, info.time.year);
      let i = 0, left = info.time.doy;
      for (; i < now.length && left > now[i].days; i++) left -= now[i].days;
      draft.period = Math.min(i, periods.length - 1);
      draft.day = left;
    }
    const current = periods[draft.period];
    draft.day = Math.min(Math.max(Number(draft.day) || 1, 1), current.days);
    return `<details class="sj-set"><summary>Поставить дату и время точно</summary>
      <div class="sj-form">
        <label>Год<input type="number" id="sj-f-year" value="${draft.year}" step="1"></label>
        <label>Месяц или праздник<select id="sj-f-period">${periods.map((p, i) => `<option value="${i}"${i === draft.period ? ' selected' : ''}>${esc(p.ru)}${p.type === 'festival' ? ' (праздник)' : ''}</option>`).join('')}</select></label>
        <label>День<input type="number" id="sj-f-day" min="1" max="${current.days}" value="${draft.day}" ${current.days === 1 ? 'disabled' : ''}></label>
        <label>Время<input type="time" id="sj-f-time" value="${esc(draft.time)}"></label>
        <button class="sj-btn sj-pri" data-act="set">Поставить</button>
      </div></details>`;
  }

  // ---------- плашки: «Время», «Место и погода», «Кто в кадре» ----------
  function tensionBlock(info) {
    if (!settings.tension || !info.tension) return '<div><div class="sc-lbl">Напряжение</div><div class="sj-sub">Выключено в настройках.</div></div>';
    const t = info.tension;
    const how = { text: 'сдвинулось по тексту рассказчика', manual: 'поставлено вручную', decay: 'остывает само', none: '' }[t.source] ?? '';
    return `<div><div class="sc-lbl">Напряжение</div>
      <div class="sc-row"><div class="sc-tens" role="group" aria-label="Напряжение сцены">${LEVELS.map((l, i) => `<button class="sj-seg${i === t.level ? ' on' : ''}" data-ten="${i}" style="--tc:${esc(l.color)}" title="${esc(l.ru)}" aria-label="${esc(l.ru)}" aria-pressed="${i === t.level}"></button>`).join('')}</div>
        <b class="sc-tl" style="--tc:${esc(t.color)}" title="${esc(how)}">${esc(t.ru)}</b></div></div>`;
  }

  function weatherBlock(info) {
    if (!settings.weather) return '<div><div class="sc-lbl">Погода</div><div class="sj-sub">Выключена в настройках.</div></div>';
    const w = info.weather;
    const k = KINDS[w.kind] ?? KINDS.clear;
    const src = w.source === 'text' ? 'сменилась по тексту ответа' : w.manual ? 'поставлена вручную на сегодня' : 'считается сама по сезону и климату';
    return `<div><div class="sc-lbl">Погода</div>
      <div class="sc-row"><div class="sc-wx"><span class="ic" aria-hidden="true">${k.icon}</span><div><b>${esc(describeWeather(w))}</b><small>${src}</small></div></div><button class="sj-btn" data-act="wxform" aria-expanded="${wxOpen}">${wxOpen ? 'Свернуть' : 'Изменить'}</button></div>
      ${wxOpen ? `<div class="sc-wxform"><div class="sc-join"><select id="sj-wk" aria-label="Погода">${Object.entries(KINDS).map(([id, x]) => `<option value="${id}"${id === w.kind ? ' selected' : ''}>${x.icon} ${esc(x.ru)}</option>`).join('')}</select><input type="number" id="sj-wt" min="-70" max="70" value="${Number.isFinite(w.tempC) ? w.tempC : ''}" placeholder="°C" aria-label="Температура"><button class="sj-btn" data-act="wx">Поставить</button></div>
        <button class="sj-btn" data-act="wxroll" title="Случайная погода на сегодня по этому климату">Заново</button></div>` : ''}</div>`;
  }

  const photoOf = person => photoFor(shared, person);
  /** Третья плашка: кто в кадре и как себя чувствует (полное окно: «Состояние»). */
  function castBlock(info) {
    // в мини-окне только те, кто сейчас в кадре; остальные видны в «Состоянии»
    const everyone = info.cast ?? [];
    const people = everyone.filter(person => person.present);
    const away = everyone.length - people.length;
    const rows = people.map(person => {
      const body = info.bodies?.[person.id];
      const tier = TIERS[body?.tier ?? 0] ?? TIERS[0];
      const wounds = body?.wounds?.length ?? 0;
      const img = photoOf(person);
      return `<div class="sc-wr${person.present ? '' : ' away'}"><span class="sc-av" style="--ring:${esc(tier.color)}">${img ? `<img src="${esc(img)}" alt="">` : esc((person.name[0] ?? '?').toUpperCase())}</span><span class="n"><b>${esc(person.name)}${person.persona ? ' <small>(вы)</small>' : ''}</b><small>${person.present ? esc(tier.ru) : 'не в кадре'}${wounds ? ` · ран: ${wounds}` : ''}</small></span></div>`;
    }).join('');
    return `<section class="sc-pl"><h3>Кто в кадре<small>${people.length}</small></h3>
      <div class="sc-who">${rows || '<div class="sj-sub">В кадре пока никого. Кто рядом, отмечается в окне «Состояние».</div>'}</div>
      ${away ? `<div class="sj-sub">Не в кадре: ${away}. Они в окне «Состояние».</div>` : ''}
      <button class="sj-btn sc-wide" data-act="state">Открыть «Состояние»</button></section>`;
  }

  /** Место сцены: геометка и название (последняя часть пути). Менять место нужно на карте, клик по плашке открывает её. */
  function placeBlock(state) {
    const parts = state.place ? state.place.split('›').map(s => s.trim()).filter(Boolean) : [];
    const name = parts[parts.length - 1] ?? '';
    const up = parts.slice(0, -1).join(' › ');
    return `<button type="button" class="sc-place${name ? '' : ' empty'}" data-act="map" title="${esc(parts.join(' › ') || 'Место задаётся на карте')}"><svg class="ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg><span class="tx"><b>${esc(name || 'место не задано')}</b><small>${esc(name ? (up || 'меняется на карте') : 'выбирается на карте')}</small></span></button>`;
  }

  function html(info) {
    const { time, date, state } = info;
    const part = partOfDay(time.minutes);
    const tags = date.holidays.map(h => `<span class="sc-tag" title="${esc(h.ru)}">${esc(h.ru)}</span>`).join('');
    const step = settings.autoStep ? `${settings.stepMinutes} мин.` : 'ничего (авто-шаг выключен)';
    return `<div class="sj-wh"><h2>Обстановка</h2><span class="sj-sub">${esc(info.calendar.world)}</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="sc-body">
        <section class="sc-pl"><h3>Время</h3>
          <div class="sc-info1"><div class="sc-clock"><b>${formatTime(time.minutes)}</b><span class="sj-part" data-p="${part}">${part}</span></div>${date.storyDay != null ? `<span class="sj-dayn sc-dayn" title="День истории">Д${date.storyDay}</span>` : ''}</div>
          <div class="sc-info2"><span class="d">${esc(date.name)}</span><span class="meta">${date.year} ${esc(date.era)}${date.season ? ' · ' + esc(date.season) : ''}</span></div>
          ${tags ? `<div class="sc-tags">${tags}</div>` : ''}
          <div class="sc-seg"><button data-skip="h1">+1 час</button><button data-skip="morning">до утра</button><button data-skip="evening">до вечера</button><button data-skip="d1">+1 день</button><button data-skip="d3">+3 дня</button></div>
          <div class="sc-join"><input id="sj-dur" placeholder="Прибавить: 2 дня 4 часа" aria-label="Прибавить время"><button class="sj-btn" data-act="dur">Прибавить</button></div>
          <div class="sc-links"><span class="mini">Сегодня день № <input type="number" id="sj-dayno" value="${date.storyDay ?? ''}" aria-label="Номер сегодняшнего дня истории" title="Какой по счёту день истории сегодня"><button class="sc-linkbtn" data-act="dayno" title="Пересчитать счётчик: сегодняшний день получит этот номер">поставить</button></span></div>
          ${formHtml(info)}
        </section>
        <section class="sc-pl"><h3>Место и погода</h3>
          ${placeBlock(state)}
          ${tensionBlock(info)}
          ${weatherBlock(info)}
          <div class="sc-row"><span class="sc-lbl">Климат чата</span><div class="sc-join sc-grow"><select id="sj-clim" aria-label="Климат чата">${Object.entries(CLIMATES).map(([id, c]) => `<option value="${id}"${id === state.climate ? ' selected' : ''}>${esc(c.ru)}</option>`).join('')}</select></div></div>
        </section>
        ${castBlock(info)}
      </div>
      <div class="sc-foot"><span>Каждый ответ прибавляет ${step}; удалишь ответ, откатится и его шаг. Кнопки прыжков привязаны к последнему сообщению и тоже откатываются.</span><span>Мир и что уйдёт рассказчику: «Настройки» (шестерёнка в пульте). Праздники включаются в календаре.</span></div>`;
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { close(); return; }
    const top = win.scrollTop;
    overlay.dataset.world = info.state.calendar;
    overlay.dataset.cal = themeFor(info.state.calendar);
    win.innerHTML = html(info);
    win.scrollTop = top;
    dirty = false;
  }

  function open() {
    if (isOpen) return close();   // повторный клик по полоске сворачивает шторку
    const info = scene()?.get();
    if (!info?.hasChat) return;
    returnFocus = document.activeElement;
    draft = null;
    wxOpen = false;
    isOpen = true;
    mount();
    overlay.hidden = false;
    render();
  }
  function close() {
    if (!isOpen && overlay.hidden) return;
    isOpen = false;
    overlay.hidden = true;
    try { returnFocus?.focus?.(); } catch { /* фокус вернуть не вышло, не страшно */ }
  }

  // ---------- действия ----------
  const onClick = event => {
    if (event.target === overlay) return close();
    const skipBtn = event.target.closest('[data-skip]');
    if (skipBtn) { scene().skip(skipBtn.dataset.skip); return; }
    const tenBtn = event.target.closest('[data-ten]');
    if (tenBtn) { scene().setTension(Number(tenBtn.dataset.ten)); return; }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return close();
    if (act === 'dur') {
      const minutes = parseDuration(win.querySelector('#sj-dur').value);
      if (minutes) scene().skip(minutes); else win.querySelector('#sj-dur').classList.add('sj-bad');
      return;
    }
    if (act === 'dayno') {
      const box = win.querySelector('#sj-dayno');
      if (box.value === '' || !scene().setDayNumber(Number(box.value))) box.classList.add('sj-bad');
      return;
    }
    if (act === 'wxform') { wxOpen = !wxOpen; render(); return; }
    if (act === 'wx') {
      const kind = win.querySelector('#sj-wk').value;
      const raw = win.querySelector('#sj-wt').value;
      scene().setWeather({ kind, tempC: raw === '' ? null : Number(raw) });
      return;
    }
    if (act === 'wxroll') { scene().rerollWeather(); return; }
    if (act === 'state') { close(); shared.ui?.openState?.(); return; }
    if (act === 'map') { close(); shared.ui?.openMap?.(); return; }
    if (act === 'set') {
      const info = scene().get();
      const [h, m] = String(draft?.time ?? '').split(':').map(Number);
      const doy = doyOf(info.calendar, Number(draft.year), draft.period, Number(draft.day));
      if (!scene().setTime({ year: Number(draft.year), doy, minutes: (h || 0) * 60 + (m || 0) })) win.querySelector('#sj-f-year')?.classList.add('sj-bad');
    }
  };
  const onChange = event => {
    const el = event.target;
    if (!el?.id) return;
    if (el.id === 'sj-clim') scene().setClimate(el.value);
    else if (el.id === 'sj-f-year') { draft.year = Number(el.value) || draft.year; draft.period = -1; render(); win.querySelector('.sj-set')?.setAttribute('open', ''); }
    else if (el.id === 'sj-f-period') { draft.period = Number(el.value); draft.day = 1; render(); win.querySelector('.sj-set')?.setAttribute('open', ''); }
    else if (el.id === 'sj-f-day') draft.day = Number(el.value) || 1;
    else if (el.id === 'sj-f-time') draft.time = el.value;
  };
  const onKey = event => {
    if (event.key === 'Escape' && isOpen) { event.stopPropagation(); close(); }
    else if (event.key === 'Enter' && event.target.id === 'sj-dur') { event.preventDefault(); win.querySelector('[data-act="dur"]')?.click(); }
  };
  const onFocusOut = () => { if (dirty && isOpen) setTimeout(() => { if (!win.contains(document.activeElement)) render(); }, 0); };

  overlay.addEventListener('click', onClick);
  overlay.addEventListener('change', onChange);
  overlay.addEventListener('keydown', onKey);
  overlay.addEventListener('focusout', onFocusOut);

  // Таверна присылает события по ходу игры: пока человек печатает в окне, не перерисовываем (сбросило бы ввод)
  const unsubscribe = scene()?.subscribe(info => {
    if (!isOpen) return;
    if (!info?.hasChat) return close();
    if (win.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { dirty = true; return; }
    render();
  });

  shared.ui = { ...(shared.ui ?? {}), openScene: open, closeScene: close };
  return () => {
    unsubscribe?.();
    overlay.removeEventListener('click', onClick);
    overlay.removeEventListener('change', onChange);
    overlay.removeEventListener('keydown', onKey);
    overlay.removeEventListener('focusout', onFocusOut);
    overlay.remove();
    if (shared.ui) { delete shared.ui.openScene; delete shared.ui.closeScene; }
  };
}
