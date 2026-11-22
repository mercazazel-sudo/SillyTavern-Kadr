/**
 * Окно «Настройки» (шестерёнка в пульте): слева общие переключатели, справа то, что относится к открытому чату
 * (мир, перенос из Кулис). Читает shared.scene.get(), значения пишет через сервис.
 */
import { report } from '../guard.js';
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { CALENDARS } from '../core/calendars.js';
import { themeList, setTheme, getTheme, getColor, applyTheme, paletteOf, CUSTOM } from './theme.js';
import { formatTime } from '../core/clock.js';
import { describeWeather } from '../core/weather.js';
import { diagnosticsHtml, changesHtml, sentHtml } from './diagnostics.js';
import { FEATURES } from '../core/features.js';
import { D20_SVG } from './d20-icon.js';
import { mobileMode, syncMobile } from './mobile.js';

// «Основные настройки»: как работает расширение. «Данные»: что уходит модели и как идут запросы.
const MAIN_GROUPS = [
  ['Общее', [['strip', 'Строка сцены у поля ввода'], ['dayCounter', 'Счётчик дней (Д1, Д2…) в строке']]],
  ['Что считается само', [['weather', 'Погода по сезону и климату'], ['weatherFromText', '…и смена по словам рассказчика («пошёл дождь»)'], ['tension', 'Шкала напряжения'], ['tensionFromText', '…и сдвиг по словам рассказчика']]],
  ['Разделы в меню', [['hub', 'Показывать меню разделов'], ['showJournal', 'Журнал'], ['showMap', 'Карта']]],
];
const DATA_GROUPS = [
  ['Что уходит рассказчику', [['sendBlock', 'Время и место'], ['sendHolidays', '…и праздник сегодняшнего дня'], ['sendQuests', 'Идущие квесты'], ['sendCast', 'Кто в кадре'], ['sendRelations', 'Отношения тех, кто в кадре'], ['sendKnowledge', 'Тайны: кто что знает, знакомства, погибшие'], ['sendFate', 'd20 жизни: режим, подсказки, броски'], ['sendInventory', 'Вещи тех, кто в кадре'], ['sendPlaces', 'Карточка текущего места'], ['shortRules', 'Краткие правила в блоке (легче промпт на ~550 токенов, но правила короче)'], ['sendCards', 'Анкеты персонажей (заменяют записи лорбука)'], ['sendBody', '…и состояние тех, кто в кадре (раны)'], ['sendWeather', 'Погода'], ['sendTension', 'Напряжение (на «спокойно» не отправляется)']]],
];

