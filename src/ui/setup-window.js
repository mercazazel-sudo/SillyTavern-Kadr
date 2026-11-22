/**
 * Мастер первой настройки: «Привет, давай настроим расширение, чтобы рассказчик получал актуальные данные!»
 * Три шага: 1) персона (выбор из списка персон Таверны, автоматической привязки нет), 2) мир и летоисчисление с первым днём
 * истории (справка из календаря и для календаря), 3) лорбуки персонажа и персоны, из которых потом заполняются анкеты, тайны и отношения.
 * Открывается сам в каждом новом чате (персона не привязана, в чате не больше приветствия), пока его не отключили кнопкой «Больше не
 * показывать»; в любой момент его можно запустить из «Настроек». Каждый шаг применяется по кнопке «Дальше»: ничего не меняется само.
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { report } from '../guard.js';
import { CALENDARS, ORDER, locate, weekdayOf, seasonOf, holidaysOf, defaultLayers, yearLength } from '../core/calendars.js';
import { moonsOf, moonPhase } from '../core/moon.js';
import { formatDateText, parseDateText } from '../core/dates.js';

const STEPS = ['Персона', 'Мир и дата', 'Лорбуки'];
const pad = n => String(n).padStart(2, '0');

export function startSetupWindow(deps) {
  const { shared, settings } = deps;
  const ctx = () => globalThis.SillyTavern.getContext();
  const scene = () => shared.scene;
  const shell = createShell({ id: 'sj-setup', label: 'Первая настройка', width: 780 });
  const { win } = shell;
  let step = 0;
  let dismissedChat = '';           // в этой сессии для этого чата уже закрыли
  // чаты, в которых мастер уже пройден до конца: хранится в браузере, на них он сам не открывается повторно
  const SEEN_KEY = 'sceneJournal.setupSeen';
  const seenChats = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
  const markSeen = id => { try { if (!id) return; const s = seenChats(); s.add(id); localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-300))); } catch { /* память браузера недоступна, не страшно */ } };
  let note = '';
  let busy = false;
  let draft = null;

  // ---------- что есть в Таверне ----------
  const personas = () => Object.entries(ctx().powerUserSettings?.personas ?? {}).map(([avatar, name]) => ({ avatar, name: String(name ?? '').trim() })).filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const bookNames = () => { try { return ctx().getWorldInfoNames?.() ?? []; } catch { return []; } };
  const character = () => { const c = ctx(); return c.groupId ? null : c.characters?.[c.characterId] ?? null; };
  const personaBookOf = avatar => String(ctx().powerUserSettings?.persona_descriptions?.[avatar]?.lorebook ?? '');
  const options = (list, current, empty) => `<option value="">${esc(empty)}</option>${list.map(x => `<option value="${esc(x)}"${x === current ? ' selected' : ''}>${esc(x)}</option>`).join('')}`;

  // ---------- календарь: справка и предварительный просмотр первого дня ----------
  const startOf = id => { const cal = CALENDARS[id]; const s = typeof cal.start === 'function' ? cal.start() : { year: cal.defaultYear, doy: 1 }; return { year: s.year, doy: s.doy }; };
  const periodStart = (cal, year, index) => cal.periods(year).slice(0, index).reduce((s, p) => s + p.days, 1);
  const weekdayLabel = (cal, year, doy) => {
    const wd = weekdayOf(cal, year, doy);
    if (wd == null) return '';
    const n = cal.week.names?.[wd];
    const of = { 'декада': 'декады', 'неделя': 'недели' }[cal.week.label] ?? cal.week.label ?? 'недели';
    return n ? (n.ru ?? n[0]) : `${wd + 1}-й день ${of}`;
  };
  function preview(d) {
    const cal = CALENDARS[d.calendar];
    const loc = locate(cal, d.year, d.doy);
    if (!loc) return '<div class="sj-sub">Такой даты в этом календаре нет.</div>';
    const layers = defaultLayers(cal);
    const hol = holidaysOf(loc.period, layers).filter(h => h.d <= loc.day && loc.day <= (h.to ?? h.d)).map(h => h.ru);
    const moons = moonsOf(d.calendar, loc.period).map(m => `${m.ru}: ${moonPhase(d.calendar, m, d.year, d.doy, loc.day).phase.ru.toLowerCase()}`);
    const season = seasonOf(cal, d.year, d.doy);
    const wd = weekdayLabel(cal, d.year, d.doy);
    return `<div class="sj-su-prev"><b>Д1</b> · ${[wd, `${loc.period.ru}${loc.period.type === 'month' ? `, ${loc.day}` : ''}`, `${d.year} ${cal.era.ru}`, season].filter(Boolean).map(esc).join(' · ')}
      ${hol.length ? `<div class="sj-sub">Праздники в этот день: ${hol.map(esc).join(', ')}</div>` : ''}${moons.length ? `<div class="sj-sub">${moons.map(esc).join('; ')}</div>` : ''}</div>`;
  }
  function calendarInfo(d) {
    const cal = CALENDARS[d.calendar];
    const periods = cal.periods(d.year);
    const wk = cal.week.names ? cal.week.names.map(n => n.ru ?? n[0]).join(', ') : `${cal.week.label ?? 'неделя'} из ${cal.week.len} дней`;
    return `<div class="sj-su-info"><div><b>${esc(cal.world)}</b></div>
      <div class="sj-sub">Летоисчисление: ${esc(cal.era.full)} (${esc(cal.era.ru)}). В выбранном году ${periods.length} периодов, ${yearLength(cal, d.year)} дн.</div>
      <div class="sj-sub">${esc(cal.week.label ?? 'Неделя')}: ${esc(wk)}.</div>
      ${(cal.notes ?? []).slice(0, 1).map(n => `<div class="sj-sub">${esc(n)}</div>`).join('')}</div>`;
  }

  /** История времени, кроме шага на приветствие: только она заслуживает предупреждения «начать заново». */
  const realHistory = info => info.state.timeline.some(e => !(e.type === 'step' && e.at <= 1));

  // ---------- шаги ----------
  function personaStep(info) {
    const list = personas();
    const tavern = String(ctx().name1 ?? '');
    const bound = info.cast.find(p => p.persona)?.name;
    const picked = list.find(p => p.avatar === draft.avatar);
    const differs = picked && picked.name.trim().toLowerCase() !== tavern.trim().toLowerCase();
    return `<h3>1. Кто вы в этой истории</h3>
      <p class="sj-sub">Персона — это игрок. Расширение ничего не привязывает само: выберите персону из списка, и она станет «вами» в этом чате (у неё нет отношений и анкеты для рассказчика, ею управляете вы).</p>
      ${bound ? `<p class="sj-sub">Сейчас в чате привязана: <b>${esc(bound)}</b>.</p>` : ''}
      ${list.length ? `<label class="sj-row">Персона<select data-f="avatar" aria-label="Персона">${`<option value="">— выбрать персону —</option>`}${list.map(p => `<option value="${esc(p.avatar)}"${p.avatar === draft.avatar ? ' selected' : ''}>${esc(p.name)}${p.name === tavern ? ' (сейчас в Таверне)' : ''}</option>`).join('')}</select></label>`
        : '<p class="sj-sub">В Таверне пока нет персон. Создайте её в панели «Персона» и запустите мастер из «Настроек» ещё раз.</p>'}
      ${differs ? `<label class="sj-chk"><input type="checkbox" data-f="makeActive" ${draft.makeActive ? 'checked' : ''}><span>Сделать эту персону активной в Таверне (иначе расширение будет предупреждать, что персона чата и персона Таверны разные)</span></label>` : ''}`;
  }
  const CAL_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4z"/><path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 3v3M16 3v3"/></svg>';

  /** Мини-календарь выбранного мира: месяц (или праздничные дни) с днями, листание по периодам и годам. */
  function popupHtml(cal) {
    const v = draft.view;
    const periods = cal.periods(v.year);
    const idx = Math.min(Math.max(v.index, 0), periods.length - 1);
    const p = periods[idx];
    const first = periodStart(cal, v.year, idx);
    const cols = p.type === 'month' ? cal.week.len : Math.min(p.days, cal.week.len);
    const off = p.type === 'month' ? (weekdayOf(cal, v.year, first) ?? 0) : 0;
    const head = p.type === 'month' ? Array.from({ length: cols }, (_, i) => `<i>${esc(cal.week.names?.[i] ? String(cal.week.names[i].ru ?? cal.week.names[i][0]).slice(0, 2) : i + 1)}</i>`).join('') : '';
    const chosen = locate(cal, draft.year, draft.doy);
    const cells = Array.from({ length: off }, () => '<span></span>').join('') + Array.from({ length: p.days }, (_, d) => {
      const on = chosen && draft.year === v.year && chosen.index === idx && chosen.day === d + 1;
      return `<button type="button" class="${on ? 'on' : ''}" data-pickday="${d + 1}">${d + 1}</button>`;
    }).join('');
    return `<div class="sj-su-pop" role="dialog" aria-label="Календарь">
      <div class="sj-su-pnav"><button type="button" data-act="calnav" data-d="y-1" aria-label="Год назад" title="Год назад">«</button><button type="button" data-act="calnav" data-d="p-1" aria-label="Назад">‹</button>
        <b>${esc(p.ru)} · ${v.year} ${esc(cal.era.ru)}</b>
        <button type="button" data-act="calnav" data-d="p+1" aria-label="Вперёд">›</button><button type="button" data-act="calnav" data-d="y+1" aria-label="Год вперёд" title="Год вперёд">»</button></div>
      ${head ? `<div class="sj-su-pgrid head" style="--c:${cols}">${head}</div>` : ''}
      <div class="sj-su-pgrid" style="--c:${cols}">${cells}</div></div>`;
  }

  function worldStep(info) {
    const cal = CALENDARS[draft.calendar];
    const hasHistory = realHistory(info);
    return `<h3>2. Мир и первый день истории</h3>
      <p class="sj-sub">От мира зависят календарь, праздники, времена года и Луна. Выбранная дата станет первым днём истории (Д1), дальше считаются дни.</p>
      <label class="sj-row">Мир<select data-f="calendar" aria-label="Мир">${ORDER.map(id => `<option value="${id}"${id === draft.calendar ? ' selected' : ''}>${esc(CALENDARS[id].ru)}</option>`).join('')}</select></label>
      ${calendarInfo(draft)}
      <div class="sj-lbl" style="margin-top:12px">Первый день истории</div>
      <div class="sj-su-date">
        <label class="sj-su-dt">Дата
          <span class="sj-su-dtrow"><input type="text" data-f="dateText" value="${esc(formatDateText(cal, draft.year, draft.doy))}" placeholder="например: 1 ${esc(cal.periods(draft.year)[0].ru)} ${draft.year}" aria-label="Дата" autocomplete="off" spellcheck="false"><button type="button" class="sj-btn sj-su-calbtn" data-act="calpop" aria-expanded="${Boolean(draft.pop)}" aria-label="Выбрать на календаре" title="Выбрать на календаре">${CAL_ICON}</button></span>
          <span class="sj-sub">Наберите руками («1 ${esc(cal.periods(draft.year)[0].ru)} ${draft.year}», «21.11.2026») или нажмите на календарик.</span></label>
        <label>Время<input type="time" data-f="time" value="${esc(draft.time)}" aria-label="Время"></label>
      </div>
      ${draft.pop ? popupHtml(cal) : ''}
      ${preview(draft)}
      ${hasHistory ? '<p class="sj-sub" style="color:#d98a4a">В этом чате уже есть история времени: если применить, лента времени начнётся заново с этой даты.</p>' : ''}`;
  }

  function booksStep() {
    const ch = character();
    const names = bookNames();
    const persona = personas().find(p => p.avatar === draft.avatar);
    const bound = draft.bound ?? [];
    return `<h3>3. Лорбуки</h3>
      <p class="sj-sub">Из этих лорбуков расширение потом заполняет анкеты, тайны и отношения. Читаются только лорбуки, привязанные к чату, персонажу и персоне. У персонажа может быть несколько лорбуков: здесь основной, второстепенные (NPC) подключаются позже вручную в «Анкетах», вкладка «Второстепенные».</p>
      <div class="sj-lbl">Лорбук основных персонажей${ch ? `: ${esc(ch.name)}` : ''}</div>
      ${ch ? `<label class="sj-row">Лорбук<select data-f="charBook" aria-label="Лорбук основных персонажей">${options(names, draft.charBook, '— не привязан —')}</select></label>`
        : '<p class="sj-sub">Групповой чат или персонаж не выбран: лорбуки основных персонажей привязываются в их карточках в Таверне.</p>'}
      <div class="sj-lbl" style="margin-top:12px">Лорбук персоны${persona ? `: ${esc(persona.name)}` : ''}</div>
      ${persona ? `<label class="sj-row">Лорбук<select data-f="personaBook" aria-label="Лорбук персоны">${options(names, draft.personaBook, '— не привязан —')}</select></label>`
        : '<p class="sj-sub">Сначала выберите персону на первом шаге.</p>'}
      <div class="sj-lbl" style="margin-top:12px">Уже подключено к этому чату</div>
      <div class="sj-sub">${bound.length ? bound.map(esc).join(', ') : 'пока ничего'}</div>`;
  }
  function doneStep() {
    return `<h3>Готово</h3>
      <ul class="sj-su-done">${draft.log.map(x => `<li>${esc(x)}</li>`).join('') || '<li>Ничего не менялось.</li>'}</ul>
      <p class="sj-sub">Дальше: в «Анкетах» нажмите «Собрать основных из всех лорбуков», в «Тайнах» и «Отношениях» герои подтянутся сами. Мастер можно запустить снова в «Настройках».</p>`;
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    shell.theme(info.state.calendar);
    const last = step === STEPS.length;
    const stepper = last ? '' : `<div class="sj-su-steps">${STEPS.map((s, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}"><i>${i + 1}</i>${esc(s)}</span>`).join('')}</div>`;
    const body = step === 0 ? personaStep(info) : step === 1 ? worldStep(info) : step === 2 ? booksStep() : doneStep();
    const intro = step === 0 ? '<p class="sj-su-hello">Привет! Давай настроим расширение, чтобы рассказчик получал актуальные данные!</p>' : '';
    const buttons = last
      ? '<button class="sj-btn sj-pri" data-act="close">Закрыть</button><button class="sj-btn" data-act="cards">Открыть «Анкеты»</button><button class="sj-btn" data-act="triage">Разобрать лорбук</button>'
      : `${step > 0 ? '<button class="sj-btn" data-act="back">← Назад</button>' : ''}<button class="sj-btn sj-pri" data-act="next"${busy ? ' disabled' : ''}>${step === STEPS.length - 1 ? 'Готово' : 'Дальше →'}</button><button class="sj-btn" data-act="skip" title="Пропустить этот шаг, ничего не меняя">Пропустить шаг</button>`;
    win.innerHTML = `<div class="sj-wh"><h2>Первая настройка</h2><span class="sj-sub">Кадр</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="sj-su-body">${intro}${stepper}${body}${note ? `<p class="sj-sub" style="color:#d98a4a">${esc(note)}</p>` : ''}</div>
      <div class="sj-su-foot"><div class="sj-su-btns">${buttons}</div>${last ? '' : '<div class="sj-su-later"><button class="sj-linkbtn" data-act="later">Позже</button><button class="sj-linkbtn" data-act="never" title="Мастер не будет открываться сам в новых чатах. Запустить его можно из «Настроек».">Больше не показывать</button></div>'}</div>`;
  }

  // ---------- применение шагов ----------
  async function applyPersona() {
    const p = personas().find(x => x.avatar === draft.avatar);
    if (!p) return;
    if (!scene().bindPersonaByName(p.name)) throw new Error('персону привязать не удалось');
    draft.log.push(`Персона: ${p.name}`);
    const same = String(ctx().name1 ?? '').trim().toLowerCase() === p.name.trim().toLowerCase();
    if (!same && draft.makeActive) {
      const mod = await import('/scripts/personas.js');
      await mod.setUserAvatar(p.avatar, { toastPersonaNameChange: false });
      draft.log.push('Персона стала активной в Таверне');
    }
  }
  function applyWorld() {
    const cal = CALENDARS[draft.calendar];
    const [h, m] = String(draft.time || '08:00').split(':').map(Number);
    const minutes = (Number.isFinite(h) ? h : 8) * 60 + (Number.isFinite(m) ? m : 0);
    if (!scene().startStory({ calendar: draft.calendar, year: draft.year, doy: draft.doy, minutes })) throw new Error('такая дата не подходит этому календарю');
    const loc = locate(cal, draft.year, draft.doy);
    draft.log.push(`Мир: ${cal.ru}; Д1: ${loc?.period.ru ?? ''}${loc?.period.type === 'month' ? ` ${loc.day}` : ''}, ${draft.year} ${cal.era.ru}`);
  }
  async function applyBooks() {
    const ch = character();
    if (ch && draft.charBook !== draft.charBookWas) {
      const res = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ avatar: ch.avatar, data: { extensions: { world: draft.charBook } } }) });
      if (!res.ok) throw new Error(`лорбук персонажа не сохранился (${res.status})`);
      ch.data = ch.data ?? {}; ch.data.extensions = ch.data.extensions ?? {}; ch.data.extensions.world = draft.charBook;
      draft.log.push(draft.charBook ? `Лорбук основных персонажей («${ch.name}»): ${draft.charBook}` : `Лорбук основных персонажей («${ch.name}») отвязан`);
    }
    const pa = personas().find(x => x.avatar === draft.avatar);
    if (pa && draft.personaBook !== draft.personaBookWas) {
      const pu = ctx().powerUserSettings;
      pu.persona_descriptions = pu.persona_descriptions ?? {};
      const desc = pu.persona_descriptions[pa.avatar] ?? (pu.persona_descriptions[pa.avatar] = { description: '', position: 0, depth: 2, role: 0, lorebook: '', connections: [], title: '' });
      desc.lorebook = draft.personaBook;
      const mod = await import('/scripts/personas.js');
      if (mod.user_avatar === pa.avatar) pu.persona_description_lorebook = draft.personaBook;       // как в окне лорбука персоны в Таверне
      ctx().saveSettingsDebounced?.();
      draft.log.push(draft.personaBook ? `Лорбук персоны «${pa.name}»: ${draft.personaBook}` : `Лорбук персоны «${pa.name}» отвязан`);
    }
    try { await shared.cards?.boundBooks?.(); } catch { /* список перечитается сам */ }
  }

  async function next() {
    if (busy) return;
    busy = true; note = ''; render();
    try {
      if (step === 0) await applyPersona();
      else if (step === 1) {
        const info = scene().get();
        if (realHistory(info) && !window.confirm('В этом чате уже есть история времени. Начать её заново с выбранной даты?')) { busy = false; return render(); }
        applyWorld();
      } else if (step === 2) {
        await applyBooks();
        markSeen(ctx().chatId);
      }
      step += 1;
    } catch (error) { note = String(error?.message ?? error); report('мастер настройки', error); }
    busy = false;
    render();
  }

  // ---------- события ----------
  const readField = el => {
    const f = el.dataset.f;
    if (f === 'avatar') { draft.avatar = el.value; draft.personaBook = personaBookOf(el.value); draft.personaBookWas = draft.personaBook; render(); return; }
    if (f === 'makeActive') { draft.makeActive = el.checked; return; }
    if (f === 'charBook') { draft.charBook = el.value; return; }
    if (f === 'personaBook') { draft.personaBook = el.value; return; }
    if (f === 'calendar') { draft.calendar = el.value; Object.assign(draft, startOf(draft.calendar)); draft.pop = false; note = ''; render(); return; }
    const cal = CALENDARS[draft.calendar];
    if (f === 'dateText') {
      const r = parseDateText(cal, el.value, draft.year);
      if (r.error) note = r.error; else { draft.year = r.year; draft.doy = r.doy; note = ''; }
      render(); return;
    }
    if (f === 'time') { draft.time = el.value || '08:00'; }
  };
  const onChange = event => { if (event.target?.dataset?.f) readField(event.target); };
  const onClick = event => {
    const pick = event.target.closest('[data-pickday]');
    if (pick) {
      const cal = CALENDARS[draft.calendar], v = draft.view;
      draft.year = v.year; draft.doy = periodStart(cal, v.year, v.index) + Number(pick.dataset.pickday) - 1;
      draft.pop = false; note = ''; return render();
    }
    const actEl = event.target.closest('[data-act]');
    const act = actEl?.dataset.act;
    if (act === 'calpop') {
      const cal = CALENDARS[draft.calendar], loc = locate(cal, draft.year, draft.doy);
      draft.pop = !draft.pop;
      if (draft.pop) draft.view = { year: draft.year, index: loc?.index ?? 0 };
      return render();
    }
    if (act === 'calnav') {
      const cal = CALENDARS[draft.calendar], v = draft.view, d = actEl.dataset.d;
      if (d === 'y-1' || d === 'y+1') { v.year += d === 'y+1' ? 1 : -1; v.index = Math.min(v.index, cal.periods(v.year).length - 1); }
      else if (d === 'p+1') { if (v.index + 1 < cal.periods(v.year).length) v.index += 1; else { v.year += 1; v.index = 0; } }
      else if (d === 'p-1') { if (v.index > 0) v.index -= 1; else { v.year -= 1; v.index = cal.periods(v.year).length - 1; } }
      return render();
    }
    if (!act) return;
    if (act === 'close') { dismissedChat = ctx().chatId; return shell.close(); }
    if (act === 'later') { dismissedChat = ctx().chatId; return shell.close(); }
    if (act === 'never') { settings.setupOff = true; deps.save?.(); return shell.close(); }
    if (act === 'back') { step = Math.max(0, step - 1); note = ''; return render(); }
    if (act === 'skip') { step += 1; note = ''; if (step === STEPS.length) markSeen(ctx().chatId); return render(); }
    if (act === 'next') return void next();
    if (act === 'cards') { shell.close(); shared.ui?.openCards?.(); }
    if (act === 'triage') { shell.close(); shared.ui?.openTriage?.(); }
  };
  win.addEventListener('change', onChange);
  win.addEventListener('click', onClick);

  async function open() {
    const info = scene()?.get();
    if (!info?.hasChat) return;
    const ch = character();
    const active = personas().find(p => p.name.trim().toLowerCase() === String(ctx().name1 ?? '').trim().toLowerCase());
    draft = {
      avatar: '', makeActive: true, pop: false, view: { year: 0, index: 0 },
      calendar: info.state.calendar, year: info.state.start.year, doy: info.state.start.doy, time: `${pad(Math.floor(info.state.start.minutes / 60))}:${pad(info.state.start.minutes % 60)}`,
      charBook: String(ch?.data?.extensions?.world ?? ''), personaBook: '', personaBookWas: '', bound: [], log: [],
    };
    draft.charBookWas = draft.charBook;
    void active;                                      // активная персона только подсвечивается в списке, автоматически не выбирается
    step = 0; note = ''; busy = false;
    shell.show(info.state.calendar);
    render();
    try { draft.bound = (await shared.cards?.boundBooks?.()) ?? []; if (step === 2) render(); } catch { /* список необязателен */ }
    win.focus();
  }

  // ---------- автозапуск: чат, где расширение ещё ничего не вело ----------
  /**
   * Новый чат: персона не привязана и в чате не больше приветствия и первой реплики. Ни «состояния ещё нет», ни «лента времени пуста» не годятся:
   * состояние создают другие службы при открытии чата, а шаг времени встаёт уже на приветствие.
   */
  const isFresh = info => !info.cast.some(p => p.persona) && (ctx().chat?.length ?? 0) <= 2;
  const maybeOpen = () => {
    try {
      if (settings.setupOff === true || settings.enabled === false || shell.isOpen) return;
      const info = scene()?.get();
      if (!info?.hasChat || !isFresh(info)) return;
      if (dismissedChat && dismissedChat === ctx().chatId) return;
      if (seenChats().has(ctx().chatId)) return;
      open();
    } catch (error) { report('автозапуск мастера настройки', error); }
  };
  const c0 = ctx();
  const onChat = () => setTimeout(maybeOpen, 600);
  try { c0.eventSource.on(c0.eventTypes.CHAT_CHANGED, onChat); } catch { /* событий нет, останется ручной запуск */ }
  const timer = setTimeout(maybeOpen, 2500);

  shared.ui = { ...(shared.ui ?? {}), openSetup: open, closeSetup: shell.close };
  return () => {
    clearTimeout(timer);
    try { c0.eventSource.removeListener(c0.eventTypes.CHAT_CHANGED, onChat); } catch { /* уже снято */ }
    win.removeEventListener('change', onChange);
    win.removeEventListener('click', onClick);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openSetup; delete shared.ui.closeSetup; }
  };
}