export function startSettingsWindow(deps) {
  const { shared, settings } = deps;
  const shell = createShell({ id: 'sj-settings', label: 'Настройки', width: 900 });
  const { win } = shell;
  const scene = () => shared.scene;
  let importNote = '';
  let version = '';           // версия расширения из manifest.json: по ней видно, дошло ли обновление
  fetch(new URL('../../manifest.json', import.meta.url)).then(r => r.json()).then(j => { version = String(j?.version ?? ''); if (shell.isOpen) render(); }).catch(() => { /* версия не показывается */ });
  let testNote = '';
  let modelNames = [];
  let tab = 'main';           // 'main': основные настройки, 'data': данные (что уходит модели, запросы, ошибки)
  let boundNames = null;      // лорбуки, привязанные к чату и персонажу (подгружаются при открытии вкладки)

  const fateFlag = (key, label) => `<label class="sj-chk"><input type="checkbox" data-fate="${key}" ${settings.fate[key] ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  // нужна хотя бы одна точка входа: строка сцены или кнопка «К». Последнюю включённую выключить нельзя.
  const lockedFlag = key => (key === 'strip' && settings.hub === false) || (key === 'hub' && settings.strip === false);
  const LOCK_HINT = 'нельзя выключить: нужна хотя бы одна из двух, строка сцены или кнопка «К»';
  const flag = (key, label) => `<label class="sj-chk${lockedFlag(key) ? ' locked' : ''}"${lockedFlag(key) ? ` title="${LOCK_HINT}"` : ''}><input type="checkbox" data-flag="${key}" ${settings[key] ? 'checked' : ''} ${lockedFlag(key) ? 'disabled' : ''}><span>${esc(label)}</span></label>`;

  const fateFlagsHtml = () => `${fateFlag('includePersona', 'Случайные события могут задеть персону')}${fateFlag('lethal', 'Допускать тяжёлые раны (по умолчанию не выше «ранен»)')}${fateFlag('avoidRepeat', 'Кубик интима не повторяет недавние варианты')}${fateFlag('autoMode', 'Режим «Бой» включается сам, когда в тексте боевые действия (напали, обнажил оружие, засада), а не от криков и тревоги')}${fateFlag('diceCheck', 'Броски d20: рассказчик сам просит бросок, когда исход зависит от удачи (уворот, обман, скрытность), кроме интимных сцен')}${fateFlag('autoWound', '…и при неудаче рана персоне записывается сама (с отменой)')}`;

  const timeHtml = () => `<label class="sj-chk"><input type="checkbox" data-flag="autoStep" ${settings.autoStep ? 'checked' : ''}><span>Время идёт само: каждый ответ прибавляет</span><input type="number" data-num="stepMinutes" min="0" max="1440" value="${settings.stepMinutes}" aria-label="минут на ответ" style="width:64px"><span>мин.</span></label>
<label class="sj-chk"><span>Напряжение остывает на ступень каждые</span><input type="number" data-num="tensionDecay" min="0" max="20" value="${settings.tensionDecay}" aria-label="ответов до остывания" style="width:64px"><span>отв. (0 = не остывает)</span></label>`;

  const sizesHtml = info => {
    const cards = shared.cards?.get();
    return `<div class="sj-sub" style="margin-bottom:8px">Сейчас уходит: блок сцены около ${Math.round((info.block ?? '').length / 3)} ток.${cards?.hasChat ? `, анкеты около ${cards.sentTokens} ток.` : ''}</div>`;
  };
  const budgetsHtml = () => `<div class="sj-lbl" style="margin-top:14px">Вес промпта (знаков; токенов примерно треть)</div>
<label class="sj-chk"><span>Отношения</span><input type="number" data-budget="relationsBudget" min="500" max="12000" step="250" value="${settings.relationsBudget}" style="width:90px"><span>тайны</span><input type="number" data-budget="knowledgeBudget" min="300" max="8000" step="250" value="${settings.knowledgeBudget}" style="width:90px"></label>
<label class="sj-chk"><span>Бюджет анкет в запросе</span><input type="number" data-num="cardsBudget" min="1000" max="40000" step="500" value="${settings.cardsBudget}" aria-label="знаков" style="width:90px"><span>знаков (около трети от этого в токенах)</span></label>`;

  function kulisyHtml() {
    const plan = scene()?.previewKulisy?.();
    if (!plan || plan.missing) return '';
    const head = '<div class="sj-lbl" style="margin-top:18px">Перенос из Кулис</div>';
    if (!plan.ok) return `${head}<div class="sj-sub">${esc(plan.warnings.join('; '))}</div>`;
    const w = plan.weather;
    const parts = [
      plan.dateText ? `${plan.dateText}${plan.minutes !== null ? ', ' + formatTime(plan.minutes) : ''}` : '', plan.place,
      w ? describeWeather({ kind: w.kind, tempC: w.tempC, text: w.text }) : '',
      plan.tension ? `напряжение ${plan.tension.level}/4 (накал ${plan.tension.heat})` : '', plan.cast.length ? `в кадре: ${plan.cast.length}` : '',
    ].filter(Boolean);
    return `${head}<div class="sj-sub">У Кулис в этом чате: ${esc(parts.join(' · ') || 'ничего подходящего')}${plan.quests.length ? ` · квестов: ${plan.quests.length} (переносятся в окне «Журнал»)` : ''}</div>
      ${plan.warnings.length ? `<div class="sj-sub" style="color:#d98a4a">${esc(plan.warnings.join('; '))}</div>` : ''}
      <button class="sj-btn sj-pri" data-act="import" style="margin-top:6px">Перенести сюда</button>${importNote ? `<div class="sj-sub" style="margin-top:4px">${esc(importNote)}</div>` : ''}`;
  }


  /** Блок «Архивариус»: подключение вспомогательной модели и что разбирать. */
  function chronicleHtml() {
    const ch = shared.chronicle?.get();
    const aux = settings.aux, cfg = settings.chronicle;
    const profiles = (ch?.profiles ?? []).map(p => `<option value="${esc(p.id)}"${p.id === aux.profileId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    const mode = ['off', 'profile', 'custom'].map(m => `<option value="${m}"${aux.mode === m ? ' selected' : ''}>${{ off: 'выключен', profile: 'профиль подключения Таверны', custom: 'свой адрес (OpenAI-совместимый)' }[m]}</option>`).join('');
    const fields = aux.mode === 'profile'
      ? `<label class="sj-row">Профиль<select data-aux="profileId"><option value="">— выберите —</option>${profiles}</select></label>`
      : aux.mode === 'custom'
        ? `<label class="sj-row">Адрес<input data-aux="url" value="${esc(aux.url)}" placeholder="https://…/v1"></label>
           <label class="sj-row">Ключ<input data-aux="key" type="password" value="${esc(aux.key)}" placeholder="ключ API" autocomplete="off"></label>
           <label class="sj-row">Модель<input data-aux="model" value="${esc(aux.model)}" placeholder="название модели" list="sj-models"></label><datalist id="sj-models">${modelNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
           <button class="sj-btn" data-act="models" style="margin-bottom:8px">Загрузить список моделей</button>` : '';
    return `<div class="sj-lbl">Архивариус</div>
      <div class="sj-sub" style="margin-bottom:6px">Малые запросы на вспомогательной модели после ответа рассказчика. Сам ничего не записывает: предлагает, ты нажимаешь «Записать».</div>
      <label class="sj-row">Вспомогательная модель<select data-aux="mode">${mode}</select></label>${fields}
      ${aux.mode !== 'off' ? `<label class="sj-chk"><span>Лимит ответа</span><input type="number" data-aux="maxTokens" min="256" max="32000" value="${aux.maxTokens}" style="width:80px"><span>токенов (с запасом под рассуждения)</span></label>
      <label class="sj-chk"><input type="checkbox" data-auxflag="fallbackToMain" ${aux.fallbackToMain ? 'checked' : ''}><span>Если не ответила, спросить основную модель чата</span></label>
      <div class="sj-add"><button class="sj-btn sj-pri" data-act="test">Проверить связь</button><button class="sj-btn" data-act="copykulisy" title="Взять подключение из настроек Кулис">Взять из Кулис</button></div>
      <div class="sj-sub" id="sj-testres">${esc(testNote)}</div>` : '<button class="sj-btn" data-act="copykulisy" title="Взять подключение из настроек Кулис">Взять подключение из Кулис</button>'}
      <label class="sj-row">Сколько запросов на ответ<select data-chronsel="requestMode"><option value="single"${cfg.requestMode === 'single' ? ' selected' : ''}>один (самый экономный, ответ длиннее)</option><option value="grouped"${(cfg.requestMode ?? 'grouped') === 'grouped' ? ' selected' : ''}>два (люди и мир)</option><option value="split"${cfg.requestMode === 'split' ? ' selected' : ''}>по запросу на задачу (до восьми, точнее)</option></select></label>
      <label class="sj-chk"><span>Пауза между запросами</span><input type="number" data-aux="minGapMs" min="0" max="20000" step="100" value="${aux.minGapMs ?? 1200}" style="width:80px"><span>мс (при «too many requests» запрос повторяется сам)</span></label>
      <label class="sj-chk" style="margin-top:8px"><input type="checkbox" data-chron="auto" ${cfg.auto ? 'checked' : ''}><span>Разбирать каждый ответ сам (фильтры отсекают пустые)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="journal" ${cfg.journal ? 'checked' : ''}><span>Задача «журнал»: записи, зацепки, новые квесты</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="scene" ${cfg.scene ? 'checked' : ''}><span>Задача «кто в кадре»: приход и уход людей по тексту</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="newToCards" ${cfg.newToCards ? 'checked' : ''}><span>Новых героев сразу добавлять в анкеты (второстепенные, с пустым описанием)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="autoApplyScene" ${cfg.autoApplyScene ? 'checked' : ''}><span>Менять состав сцены сразу, без подтверждения (можно отменить)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="autoApplyRelations" ${cfg.autoApplyRelations ? 'checked' : ''}><span>Менять отношения сразу, без подтверждения (можно отменить)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="items" ${cfg.items ? 'checked' : ''}><span>Задача «вещи»: кто что взял, отдал, потерял</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="itemsAlways" ${cfg.itemsAlways ? 'checked' : ''}><span>Искать вещи в каждом ответе (полнее, но на один запрос больше)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="autoApplyItems" ${cfg.autoApplyItems ? 'checked' : ''}><span>Менять вещи сразу, без подтверждения (можно отменить)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="body" ${cfg.body ? 'checked' : ''}><span>Задача «приметы и раны»: следы, мокрая одежда, ссадины, раны</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="autoApplyBody" ${cfg.autoApplyBody ? 'checked' : ''}><span>Менять приметы и раны сразу, без подтверждения (можно отменить)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="place" ${cfg.place ? 'checked' : ''}><span>Задача «место»: где сцена, новые места, находки и перемены</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="autoApplyPlace" ${cfg.autoApplyPlace ? 'checked' : ''}><span>Менять место сразу, без подтверждения (можно отменить)</span></label>
      ${FEATURES.secrets ? `<label class="sj-chk"><input type="checkbox" data-chron="know" ${cfg.know ? 'checked' : ''}><span>Задача «знания»: кто что узнал, знакомства, гибель</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="autoApplyKnow" ${cfg.autoApplyKnow ? 'checked' : ''}><span>Менять знания сразу, без подтверждения (можно отменить)</span></label>` : ''}
      <label class="sj-chk"><input type="checkbox" data-chron="autoApplyJournal" ${cfg.autoApplyJournal ? 'checked' : ''}><span>Вносить записи и зацепки в журнал сразу (новые квесты только по подтверждению)</span></label>
      <label class="sj-chk"><input type="checkbox" data-chron="relations" ${cfg.relations ? 'checked' : ''}><span>Задача «отношения»: сдвиги шкал и воспоминания</span></label>`;
  }

  function chatHtml(info) {
    const tavern = String(globalThis.SillyTavern?.getContext?.().name1 ?? '').trim();
    const bound = info.cast.find(p => p.persona);
    const wrong = Boolean(bound && info.personaMismatch) || Boolean(bound && tavern && tavern.toLowerCase() !== bound.name.toLowerCase() && !(info.relations.people.find(x => x.id === bound.id)?.aliases ?? []).some(a => a.toLowerCase() === tavern.toLowerCase()));
    const persona = `<div class="sj-lbl">Персона этого чата</div>
      <div class="sj-sub" style="margin-bottom:6px">Привязана: <b>${bound ? esc(bound.name) : 'не привязана'}</b> · в Таверне сейчас: <b>${tavern ? esc(tavern) : 'не выбрана'}</b>${wrong ? ' · <span style="color:#d98a4a">не совпадает: лорбук персоны и её отношения не читаются, анкеты и чувства персоны не меняются</span>' : ''}</div>
      <label class="sj-row">Персона этого чата<select data-pbind="1" aria-label="Персона чата"><option value="">${bound ? 'выбрать другую…' : 'выбрать…'}</option>${info.cast.filter(p => !p.persona).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      <div class="sj-add"><button class="sj-btn${bound ? '' : ' sj-pri'}" data-act="pbind" title="Привязать к этому чату персону, выбранную в Таверне сейчас">Привязать текущую персону Таверны${tavern ? ` («${esc(tavern)}»)` : ''}</button></div>`;
    return `${persona}<div class="sj-lbl" style="margin-top:14px">Этот чат</div>
      ${kulisyHtml()}`;
  }

  const isMobile = () => Boolean(document.documentElement.dataset.sjMobile);
  let page = '';              // телефон: открытый раздел настроек ('' = список разделов)
  const flagsOf = items => items.map(([k, l]) => flag(k, l)).join('');

  /** Телефон: строки настроек: короткое название, пояснение и переключатель справа. */
  const attrOf = { flag: 'data-flag', fate: 'data-fate', chron: 'data-chron', aux: 'data-auxflag' };
  const valueOf = (kind, key) => (kind === 'flag' ? settings[key] : kind === 'fate' ? settings.fate?.[key] : kind === 'chron' ? settings.chronicle?.[key] : settings.aux?.[key]);
  const trow = (kind, key, title, hint = '') => {
    const locked = kind === 'flag' && lockedFlag(key);
    return `<label class="sj-trow${locked ? ' locked' : ''}"><span class="tx">${esc(title)}${locked ? `<small>${LOCK_HINT}</small>` : hint ? `<small>${esc(hint)}</small>` : ''}</span><input type="checkbox" ${attrOf[kind]}="${key}" ${valueOf(kind, key) ? 'checked' : ''} ${locked ? 'disabled' : ''}></label>`;
  };
  const STEPS = { stepMinutes: [0, 1440, 5], tensionDecay: [0, 20, 1], relationsBudget: [500, 12000, 250], knowledgeBudget: [300, 8000, 250], cardsBudget: [1000, 40000, 500] };
  const stepRow = (key, title, hint = '') => `<div class="sj-trow"><span class="tx">${esc(title)}${hint ? `<small>${esc(hint)}</small>` : ''}</span><span class="sj-step"><button type="button" data-step="${key}" data-d="-1" aria-label="Меньше">−</button><b>${settings[key]}</b><button type="button" data-step="${key}" data-d="1" aria-label="Больше">+</button></span></div>`;
  const group = (title, rows, note = '') => `<div class="sj-sgrp">${title ? `<div class="gh">${esc(title)}</div>` : ''}${rows}${note ? `<div class="sj-snote">${esc(note)}</div>` : ''}</div>`;

  function mobileSections(info) {
    const setup = '<div class="sj-add" style="margin-bottom:8px"><button class="sj-btn" data-act="setup" title="Персона, мир и первый день, лорбуки: пошаговая настройка">Мастер первой настройки</button></div>';
    const connect = chronicleHtml().split('<label class="sj-chk" style="margin-top:8px">')[0];
    const tasks = [['auto', 'Разбирать каждый ответ', 'фильтры отсекают пустые'], ['journal', 'Журнал', 'записи, зацепки, новые квесты'], ['scene', 'Кто в кадре', 'приход и уход людей по тексту'], ['newToCards', 'Новых героев в анкеты', 'сразу, второстепенными, с пустым описанием'], ['relations', 'Отношения', 'сдвиги шкал и воспоминания'], ['items', 'Вещи', 'кто что взял, отдал, потерял'], ['body', 'Приметы и раны', 'следы, мокрая одежда, ссадины, раны'], ['place', 'Место', 'где сцена, находки и перемены']];
    if (FEATURES.secrets) tasks.push(['know', 'Знания', 'кто что узнал, знакомства, гибель']);
    const applyNow = [['autoApplyScene', 'Состав сцены'], ['autoApplyRelations', 'Отношения'], ['autoApplyItems', 'Вещи'], ['autoApplyBody', 'Приметы и раны'], ['autoApplyPlace', 'Место'], ['autoApplyJournal', 'Записи журнала', 'новые квесты только по подтверждению']];
    if (FEATURES.secrets) applyNow.splice(5, 0, ['autoApplyKnow', 'Знания']);
    return [
      { id: 'sections', icon: '▦', title: 'Разделы', sub: 'что показывать в меню «К»', keys: 'разделы меню журнал карта скрыть отключить', html: `${group('Меню', trow('flag', 'hub', 'Кнопка «К» с меню', 'без неё разделы открываются из шторки над полем ввода'))}${group('Показывать в меню', `${trow('flag', 'showJournal', 'Журнал', 'квесты, зацепки, записи')}${trow('flag', 'showMap', 'Карта', 'места, приметы, перемены')}`, 'Выключенный раздел пропадает из меню. Данные остаются, их можно вернуть тумблером.')}` },
      { id: 'look', icon: '◐', title: 'Внешний вид', sub: 'цвет окон, строка сцены', keys: 'цвет палитра тема строка счётчик дней телефонный вид мобильный',
        html: `${group('Телефонный вид', mobileSelect())}${group('Цвет окон', themesHtml())}${group('Строка сцены', `${trow('flag', 'strip', 'Строка у поля ввода', 'время, дата и режим над полем ввода')}${trow('flag', 'dayCounter', 'Счётчик дней', 'Д1, Д2… в шторке строки')}`)}` },
      { id: 'teller', icon: '✉', title: 'Что видит рассказчик', sub: 'какие блоки уходят в запрос', keys: 'рассказчик запрос блок время место праздник квесты кадр отношения тайны анкеты раны вещи погода напряжение карточка правила вес бюджет токены',
        html: `${sizesHtml(info)}${group('Мир', `${trow('flag', 'sendBlock', 'Время и место', 'дата, время суток, где сцена')}${trow('flag', 'sendHolidays', 'Праздник дня')}${trow('flag', 'sendQuests', 'Идущие квесты')}${trow('flag', 'sendWeather', 'Погода')}${trow('flag', 'sendTension', 'Напряжение', 'на «спокойно» не отправляется')}`)}${group('Люди', `${trow('flag', 'sendCast', 'Кто в кадре')}${trow('flag', 'sendRelations', 'Отношения', 'только тех, кто в кадре')}${trow('flag', 'sendCards', 'Анкеты', 'заменяют записи лорбука')}${trow('flag', 'sendBody', 'Состояние и раны', 'тех, кто в кадре')}${trow('flag', 'sendInventory', 'Вещи', 'тех, кто в кадре')}${FEATURES.secrets ? trow('flag', 'sendKnowledge', 'Тайны', 'кто что знает, знакомства, погибшие') : ''}`)}${group('Сцена', `${FEATURES.fate ? trow('flag', 'sendFate', 'd20 жизни', 'режим, подсказки, броски') : ''}${trow('flag', 'sendPlaces', 'Карточка места')}${trow('flag', 'shortRules', 'Краткие правила', 'легче промпт на ~550 токенов, но правила короче')}`)}${group('Вес запроса, знаков', `${stepRow('relationsBudget', 'Отношения')}${FEATURES.secrets ? stepRow('knowledgeBudget', 'Тайны') : ''}${stepRow('cardsBudget', 'Анкеты', 'токенов примерно треть')}`)}` },
      { id: 'arch', icon: '✎', title: 'Архивариус', sub: 'вспомогательная модель, что разбирать', keys: 'архивариус модель запросы профиль ключ задачи журнал отношения вещи раны место',
        html: `${group('Подключение', connect)}${group('Что разбирать по тексту', tasks.map(([k, t, h]) => trow('chron', k, t, h)).join('') + trow('chron', 'itemsAlways', 'Искать вещи в каждом ответе', 'полнее, но на один запрос больше'))}${group('Применять сразу, без подтверждения', applyNow.map(([k, t, h]) => trow('chron', k, t, h)).join(''), 'Любое изменение можно отменить.')}` },
      { id: 'time', icon: '◷', title: 'Время и погода', sub: 'шаг времени, погода, напряжение', keys: 'время погода напряжение шаг остывает',
        html: `${group('Время', `${trow('flag', 'autoStep', 'Время идёт само', 'каждый ответ прибавляет минуты')}${stepRow('stepMinutes', 'Минут за ответ')}`)}${group('Погода', `${trow('flag', 'weather', 'Погода по сезону и климату')}${trow('flag', 'weatherFromText', 'Менять по тексту', '«пошёл дождь»')}`)}${group('Напряжение', `${trow('flag', 'tension', 'Шкала напряжения')}${trow('flag', 'tensionFromText', 'Сдвигать по тексту')}${stepRow('tensionDecay', 'Остывает за, ответов', '0: не остывает')}`)}` },
      FEATURES.fate ? { id: 'd20', icon: D20_SVG, title: 'd20 жизни', sub: 'события, раны, броски', keys: 'd20 кубик броски раны события бой интим',
        html: group('Броски и события', `${trow('fate', 'diceCheck', 'Проверки d20', 'рассказчик сам просит бросок, кроме интимных сцен')}${trow('fate', 'autoWound', 'Рана при неудаче', 'записывается сама, с отменой')}${trow('fate', 'includePersona', 'События могут задеть персону')}${trow('fate', 'lethal', 'Тяжёлые раны', 'по умолчанию не выше «ранен»')}`) + group('Режимы', `${trow('fate', 'autoMode', 'Бой включается сам', 'по боевым действиям в тексте')}${trow('fate', 'avoidRepeat', 'Интим без повторов', 'кубик не повторяет недавние варианты')}`) } : null,
      { id: 'chat', icon: '⚑', title: 'Этот чат', sub: 'персона, лорбуки, перенос', keys: 'чат персона лорбуки кулисы перенос мастер',
        html: `${setup}${chatHtml(info)}${group('Лорбуки', `${boundHtml().split('<label class="sj-chk">')[0]}${trow('flag', 'cardsOnlyBound', 'Только привязанные лорбуки', 'рекомендуется')}${trow('flag', 'personaBookStrict', 'Лорбук персоны только с привязанной персоной')}`)}` },
      { id: 'data', icon: '≡', title: 'Запросы и ошибки', sub: 'что ушло модели, журнал', keys: 'запросы ошибки журнал диагностика отправлено', html: `${sentHtml(info, settings, shared)}<div style="height:14px"></div>${changesHtml(info)}<div style="height:14px"></div>${diagnosticsHtml(shared)}` },
    ].filter(Boolean);
  }

  function renderMobile(info) {
    const sections = mobileSections(info);
    const cur = sections.find(x => x.id === page);
    if (!cur) page = '';
    const close = '<button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button>';
    if (!cur) {
      win.innerHTML = `<div class="sj-wh"><h2>Настройки</h2><span class="sj-sub">Кадр${version ? `, версия ${esc(version)}` : ''}</span>${close}</div>
        <div class="sj-smob"><input class="sj-ssearch" data-ssearch type="search" placeholder="Найти настройку" aria-label="Найти настройку" autocomplete="off">
        <div class="sj-slist">${sections.map(x => `<button type="button" class="sj-srow" data-spage="${x.id}" data-keys="${esc(`${x.title} ${x.sub} ${x.keys}`.toLowerCase())}"><span class="ic">${x.icon}</span><span class="tx"><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></span><span class="go">›</span></button>`).join('')}</div>
        <div class="sj-sub" data-snone hidden>Ничего не найдено.</div>
        <div class="sj-lbl" style="margin-top:18px">Быстро</div>${group('', `${FEATURES.fate ? trow('fate', 'diceCheck', 'Проверки d20', 'рассказчик сам просит бросок') : ''}${trow('flag', 'strip', 'Строка сцены', 'над полем ввода')}${trow('flag', 'hub', 'Кнопка «К»', 'меню разделов')}${trow('chron', 'auto', 'Архивариус разбирает ответы')}`)}</div>`;
      return;
    }
    win.innerHTML = `<div class="sj-wh"><button class="sj-btn sj-back" data-spage="" aria-label="К разделам">‹</button><h2>${esc(cur.title)}</h2>${close}</div><div class="sj-smob">${cur.html}</div>`;
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    shell.theme(info.state.calendar);
    if (isMobile()) { renderMobile(info); return; }
    const tabs = `<div class="sj-filters" style="padding:0 18px 4px"><button class="sj-tab" data-stab="main" aria-pressed="${tab === 'main'}">Основные настройки</button><button class="sj-tab" data-stab="data" aria-pressed="${tab === 'data'}">Данные</button></div>`;
    win.innerHTML = `<div class="sj-wh"><h2>Настройки</h2><span class="sj-sub">Кадр${version ? `, версия ${esc(version)}` : ''}</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>${tabs}
      <div class="sj-sbody">${tab === 'data' ? dataHtml(info) : mainHtml(info)}</div>`;
  }

  const mobileSelect = () => `<label class="sj-row">Телефонный вид<select data-mmode aria-label="Телефонный вид">${[['auto', 'Сам: по экрану и устройству'], ['on', 'Всегда включён'], ['off', 'Выключен']].map(([v, ru]) => `<option value="${v}"${mobileMode() === v ? ' selected' : ''}>${ru}</option>`).join('')}</select></label><div class="sj-sub" style="margin:-4px 0 10px">Если телефонный вид не включился сам (например, браузер на телефоне открыт как «версия для компьютера»), выберите «Всегда включён».</div>`;

  function themesHtml() {
    const cur = getTheme();
    const vars = p => `--p:${p.panel};--p2:${p.panel2};--l:${p.line};--t:${p.text};--m:${p.muted};--a:${p.accent}`;
    const mock = '<span class="sj-pal-mock"><i></i><b></b><b></b><u></u></span>';
    const card = (id, name, sub, p) => `<button type="button" class="sj-pal${cur === id ? ' on' : ''}" role="radio" aria-checked="${cur === id}" data-theme="${id}" style="${vars(p)}">${mock}<span class="sj-pal-name">${esc(name)}</span><span class="sj-pal-sub">${esc(sub)}</span><span class="sj-pal-ck" aria-hidden="true">✓</span></button>`;
    const customP = paletteOf(CUSTOM);
    const themes = `<div class="sj-lbl">Цвет окон</div><div class="sj-sub" style="margin-bottom:8px">По умолчанию окна красятся в цвета мира. Выбранная здесь палитра перекрывает их во всех мирах, и пульт со строкой сцены красятся так же.</div>
        <div class="sj-pals" role="radiogroup" aria-label="Цвет окон">
          <button type="button" class="sj-pal world${cur === '' ? ' on' : ''}" role="radio" aria-checked="${cur === ''}" data-theme="" style="--p:#1d1a16;--p2:#26221c;--l:#4a4036;--t:#eee;--m:#aaa;--a:#c8a24a"><span class="sj-pal-mock"><i></i><b></b><b></b><u></u></span><span class="sj-pal-name">По миру</span><span class="sj-pal-sub">цвет мира чата</span><span class="sj-pal-ck" aria-hidden="true">✓</span></button>
          ${themeList().map(x => card(x.id, x.ru, x.world, x)).join('')}
          <div class="sj-pal custom${cur === CUSTOM ? ' on' : ''}" role="radio" tabindex="0" aria-checked="${cur === CUSTOM}" data-theme="${CUSTOM}" style="${vars(customP)}">${mock}<span class="sj-pal-name">Свой цвет</span>
            <label class="sj-pal-pick" title="Выбрать цвет"><input type="color" data-themecolor value="${esc(getColor())}" aria-label="Свой цвет"><span data-themehex>${esc(getColor())}</span></label><span class="sj-pal-ck" aria-hidden="true">✓</span></div>
        </div>`;
    return themes;
  }

  /** Основные настройки: слева как расширение работает, справа модель Архивариуса, лорбуки, персона и чат. */
  function mainHtml(info) {
    const themes = themesHtml();
    return `<div class="sj-scol">
        ${mobileSelect()}
        <div class="sj-add" style="margin-bottom:10px"><button class="sj-btn" data-act="setup" title="Персона, мир и первый день, лорбуки: пошаговая настройка">Мастер первой настройки</button></div>
        ${themes}
        ${MAIN_GROUPS.map(([title, items]) => `<div class="sj-lbl" style="margin-top:10px">${title}</div>${items.map(([k, l]) => flag(k, l)).join('')}`).join('')}
        ${FEATURES.fate ? `<div class="sj-lbl" style="margin-top:10px">d20 жизни</div>${fateFlagsHtml()}` : ''}
        <div class="sj-lbl" style="margin-top:10px">Время и напряжение</div>
        ${timeHtml()}
        ${boundHtml()}
      </div><div class="sj-scol">${chronicleHtml()}<div style="height:14px"></div>${chatHtml(info)}</div>`;
  }

  /** Лорбуки, привязанные к чату и персонажу: только их читает расширение. */
  function boundHtml() {
    const list = boundNames === null ? '<div class="sj-sub">Определяю…</div>'
      : boundNames.length ? `<div class="sj-chips2" style="margin-bottom:8px">${boundNames.map(n => `<span class="sj-chip2">${esc(n)}</span>`).join('')}</div>`
        : '<div class="sj-sub" style="margin-bottom:8px">К этому чату и персонажу лорбуки не привязаны (или определить не удалось).</div>';
    return `<div class="sj-lbl" style="margin-top:14px">Привязанные лорбуки</div>
      <div class="sj-sub" style="margin-bottom:6px">Анкеты, тайны и импорт берут тексты только из этих лорбуков: основной и вспомогательные персонажа, лорбук чата, глобальные.</div>${list}
      ${flag('cardsOnlyBound', 'Читать только привязанные лорбуки (рекомендуется)')}
      ${flag('personaBookStrict', 'Лорбук персоны читается, только если в чат вошла привязанная к чату персона')}
      `;
  }

  /** Данные: что уходит модели (по блокам, с весом) и запросы с ошибками. */
  function dataHtml(info) {
    const sizes = sizesHtml(info);
    return `<div class="sj-scol">
        ${DATA_GROUPS.map(([title, items]) => `<div class="sj-lbl" style="margin-top:10px">${title}</div>${sizes}${items.filter(([k]) => (k !== 'sendKnowledge' || FEATURES.secrets) && (k !== 'sendFate' || FEATURES.fate)).map(([k, l]) => flag(k, l)).join('')}`).join('')}
        ${budgetsHtml()}
      </div><div class="sj-scol">${sentHtml(info, settings, shared)}<div style="height:14px"></div>${changesHtml(info)}<div style="height:14px"></div>${diagnosticsHtml(shared)}</div>`;
  }

  const clampNum = (key, raw) => (key === 'cardsBudget' ? Math.min(Math.max(Math.round(Number(raw) || 12000), 1000), 40000) : Math.min(Math.max(Math.round(Number(raw) || 0), 0), key === 'stepMinutes' ? 1440 : 20));
  const onChange = event => {
    const el = event.target;
    try {
      if (el.dataset?.themecolor !== undefined) { settings.themeColor = el.value; settings.theme = CUSTOM; deps.save?.(); return; }
      if (el.dataset?.mmode !== undefined) { settings.mobileMode = el.value; deps.save?.(); syncMobile(); render(); return; }
      if (el.dataset.budget) { const lim = el.dataset.budget === 'relationsBudget' ? [500, 12000] : [300, 8000]; scene().setSetting(el.dataset.budget, Math.min(Math.max(Math.round(Number(el.value) || lim[0]), lim[0]), lim[1])); }
      else if (el.dataset.aux) {
        const key = el.dataset.aux;
        shared.chronicle.setAux({ [key]: key === 'maxTokens' ? Math.min(Math.max(Math.round(Number(el.value) || 4096), 256), 32000) : key === 'minGapMs' ? Math.min(Math.max(Math.round(Number(el.value) || 0), 0), 20000) : el.value.trim() });
        if (key === 'mode') render();
      } else if (el.dataset.fate) { settings.fate[el.dataset.fate] = el.checked; deps.save(); }
      else if (el.dataset.chronsel) shared.chronicle.setChronicle({ [el.dataset.chronsel]: el.value });
      else if (el.dataset.auxflag) shared.chronicle.setAux({ [el.dataset.auxflag]: el.checked });
      else if (el.dataset.chron) shared.chronicle.setChronicle({ [el.dataset.chron]: el.checked });
      else if (el.dataset.flag) {
        const key = el.dataset.flag;
        // страховка: нельзя остаться и без строки сцены, и без кнопки «К»
        if (!el.checked && ((key === 'strip' && settings.hub === false) || (key === 'hub' && settings.strip === false))) { el.checked = true; return; }
        scene().setSetting(key, el.checked);
        if (key === 'strip' || key === 'hub') render();
      }
      else if (el.dataset.num) scene().setSetting(el.dataset.num, clampNum(el.dataset.num, el.value));
      else if (el.dataset?.pbind !== undefined) { if (el.value) shared.scene?.setPersona(el.value); render(); }
    } catch (error) { report('настройки', error); }
  };
  const onClick = event => {
    const stp = event.target.closest('[data-step]');
    if (stp) {
      const key = stp.dataset.step, [lo, hi, st] = STEPS[key];
      const next = Math.min(Math.max(Math.round((Number(settings[key]) || 0) + Number(stp.dataset.d) * st), lo), hi);
      try { scene().setSetting(key, next); } catch (error) { report('настройки', error); }
      render();
      return;
    }
    const sp = event.target.closest('[data-spage]');
    if (sp) { page = sp.dataset.spage; render(); win.parentElement?.scrollTo?.(0, 0); if (page === 'chat') loadBound(); return; }
    const th = event.target.closest('[data-theme]');
    if (th) {
      settings.theme = th.dataset.theme;
      setTheme(settings.theme, settings.themeColor);
      try { deps.save?.(); } catch { /* сохранится при следующей записи */ }
      applyTheme();
      // клик по самому цветовому полю не перерисовывает окно: иначе выбор цвета закрылся бы, не открывшись
      if (event.target.closest('[data-themecolor]')) { markPalette(); return; }
      render(); return;
    }
    const st = event.target.closest('[data-stab]');
    if (st) { tab = st.dataset.stab; render(); if (tab === 'main') loadBound(); return; }
    const undo = event.target.closest('[data-undo]');
    if (undo) { scene().revertLog(undo.dataset.undo); render(); return; }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return shell.close();
    if (act === 'setup') { shell.close(); shared.ui?.openSetup?.(); return; }
    if (act === 'pbind') { shared.scene?.switchPersona(); return render(); }
    if (act === 'test') {
      const out = q('#sj-testres');
      out.textContent = 'Проверяю…';
      shared.chronicle.test().then(r => { testNote = r.ok ? `Связь есть (${(r.ms / 1000).toFixed(1)} с): «${r.text}»` : `Не вышло: ${r.text}`; const el = q('#sj-testres'); if (el) el.textContent = testNote; });
      return;
    }
    if (act === 'models') {
      shared.chronicle.models().then(list => { modelNames = list; testNote = `Моделей найдено: ${list.length}`; render(); }).catch(e => { testNote = `Список не получен: ${e?.message ?? e}`; render(); });
      return;
    }
    if (act === 'copykulisy') { testNote = shared.chronicle.copyFromKulisy() ? 'Подключение взято из Кулис. Нажмите «Проверить связь».' : 'В настройках Кулис вспомогательная модель не задана.'; render(); return; }
    if (act === 'import') {
      const r = scene().importFromKulisy();
      importNote = r.ok ? `Перенесено: ${r.applied.join(', ') || 'ничего'}.` : `Не вышло: ${r.warnings.join('; ')}`;
      render();
    }
  };
  const q = sel => win.querySelector(sel);
  /** Подгружает список привязанных лорбуков (служба анкет знает, какие привязаны) и перерисовывает вкладку. */
  function loadBound() {
    boundNames = null;
    const pending = shared.cards?.boundBooks?.();
    if (!pending) { boundNames = []; return; }
    pending.then(list => { boundNames = list ?? ['все лорбуки (ограничение снято)']; if (shell.isOpen && (isMobile() ? page === 'chat' : tab === 'main')) render(); }).catch(() => { boundNames = []; });
  }
  /** Подсветка выбранной карточки без перерисовки окна. */
  const markPalette = () => { const cur = getTheme(); for (const el of win.querySelectorAll('[data-theme]')) { const on = el.dataset.theme === cur; el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); } };
  /** «Свой цвет»: пока тянут по палитре, краска меняется вживую, окно не перерисовывается. */
  const onInput = event => {
    const sq = event.target.closest?.('[data-ssearch]');
    if (sq) {
      const v = sq.value.trim().toLowerCase();
      let shown = 0;
      for (const row of win.querySelectorAll('.sj-srow')) { const hit = !v || row.dataset.keys.includes(v); row.hidden = !hit; if (hit) shown += 1; }
      const none = win.querySelector('[data-snone]');
      if (none) none.hidden = shown > 0;
      return;
    }
    const el = event.target.closest?.('[data-themecolor]');
    if (!el) return;
    settings.themeColor = el.value; settings.theme = CUSTOM;
    setTheme(CUSTOM, el.value); applyTheme();
    const card = el.closest('.sj-pal'), p = paletteOf(CUSTOM);
    card.style.cssText = `--p:${p.panel};--p2:${p.panel2};--l:${p.line};--t:${p.text};--m:${p.muted};--a:${p.accent}`;
    const hex = card.querySelector('[data-themehex]'); if (hex) hex.textContent = el.value;
    markPalette();
  };
  win.addEventListener('input', onInput);
  win.addEventListener('change', onChange);
  win.addEventListener('click', onClick);

  // события чата приходят по ходу игры; пока человек в окне, не перерисовываем (сбросило бы ввод)
  const unsubscribe = scene()?.subscribe(info => {
    if (!shell.isOpen) return;
    if (!info?.hasChat) return shell.close();
    if (win.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    render();
  });

  function open() {
    const info = scene()?.get();
    if (!info?.hasChat) return;
    importNote = '';
    page = '';
    shell.show(info.state.calendar);
    render();
    loadBound();
    win.focus();
  }

  // на вкладке «Данные» запросы и ошибки обновляются сами, пока не печатаешь в поле
  const timer = setInterval(() => {
    if (!shell.isOpen || (isMobile() ? page !== 'data' : tab !== 'data')) return;
    if (win.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    try { render(); } catch { /* окно закрывается */ }
  }, 3000);

  shared.ui = { ...(shared.ui ?? {}), openSettings: open, closeSettings: shell.close };
  return () => {
    unsubscribe?.();
    clearInterval(timer);
    win.removeEventListener('input', onInput);
    win.removeEventListener('change', onChange);
    win.removeEventListener('click', onClick);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openSettings; delete shared.ui.closeSettings; }
  };
}
