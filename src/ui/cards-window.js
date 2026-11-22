/**
 * Окно «Анкеты»: персонажи как анкеты с разделами и фото, собранные из лорбуков. Слева список (сколько токенов ест каждая,
 * подключена ли к этому чату, в кадре ли), справа анкета: фото, имя, псевдонимы, разделы с правилом «когда слать».
 * Открывается кнопкой в боковом меню расширений. Читает shared.cards.get(); правки идут через службу.
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { KINDS, WHEN, findDuplicates } from '../core/cards.js';
import { wikiOf, splitSections, extractFacts, articleText, parseEntries, shortLabel } from '../core/wiki.js';
import { blockState, headHash, sectionHash, titleHash } from '../core/translate.js';

const initial = name => esc(String(name).trim().charAt(0).toUpperCase());

export function startCardsWindow(deps) {
  const { shared, settings } = deps;
  const cardsApi = () => shared.cards;
  const shell = createShell({ id: 'sj-cards', label: 'Анкеты', width: 1240 });
  const { win } = shell;
  let selected = '';
  let search = '';
  let importing = null;      // { book, found: [{name, sections, chars, exists}], pick: Set } | { books: [] }
  let note = '';
  const ignored = new Set((() => { try { return JSON.parse(localStorage.getItem('sj-cards-ignored') || '[]'); } catch { return []; } })());
  const pairKey = (a, b) => [a.id, b.id].sort().join('|');
  let tier = 'main';          // вкладка: main (основные) или minor (второстепенные)
  let editHead = false;       // режим правки шапки статьи: подпись, вступление, факты
  const ruEdit = new Set();   // блоки русской версии, открытые на правку карандашиком ('head' или id раздела)
  let lang = 'en';            // вкладка анкеты: en (оригинал) или ru (русская версия, перевод вспомогательной моделью)
  const openRecs = new Set(); // разделы, у которых раскрыта «Запись модели» (переживает перерисовку)
  const PEN = (on) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${on ? '<path d="M5 12.500l4.500 4.500L19 7"/>' : '<path d="M4 20l1-4L16.500 4.500a2 2 0 0 1 3 3L8 19l-4 1zM14 7l3 3"/>'}</svg>`;
  const penBtn = (key, on) => `<button class="wk-pen${on ? ' on' : ''}" data-act="rupen" data-key="${esc(key)}" title="${on ? 'Готово' : 'Править перевод'}" aria-label="${on ? 'Готово' : 'Править перевод'}" aria-pressed="${on}">${PEN(on)}</button>`;
  const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

  const SKULL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.500c-4.600 0-8 3.200-8 7.600 0 2.600 1.200 4.400 2.800 5.500V19c0 .8.600 1.400 1.400 1.400h1.200V18h1.200v2.400h2.800V18h1.200v2.400h1.200c.8 0 1.400-.6 1.400-1.400v-3.400c1.600-1.100 2.800-2.900 2.800-5.500 0-4.400-3.400-7.600-8-7.600z" fill="currentColor"/><circle cx="8.700" cy="11.200" r="2" fill="#000"/><circle cx="15.300" cy="11.200" r="2" fill="#000"/><path d="M12 13.600l-1.100 2.300h2.200z" fill="#000"/></svg>';
  const lowName = s => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  /** Человек из реестра чата, которому принадлежит карточка: по составу сцены, по имени или по псевдониму. */
  const personOf = (c, info = shared.scene?.get()) => {      // info можно передать готовый: get() собирает всё состояние сцены, в цикле по десяткам карточек это зависание
    if (!info?.hasChat) return null;
    if (c.person) return info.people.find(p => p.id === c.person.id) ?? c.person;
    const names = [c.name, ...(c.aliases ?? [])].map(lowName);
    return info.people.find(p => names.includes(lowName(p.name))) ?? null;
  };
  const isDead = (c, info = shared.scene?.get()) => { const p = personOf(c, info); return Boolean(info?.hasChat && p && info.knowledge.deaths[p.id]); };
  const deathBtn = c => (!shared.scene?.get()?.hasChat ? '' : isDead(c)
    ? '<button class="sj-skull" data-act="undie" title="Воскресить"><span class="cross" aria-hidden="true"></span><span>воскресить</span></button>'
    : `<button class="sj-skull" data-act="die" title="Умер: уйдёт вниз списков, серый, его чувства перестанут учитываться">${SKULL}<span>умер</span></button>`);
  const photo = (card, cls = '') => card.image ? `<img class="sj-ph ${cls}" src="${esc(card.image)}" alt="${esc(card.name)}">` : `<span class="sj-ph ${cls} none" aria-hidden="true">${initial(card.name)}</span>`;

  const shown = d => d.cards;

  function sideHtml(d) {
    const q = search.trim().toLowerCase();
    const info = shared.scene?.get();      // один раз на отрисовку списка
    const pool = shown(d);
    const count = t => pool.filter(c => (c.tier ?? 'main') === t).length;
    const scope = d.hasChat ? '' : '<div class="sj-sub" style="margin-bottom:8px">Откройте чат: у каждого чата свои анкеты.</div>';
    const dups = findDuplicates(pool.filter(c => !c.idle)).filter(p => !ignored.has(pairKey(p.a, p.b))).slice(0, 4);
    const dupHtml = dups.map(p => `<div class="sj-dup"><div><b>${esc(p.a.name)}</b> и <b>${esc(p.b.name)}</b> похожи на одного персонажа (${esc(p.why)}).</div><div class="sj-add" style="margin:6px 0 0"><button class="sj-btn sj-pri" data-act="merge" data-keep="${esc(p.a.id)}" data-drop="${esc(p.b.id)}" title="Разделы, псевдонимы и фото сольются в одну карточку; имя берётся более полное">Объединить</button><button class="sj-btn" data-act="notdup" data-keep="${esc(p.a.id)}" data-drop="${esc(p.b.id)}">Это разные</button></div></div>`).join('');
    const list = pool.filter(c => (c.tier ?? 'main') === tier && (!q || c.name.toLowerCase().includes(q) || c.aliases.some(a => a.toLowerCase().includes(q))));
    const dead = new Map(list.map(c => [c.id, isDead(c, info)]));
    list.sort((a, b) => Number(dead.get(a.id)) - Number(dead.get(b.id)));   // умершие внизу списка
    const rows = list.map(c => {
      const here = Boolean(c.person?.present);
      return `<button class="sj-cardrow${c.id === selected ? ' cur' : ''}${dead.get(c.id) ? ' dead' : ''}" data-card="${esc(c.id)}">${photo(c)}<span class="n"><b>${esc(c.name)}</b><small>${dead.get(c.id) ? 'умер · ' : ''}${c.idle ? 'лорбук не привязан, не используется · ' : ''}${c.tokens} ток. · ${c.sections.length} разд.${here ? ' · в кадре' : ''}</small></span></button>`;
    }).join('');
    return `${scope}${dupHtml}<div class="sj-filters"><button class="sj-tab" data-tier="main" aria-pressed="${tier === 'main'}">Основные (${count('main')})</button><button class="sj-tab" data-tier="minor" aria-pressed="${tier === 'minor'}">Второстепенные (${count('minor')})</button></div>
      <div class="sj-add" style="margin:0 0 8px"><input data-search value="${esc(search)}" placeholder="Поиск по имени" aria-label="Поиск"></div>
      ${tier === 'main'
        ? '<button class="sj-btn sj-pri" data-act="importall" style="width:100%;margin-bottom:6px" title="Собрать анкеты в ЭТОТ чат из ВСЕХ лорбуков Таверны. Если сеттинг другой, лучше «Из одного лорбука…»">Собрать основных из всех лорбуков</button>'
        : '<button class="sj-btn sj-pri" data-act="minor" style="width:100%;margin-bottom:6px" title="Просмотреть лорбуки NPC и предложить записи «Имя (Русское имя)» как упрощённые анкеты">Собрать из NPC-лорбуков</button>'}
      <button class="sj-btn" data-act="reloadall" style="width:100%;margin-bottom:6px" title="Подтянуть из лорбуков тексты, ключи и контекст всех карточек этого чата. Новых карточек не добавляет, ваши правки ключей остаются.">Обновить все из лорбука</button>
      <div class="sj-add" style="margin:0 0 8px"><button class="sj-btn" data-act="new">+ Новая</button><button class="sj-btn" data-act="import">Из одного лорбука</button></div>
      <div class="sj-cardlist">${rows || `<div class="sj-none" style="padding:8px">${tier === 'main' ? 'Основных анкет пока нет. Нажмите «Собрать основных из всех лорбуков»: расширение найдёт записи вида «[ Имя ] - Раздел».' : 'Второстепенных пока нет. Нажмите «Собрать из NPC-лорбуков…», там можно отметить нужных.'}</div>`}</div>`;
  }

  /** Контекст: пока персонажа нет в кадре, запись уходит только если в тексте есть одно из этих слов (как вторичные ключи лорбука). */
  const ctxField = s => `<label class="wk-fl" title="Если персонажа нет в кадре, запись уйдёт только когда в последних ответах есть хотя бы одно из этих слов. Пусто: достаточно назвать имя. Каждое с новой строки; можно /регулярку/iu.">Только в контексте <textarea data-st="ctx" rows="2" placeholder="например: тифлинг, разбойник (с новой строки)" aria-label="Контекст">${esc((s.ctx ?? []).join('\n'))}</textarea></label>`;
  const RULE_CLS = { always: 'always', keys: 'keys', fight: 'fight', intim: 'intim', entrance: 'keys', pair: 'keys' };
  const ruleOf = s => s.when || (s.kind === 'biography' || s.kind === 'other' ? 'keys' : 'always');
  const rulePill = s => (s.off ? '<span class="wk-pill off">выключена</span>' : `<span class="wk-pill ${RULE_CLS[ruleOf(s)] ?? ''}">${esc(WHEN[ruleOf(s)] ?? 'по умолчанию')}</span>`);
  /** Тумблер записи: выключенная запись не уходит рассказчику (как отключённая запись лорбука). */
  const tgBtn = s => `<button type="button" class="wk-tg${s.off ? '' : ' on'}" role="switch" aria-checked="${!s.off}" data-tgsec="${esc(s.id)}" title="${s.off ? 'Запись выключена: рассказчик её не получит. Нажмите, чтобы включить.' : 'Запись включена. Нажмите, чтобы выключить: рассказчик её не получит.'}"></button>`;

  /** «Запись модели»: то, что реально уходит рассказчику; правится руками, правила и ключи рядом. */
  function recordHtml(card, s, { head = 'Запись модели' } = {}) {
    const tok = card.sectionTokens[s.id] ?? 0;
    return `<details class="wk-rec${s.off ? ' off' : ''}" data-rec="${esc(s.id)}" ${openRecs.has(s.id) ? 'open' : ''}><summary><b>${esc(head)}</b><span>${tok} ток.</span><span class="r">${rulePill(s)}</span>${head === 'Запись модели' ? '' : tgBtn(s)}</summary>
      <div class="wk-recbody" data-sec="${esc(s.id)}"><div class="sj-sub">Этот текст уходит рассказчику как запись лорбука. Статья выше только для чтения: рассказчик видит то, что написано здесь.</div>
        <textarea data-st="text" rows="${Math.min(14, Math.max(5, Math.ceil((s.text ?? '').length / 90)))}" aria-label="Текст записи">${esc(s.text)}</textarea>
        <div class="wk-recrow"><label>Раздел<input data-st="title" value="${esc(s.title)}"></label><label>Вид<select data-st="kind">${Object.entries(KINDS).map(([k, n]) => `<option value="${k}"${k === s.kind ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <label>Когда слать<select data-st="when"><option value="">по умолчанию</option>${Object.entries(WHEN).map(([k, n]) => `<option value="${k}"${k === (s.when ?? '') ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
        <label class="wk-fl">Ключи записи <textarea data-st="keys" rows="2" placeholder="слова или /регулярки/, каждый с новой строки">${esc((s.keys ?? []).join('\n'))}</textarea></label>
        ${ctxField(s)}
        <div class="wk-recrow"><button class="sj-st" data-act="delsec">удалить запись</button></div></div></details>`;
  }

  /** Тело раздела для чтения: пункты «подпись: ответ» или обычный текст; long: нужен ли «показать целиком». */
  function bodyHtml(sourceText, name) {
    const parsed = parseEntries(sourceText);
    const structured = parsed.entries.length > 0;
    const text = structured ? '' : articleText(sourceText, name);
    const long = (structured ? parsed.entries.reduce((n, e) => n + e.label.length + e.value.length, 0) + parsed.intro.length : text.length) > 700;
    const body = structured
      ? `${parsed.intro ? `<p class="wk-intro">${esc(parsed.intro)}</p>` : ''}<dl class="wk-dl">${parsed.entries.map(e => `<div class="wk-ent"><dt title="${esc(e.label)}">${esc(shortLabel(e.label))}</dt><dd>${esc(e.value || '—')}</dd></div>`).join('')}</dl>`
      : (text ? `<div class="wk-text">${esc(text)}</div>` : '<div class="sj-none">Раздел пустой.</div>');
    return { body, long };
  }

  /** Блок статьи: заголовок с номером, метки, текст, запись модели. */
  function articleSection(card, s, n) {
    const { body, long } = bodyHtml(s.text, card.name);
    return `<h3 class="wk-sec${s.off ? ' off' : ''}"><span class="num">${n}</span>${esc(s.title)}<span class="ed">[<a href="#" data-openrec="${esc(s.id)}">править</a>]</span>${tgBtn(s)}</h3>
      <div class="wk-meta">${rulePill(s)}<span class="wk-pill">${card.sectionTokens[s.id] ?? 0} ток.</span>${(s.keys ?? []).length ? `<span class="wk-pill keys" title="${esc(s.keys.join(', '))}">ключей: ${s.keys.length}</span>` : ''}${(s.ctx ?? []).length ? `<span class="wk-pill keys" title="${esc(s.ctx.join(', '))}">только в контексте</span>` : ''}</div>
      <div class="wk-body${long ? ' clip' : ''}" data-wkexpand>${body}</div>${long ? '<a href="#" class="wk-more" data-wkexpandbtn>показать целиком</a>' : ''}
      ${recordHtml(card, s)}`;
  }

  /** Название раздела по-русски: из правки перевода раздела, иначе из перевода шапки (если название не менялось), иначе оригинал. */
  const ruTitle = (card, s) => card.ru?.sections?.[s.id]?.title || (card.ru?.titles?.[s.id]?.h === titleHash(s) ? card.ru.titles[s.id].t : '') || s.title;

  /** Блок русской версии: перевод (пока блока нет, виден оригинал бледным), метки состояния, правка перевода руками. */
  function ruSection(card, s, n, d, { head = '' } = {}) {
    const e = card.ru?.sections?.[s.id];
    const st = blockState(e, sectionHash(s));
    const running = Boolean(d.translation);
    const { body, long } = bodyHtml(e?.text ?? s.text, card.name);
    const pills = `${rulePill(s)}${st === 'none' ? '<span class="wk-pill untr">не переведено</span>' : ''}${st === 'stale' ? '<span class="wk-pill stale" title="После перевода текст анкеты правили. Нажмите «перевести заново».">оригинал изменился</span>' : ''}${e?.edited ? '<span class="wk-pill">правлено вручную</span>' : ''}`;
    const act = running || !d.canTranslate ? '' : `<span class="ed">[<a href="#" data-act="trone" data-kind="section" data-id="${esc(s.id)}">${st === 'none' ? 'перевести' : 'перевести заново'}</a>]</span>`;
    const editing = ruEdit.has(s.id);
    const editor = `<div class="wk-ruedit" data-sec="${esc(s.id)}"><label class="wk-fl">Заголовок<input data-ru="title" value="${esc(e?.title || s.title)}"></label>
        <textarea data-ru="text" rows="${Math.min(16, Math.max(5, Math.ceil(((e?.text ?? s.text) ?? '').length / 80)))}" placeholder="${esc(String(s.text ?? '').slice(0, 120))}" aria-label="Текст перевода">${esc(e?.text ?? '')}</textarea>
        <div class="sj-sub">Перевод нужен для чтения. Рассказчику уходит английский текст из «Записи модели» на вкладке «Оригинал».</div></div>`;
    return `<h3 class="wk-sec${s.off ? ' off' : ''}" data-h="${esc(s.id)}">${n ? `<span class="num">${n}</span>` : ''}${esc(head || ruTitle(card, s))}<span class="wk-penbox">${penBtn(s.id, editing)}</span>${act}${tgBtn(s)}</h3>
      <div class="wk-meta">${pills}</div>
      ${editing ? editor : `<div class="wk-body${long ? ' clip' : ''}${e ? '' : ' untr'}" data-wkexpand>${body}</div>${long ? '<a href="#" class="wk-more" data-wkexpandbtn>показать целиком</a>' : ''}`}`;
  }

  /** Полоса над статьёй на вкладке «Русский»: ход перевода или подсказка. */
  function trBar(card, d, plan) {
    const t = d.translation;
    if (t) {
      const mine = t.id === card.id;
      return `<div class="wk-trbar run" role="status"><span class="dot" aria-hidden="true"></span><span>${mine ? `Перевожу: <b>${esc(t.title || '…')}</b> · ${t.done} из ${t.total}` : 'Идёт перевод другой анкеты'}</span><i style="--p:${t.total ? Math.round((t.done / t.total) * 100) : 0}%"></i><button class="sj-btn" data-act="trstop">Остановить</button></div>`;
    }
    if (!d.canTranslate) return '<div class="wk-trbar off">Перевод идёт через вспомогательную модель. Подключите её: Настройки → Основные.</div>';
    const left = plan.blocks.length;
    const infoBtn = plan.blocks.some(b => b.kind === 'head') ? '<button class="sj-btn" data-act="trinfo" title="Одним коротким запросом: вступление, подпись, таблица справа и названия разделов">Только шапку и названия</button>' : '';
    if (!card.ru) return `<div class="wk-trbar"><span>Русской версии ещё нет. Модель переводит блоками (${left}), и каждый готовый блок появляется здесь сразу. Романтика и NSFW по умолчанию не переводятся.</span><button class="sj-btn sj-pri" data-act="tr">Перевести анкету</button>${infoBtn}</div>`;
    return left ? `<div class="wk-trbar"><span>Не переведено или устарело блоков: ${left}.</span><button class="sj-btn sj-pri" data-act="tr">Дополнить перевод</button>${infoBtn}<button class="sj-btn" data-act="trforce" title="Перевести всё заново, включая готовое">Заново</button></div>`
      : '<div class="wk-trbar ok"><span>Перевод актуален.</span><button class="sj-btn" data-act="trforce" title="Перевести всё заново">Перевести заново</button><button class="sj-st" data-act="trclear">удалить перевод</button></div>';
  }

  /** Анкета как статья: слева вступление и разделы, справа инфобокс. */
  function pageHtml(d) {
    const c = d.cards.find(x => x.id === selected);
    if (!c) return '<div class="sj-empty">Выберите карточку слева. Если список пуст, нажмите «Собрать из всех лорбуков».</div>';
    const info = shared.scene?.get();
    const person = personOf(c), dead = isDead(c);
    const sentNow = d.sent.find(p => p.id === c.id);
    const w = wikiOf(c);
    const parts = splitSections(c.sections);
    const ru = lang === 'ru';
    const rh = c.ru?.head, hst = blockState(rh, headHash(w));
    const plan = ru ? api().translatePlan(c.id) : { blocks: [], edited: 0 };
    const secTitle = s => (ru ? ruTitle(c, s) : s.title);
    const minor = (c.tier ?? 'main') === 'minor';
    const status = dead ? '<span class="wk-state dead">умер</span>' : c.person?.present ? '<span class="wk-state">в кадре</span>' : person ? '<span class="wk-state off">не в кадре</span>' : '<span class="wk-state off">в чате не отмечен</span>';
    const photoBox = `<div class="wk-photo"><label class="wk-arch${c.image ? '' : ' none'}" title="Загрузить фото">${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}">` : `<span>${initial(c.name)}</span>`}<em>Фото</em><input type="file" accept="image/*" data-photo hidden></label>${c.image ? '<button class="sj-st" data-act="noimg">убрать фото</button>' : ''}</div>`;
    const factRows = w.facts.map((f, i) => `<tr><th>${esc(f.k)}</th><td>${esc(ru && rh?.facts?.[i] ? rh.facts[i] : f.v)}</td></tr>`).join('');
    const factEdit = `<div class="wk-factedit">${(w.derived.facts ? w.facts : w.facts).map((f, i) => `<div class="fr"><input data-fk="${i}" value="${esc(f.k)}" placeholder="подпись" aria-label="Подпись"><input data-fv="${i}" value="${esc(f.v)}" placeholder="значение" aria-label="Значение"><button class="sj-st" data-delfact="${i}" aria-label="Убрать">×</button></div>`).join('')}<div class="fr"><button class="sj-btn" data-act="addfact">+ строка</button><button class="sj-btn" data-act="autowiki" title="Взять факты и вступление из текста анкеты (Раса, Возраст, Рост…)">Заполнить из текста</button></div></div>`;
    const toc = parts.article.length > 1 ? `<div class="wk-toc"><h4>Содержание</h4><ol>${parts.article.map(s => `<li><a href="#" ${ru ? `data-goto="${esc(s.id)}"` : `data-openrec="${esc(s.id)}"`}>${esc(secTitle(s))}</a><span>${c.sectionTokens[s.id] ?? 0}</span></li>`).join('')}</ol></div>` : '';
    const heads = `<div class="wk-crumbs">Анкеты › ${minor ? 'Второстепенные' : 'Основные'} › ${esc(c.name)}</div>
      <div class="wk-titleline">${editHead && !ru ? `<input class="sj-nm wk-nm" data-card-name value="${esc(c.name)}" aria-label="Имя">` : `<h1>${esc(c.name)}</h1>`}${editHead && !ru ? '' : (w.tagline || c.aliases.length ? `<span class="wk-tag">${esc((ru && rh?.tagline) || w.tagline || `он же ${c.aliases.slice(0, 3).map(a => `«${a}»`).join(', ')}`)}</span>` : '')}
        <div class="wk-acts"><div class="wk-lang" role="group" aria-label="Язык анкеты"><button data-lang="en" aria-pressed="${!ru}" title="Текст анкеты, как он уходит рассказчику">Оригинал</button><button data-lang="ru" aria-pressed="${ru}" title="Русская версия для чтения: переводит вспомогательная модель">Русский${c.ru ? '' : ' ·'}</button></div><span class="wk-tok" title="Сколько токенов весит вся анкета">${c.tokens} ток.${sentNow ? ` · уходит ${sentNow.sections.reduce((n, s) => n + s.tokens, 0)}` : ''}</span>
          ${info?.hasChat ? (dead ? '<button class="wk-ibtn" data-act="undie" title="Воскресить"><span class="cross" aria-hidden="true"></span></button>' : `<button class="wk-ibtn skull" data-act="die" title="Умер: уйдёт вниз списков, станет серым, его чувства перестанут учитываться">${SKULL}</button>`) : ''}
          ${ru ? '' : `${c.source ? '<button class="sj-btn" data-act="reload" title="Подтянуть из лорбука тексты и ключи; ваши правила и фото остаются">Обновить из лорбука</button>' : ''}
          <button class="sj-btn${editHead ? ' sj-pri' : ''}" data-act="edithead">${editHead ? 'Готово' : 'Править анкету'}</button>
          <button class="sj-btn" data-act="delcard" title="${person ? 'Удалить анкету и убрать персонажа из чата совсем: состав, чувства, раны, знания, метки в журналах; вещи станут общими' : 'Удалить анкету из этого чата'}">${TRASH} Удалить анкету</button>`}</div></div>`;
    const headEdit = editHead && !ru ?`<div class="wk-headedit"><label>Псевдонимы<input data-card-alias value="${esc(c.aliases.join(', '))}" placeholder="русские формы имени, прозвища через запятую"></label>
        <label>Подпись под именем<input data-wiki="tagline" value="${esc(w.tagline)}" placeholder="например: вампир-отпрыск"></label>
        <label>Вступление<textarea data-wiki="lead" rows="3" placeholder="${esc(w.derived.lead ? w.lead : 'коротко о персонаже')}">${esc(w.derived.lead ? '' : w.lead)}</textarea></label>
        <div class="wk-eh">Строки таблицы справа</div>${factEdit}
        <div class="wk-recrow"><button class="sj-btn" data-act="${minor ? 'tomain' : 'tominor'}">${minor ? 'Сделать основным' : 'Сделать второстепенным'}</button><button class="sj-btn" data-act="addsec">+ запись</button></div></div>` : '';
    const infobox = `<aside class="wk-info"><div class="ibh">${esc(c.name)}</div>${photoBox}
      <table class="wk-ib">${factRows ? `<tr class="sep"><th colspan="2">Общее</th></tr>${factRows}` : ''}<tr class="sep"><th colspan="2">В этом чате</th></tr>
        <tr><th>Статус</th><td>${status}</td></tr><tr><th>Тип</th><td>${minor ? 'Второстепенный' : 'Основной'}</td></tr>
        ${c.aliases.length ? `<tr><th>Другие имена</th><td>${esc(c.aliases.slice(0, 5).join(', '))}</td></tr>` : ''}${parts.intimate.length ? '<tr><th>Романтика</th><td>есть запись (скрыта)</td></tr>' : ''}
        ${c.source ? `<tr><th>Источник</th><td>${esc(c.source.book)}</td></tr>` : ''}</table>
      <div class="wk-send"><b>Что уходит рассказчику:</b> ${sentNow ? `${esc(sentNow.sections.map(s => s.title).join(', '))}. Около <b>${sentNow.sections.reduce((n, s) => n + s.tokens, 0)} ток.</b>` : 'сейчас ничего: персонажа нет в кадре и его не назвали.'}</div></aside>`;
    const service = parts.service.map(s => recordHtml(c, s, { head: `Служебная запись: ${s.title}` })).join('');
    const intimate = parts.intimate.length ? `<details class="wk-nsfw" ${openRecs.has('__nsfw') ? 'open' : ''}><summary><b>Романтика и NSFW</b><span>${parts.intimate.reduce((n, s) => n + (c.sectionTokens[s.id] ?? 0), 0)} ток. · скрыто в статье</span><span class="r"><span class="wk-pill intim">в интиме</span></span></summary>
      <div class="wk-nsfwbody"><div class="sj-sub">У этих записей нет статьи и пункта в содержании: они хранятся и правятся как записи для рассказчика.</div>${parts.intimate.map(s => recordHtml(c, s, { head: s.title })).join('')}</div></details>` : '';
    if (ru) {
      const headEditing = ruEdit.has('head');
      const hEdit = headEditing ? `<div class="wk-ruedit">
        <label class="wk-fl">Подпись под именем<input data-ruhead="tagline" value="${esc(rh?.tagline ?? '')}" placeholder="${esc(w.tagline)}"></label>
        <label class="wk-fl">Вступление<textarea data-ruhead="lead" rows="3" placeholder="${esc(w.lead)}">${esc(rh?.lead ?? '')}</textarea></label>
        ${w.facts.map((f, i) => `<label class="wk-fl">${esc(f.k)}<input data-ruhf="${i}" value="${esc(rh?.facts?.[i] || '')}" placeholder="${esc(f.v)}"></label>`).join('')}</div>` : '';
      const headPills = !rh ? '<span class="wk-pill untr">шапка не переведена</span>' : (hst === 'stale' ? '<span class="wk-pill stale" title="Вступление или таблицу правили после перевода">шапка: оригинал изменился</span>' : '');
      const leadText = rh?.lead || w.lead;
      const nsfw = parts.intimate.length ? `<details class="wk-nsfw" ${openRecs.has('__nsfw') ? 'open' : ''}><summary><b>Романтика и NSFW</b><span>${parts.intimate.filter(s => c.ru?.sections?.[s.id]).length} из ${parts.intimate.length} переведено</span></summary>
        <div class="wk-nsfwbody"><div class="sj-sub">Эти записи не переводятся сами: вспомогательная модель может отказаться от откровенного текста. Перевести можно отдельной кнопкой.</div>
        ${d.canTranslate && !d.translation ? '<div class="sj-add" style="margin:6px 0"><button class="sj-btn" data-act="trnsfw">Перевести модуль</button></div>' : ''}
        ${parts.intimate.filter(s => c.ru?.sections?.[s.id]).map(s => ruSection(c, s, 0, d)).join('')}</div></details>` : '';
      return `<div class="wk-page ru">${heads}${trBar(c, d, plan)}
        <div class="wk-grid"><div class="wk-main"><div class="wk-meta wk-headrow">${headPills}<span class="wk-penbox">${penBtn('head', headEditing)}</span></div>${!headEditing && leadText ? `<p class="wk-lead${rh?.lead ? '' : ' untr'}">${esc(leadText)}</p>` : ''}${hEdit}${toc}
          ${parts.article.map((s, i) => ruSection(c, s, i + 1, d)).join('') || '<div class="sj-none">Разделов нет.</div>'}
          ${nsfw}</div>${infobox}</div></div>`;
    }
    return `<div class="wk-page">${heads}${headEdit}
      <div class="wk-grid"><div class="wk-main">${w.lead ? `<p class="wk-lead">${esc(w.lead)}</p>` : ''}${toc}
        ${parts.article.map((s, i) => articleSection(c, s, i + 1)).join('') || '<div class="sj-none">Разделов нет.</div>'}
        ${service}${intimate}</div>${infobox}</div></div>`;
  }

  function minorHtml() {
    if (!importing.found) return `<div class="sj-imp"><div class="sj-lbl">Второстепенные из NPC-лорбуков</div><div class="sj-sub">${importing.error ? esc(importing.error) : 'Просматриваю лорбуки…'}</div></div>`;
    const rows = importing.found.map(f => `<label class="sj-chk"><input type="checkbox" data-impm="${esc(f.key)}" ${importing.pick.has(f.key) ? 'checked' : ''}><span><b>${esc(f.name)}</b> <small>${f.aliases.length ? `(${esc(f.aliases.join(', '))}) ` : ''}· ${esc(f.book)} · около ${Math.round(f.chars / 3)} ток.${f.exists ? ' · уже есть' : ''}</small></span></label>`).join('');
    return `<div class="sj-imp"><div class="sj-lbl">Найдено второстепенных: ${importing.found.length}</div><div class="sj-sub" style="margin-bottom:4px">Отметьте тех, кого нужно добавить. Записи вроде «Друиды рощи» (группы, а не люди) лучше не отмечать.</div>
      <div class="sj-minorlist">${rows || '<div class="sj-none">Подходящих записей нет.</div>'}</div>
      <div class="sj-add"><button class="sj-btn sj-pri" data-act="minorgo" ${importing.pick.size ? '' : 'disabled'}>Добавить отмеченных (${importing.pick.size})</button><button class="sj-btn" data-act="minorall">Отметить всех новых</button><button class="sj-btn" data-act="impcancel">Отмена</button></div></div>`;
  }

  function importHtml(d) {
    const books = cardsApi().bookNames();
    if (!importing.found) {
      return `<div class="sj-imp"><div class="sj-lbl">Импорт из лорбука</div><div class="sj-add"><select data-book aria-label="Лорбук"><option value="">— выберите лорбук —</option>${books.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select><button class="sj-btn" data-act="impcancel">Отмена</button></div>
        <div class="sj-sub">Берутся записи вида «[ Имя ] - Раздел». Лорбук не меняется: в анкеты копируются тексты.</div>${importing.error ? `<div class="sj-sub" style="color:#d98a4a">${esc(importing.error)}</div>` : ''}</div>`;
    }
    const rows = importing.found.map(f => `<label class="sj-chk"><input type="checkbox" data-imp="${esc(f.name)}" ${importing.pick.has(f.name) ? 'checked' : ''}><span><b>${esc(f.name)}</b> <small>· разделов ${f.sections}, около ${Math.round(f.chars / 3)} ток.${f.exists ? ' · уже есть, обновится' : ''}</small></span></label>`).join('');
    const one = `<div class="sj-dup"><div><b>Весь этот лорбук об одном персонаже?</b> Тогда каждая запись станет разделом одной карточки.</div><div class="sj-add" style="margin:6px 0 0"><input data-onename value="${esc(importing.book)}" placeholder="Имя персонажа" aria-label="Имя персонажа"><button class="sj-btn sj-pri" data-act="impone">Собрать одну карточку</button></div></div>`;
    return `<div class="sj-imp">${one}<div class="sj-lbl">«${esc(importing.book)}»: найдено карточек ${importing.found.length}</div>${rows || '<div class="sj-none">Подходящих записей нет.</div>'}
      <div class="sj-add"><button class="sj-btn sj-pri" data-act="impgo" ${importing.pick.size ? '' : 'disabled'}>Импортировать выбранные (${importing.pick.size})</button><button class="sj-btn" data-act="impall">Выбрать все</button><button class="sj-btn" data-act="impcancel">Отмена</button></div></div>`;
  }

  function footHtml(d) {
    if (!d.hasChat) return '';
    const lines = d.sent.map(p => `<div class="sj-sent2"><b>${esc(p.name)}</b> <small>${p.sections.reduce((n, s) => n + s.tokens, 0)} ток.</small> ${p.sections.map(s => `<span class="sj-chipx" title="${esc(s.why)}">${esc(s.title)} · ${s.tokens}</span>`).join('')}</div>`).join('');
    return `<div class="sj-tell"><div class="sj-lbl">${settings.enabled && d.enabled ? 'Уйдёт рассказчику с ближайшим ответом' : 'Не отправляется (выключено в настройках)'} · около ${d.sentTokens} токенов</div>${lines || '<div class="sj-sub">Пока ничего: подключите карточки и поставьте персонажей в кадр.</div>'}${d.dropped.length ? `<div class="sj-sub" style="color:#d98a4a">Не влезло в бюджет: ${esc(d.dropped.join('; '))}</div>` : ''}</div>`;
  }

  // ---------- телефон: список анкет, затем карточка с раскрывающимися разделами ----------
  const isMobile = () => Boolean(document.documentElement.dataset.sjMobile);
  let mCard = false;                 // телефон: открыта ли карточка (иначе список)
  const openC = new Set();           // раскрытые разделы карточки
  win.addEventListener('toggle', e => { const k = e.target?.dataset?.ck; if (k) { if (e.target.open) openC.add(k); else openC.delete(k); } }, true);
  const mdetC = (key, title, inner) => `<details class="sj-mdet2" data-ck="${key}"${openC.has(key) ? ' open' : ''}><summary>${title}</summary><div class="in">${inner}</div></details>`;

  function mobileList(d) {
    const info = shared.scene?.get();
    const q = search.trim().toLowerCase();
    const pool = shown(d);
    const count = t => pool.filter(x => (x.tier ?? 'main') === t).length;
    const list = pool.filter(x => (x.tier ?? 'main') === tier && (!q || x.name.toLowerCase().includes(q) || x.aliases.some(a => a.toLowerCase().includes(q))));
    const dead = new Map(list.map(x => [x.id, isDead(x, info)]));
    list.sort((a, b) => Number(dead.get(a.id)) - Number(dead.get(b.id)));
    const rows = list.map(x => `<button type="button" class="sj-mrow sj-crow${dead.get(x.id) ? ' dead' : ''}" data-card="${esc(x.id)}"><span class="ico photo">${x.image ? `<img src="${esc(x.image)}" alt="">` : esc(initial(x.name))}</span><span class="tx"><b>${esc(x.name)}</b><small>${dead.get(x.id) ? 'умер · ' : ''}${x.idle ? 'лорбук не привязан · ' : ''}${x.tokens} ток.${x.person?.present ? ' · в кадре' : ''}</small></span><span class="go">›</span></button>`).join('');
    const scope = d.hasChat ? '' : '<div class="sj-sub" style="margin-bottom:8px">Откройте чат: у каждого чата свои анкеты.</div>';
    const gather = `<div class="sj-add" style="flex-direction:column;align-items:stretch">${tier === 'main'
      ? '<button class="sj-btn sj-pri" data-act="importall">Собрать основных из всех лорбуков</button>'
      : '<button class="sj-btn sj-pri" data-act="minor">Собрать из NPC-лорбуков</button>'}<button class="sj-btn" data-act="reloadall">Обновить все из лорбука</button><button class="sj-btn" data-act="import">Из одного лорбука</button></div>`;
    return `${scope}<div class="sj-seg2"><button data-tier="main" aria-pressed="${tier === 'main'}">Основные · ${count('main')}</button><button data-tier="minor" aria-pressed="${tier === 'minor'}">Второстепенные · ${count('minor')}</button></div>
      <input class="sj-ssearch" data-search value="${esc(search)}" placeholder="Поиск по имени" aria-label="Поиск" type="search" autocomplete="off">
      ${rows ? `<div class="sj-sgrp">${rows}</div>` : `<div class="sj-none" style="padding:8px">${tier === 'main' ? 'Основных анкет пока нет. «Собрать основных» найдёт записи вида «[ Имя ] - Раздел».' : 'Второстепенных пока нет.'}</div>`}
      <div class="sj-add" style="margin:4px 0 8px"><button class="sj-btn sj-pri" data-act="new">+ Новая анкета</button></div>
      ${mdetC('gather', 'Собрать из лорбуков', gather)}`;
  }

  function mobileCard(d) {
    const c = d.cards.find(x => x.id === selected);
    if (!c) return '<div class="sj-none">Анкета не выбрана.</div>';
    const info = shared.scene?.get();
    const person = personOf(c), dead = isDead(c);
    const sentNow = d.sent.find(p => p.id === c.id);
    const w = wikiOf(c);
    const parts = splitSections(c.sections);
    const ru = lang === 'ru';
    const rh = c.ru?.head;
    const plan = ru ? api().translatePlan(c.id) : { blocks: [], edited: 0 };
    const minor = (c.tier ?? 'main') === 'minor';
    const status = dead ? '<span class="wk-state dead">умер</span>' : c.person?.present ? '<span class="wk-state">в кадре</span>' : person ? '<span class="wk-state off">не в кадре</span>' : '<span class="wk-state off">в чате не отмечен</span>';
    const hero = `<div class="sj-hero"><label class="ph" title="Загрузить фото">${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}">` : `<span>${esc(initial(c.name))}</span>`}<input type="file" accept="image/*" data-photo hidden></label><div class="hd"><h1>${esc(c.name)}</h1><div class="chips">${status}<span class="wk-pill">${c.tokens} ток.${sentNow ? ` · уходит ${sentNow.sections.reduce((n, x) => n + x.tokens, 0)}` : ''}</span></div>${w.tagline ? `<div class="sj-sub">${esc((ru && rh?.tagline) || w.tagline)}</div>` : ''}</div></div>`;
    const leadText = ru ? (rh?.lead || w.lead) : w.lead;
    const secs = parts.article.map(s => {
      const title = ru ? ruTitle(c, s) : s.title;
      const inner = ru ? ruSection(c, s, 0, d) : `<div class="wk-body open" data-wkexpand>${bodyHtml(s.text, c.name).body}</div>${recordHtml(c, s)}`;
      return `<details class="sj-mdet2 sj-csec${s.off ? ' off' : ''}" data-ck="${esc(s.id)}"${openC.has(s.id) ? ' open' : ''}><summary><span class="t">${esc(title)}</span><span class="r">${c.sectionTokens[s.id] ?? 0}</span>${tgBtn(s)}</summary><div class="in">${inner}</div></details>`;
    }).join('');
    const service = parts.service.map(x => recordHtml(c, x, { head: `Служебная запись: ${x.title}` })).join('');
    const intimate = parts.intimate.length ? mdetC('nsfw', `Романтика и NSFW · ${parts.intimate.length}`, parts.intimate.map(x => recordHtml(c, x, { head: x.title })).join('')) : '';
    const headEdit = editHead && !ru ? `<input class="sj-nm wk-nm" data-card-name value="${esc(c.name)}" aria-label="Имя">
        <label class="wk-fl">Псевдонимы<input data-card-alias value="${esc(c.aliases.join(', '))}" placeholder="прозвища и формы имени через запятую"></label>
        <label class="wk-fl">Подпись под именем<input data-wiki="tagline" value="${esc(w.tagline)}" placeholder="например: вампир-отпрыск"></label>
        <label class="wk-fl">Вступление<textarea data-wiki="lead" rows="3" placeholder="${esc(w.derived.lead ? w.lead : 'коротко о персонаже')}">${esc(w.derived.lead ? '' : w.lead)}</textarea></label>
        <div class="sj-add"><button class="sj-btn" data-act="${minor ? 'tomain' : 'tominor'}">${minor ? 'Сделать основным' : 'Сделать второстепенным'}</button><button class="sj-btn" data-act="addsec">+ запись</button></div>` : '';
    const more = `<div class="sj-add" style="flex-direction:column;align-items:stretch">${info?.hasChat ? (dead ? '<button class="sj-btn" data-act="undie">Воскресить</button>' : '<button class="sj-btn" data-act="die">Отметить умершим</button>') : ''}
        ${ru ? '' : `${c.source ? '<button class="sj-btn" data-act="reload">Обновить из лорбука</button>' : ''}<button class="sj-btn${editHead ? ' sj-pri' : ''}" data-act="edithead">${editHead ? 'Готово' : 'Править анкету'}</button>`}
        ${c.image ? '<button class="sj-btn" data-act="noimg">Убрать фото</button>' : ''}<button class="sj-btn sj-del" data-act="delcard">Удалить анкету</button></div>${headEdit}`;
    return `${hero}
      <div class="sj-seg2"><button data-lang="en" aria-pressed="${!ru}">Оригинал</button><button data-lang="ru" aria-pressed="${ru}">Русский${c.ru ? '' : ' ·'}</button></div>
      ${ru ? trBar(c, d, plan) : ''}${leadText ? `<p class="wk-lead">${esc(leadText)}</p>` : ''}
      ${secs || '<div class="sj-none">Разделов нет.</div>'}${service}${intimate}
      ${mdetC('more', 'Ещё', more)}
      ${mdetC('sent', 'Что уходит рассказчику', footHtml(d))}`;
  }

  function renderMobile(d) {
    const card = mCard ? d.cards.find(x => x.id === selected) : null;
    if (mCard && !card) mCard = false;
    const close = '<button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button>';
    const head = card
      ? `<div class="sj-wh"><button class="sj-btn sj-back" data-act="mback" aria-label="К списку">‹</button><h2>${esc(card.name)}</h2>${close}</div>`
      : `<div class="sj-wh"><h2>Анкеты</h2>${close}<span class="sj-sub">${esc(note || d.note || 'персонажи из лорбуков')}</span></div>`;
    win.innerHTML = `${head}<div class="sj-cmob">${importing ? (importing.minor ? minorHtml() : importHtml(d)) : ''}${card ? mobileCard(d) : mobileList(d)}</div>`;
  }

  function render() {
    const d = cardsApi().get();
    const info = shared.scene?.get();
    shell.theme(info?.hasChat ? info.state.calendar : settings.calendar);
    const pool0 = shown(d);
    if (!pool0.some(c => c.id === selected)) selected = pool0[0]?.id ?? '';
    if (isMobile()) { renderMobile(d); return; }
    win.innerHTML = `<div class="sj-wh"><h2>Анкеты</h2><span class="sj-sub">${esc(note || d.note || 'персонажи из лорбуков: разделы, фото, токены')}</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      ${importing ? (importing.minor ? minorHtml() : importHtml(d)) : ''}<div class="sj-jbody"><div class="sj-jside">${sideHtml(d)}</div><div class="sj-jpage">${pageHtml(d)}${footHtml(d)}</div></div>`;
  }

  const api = () => cardsApi();
  const secOf = el => el.closest('[data-sec]')?.dataset.sec;
  const onClick = async event => {
    const t = event.target;
    const tb = t.closest('[data-tier]'); if (tb) { tier = tb.dataset.tier; selected = ''; return render(); }
    const row = t.closest('[data-card]'); if (row) { selected = row.dataset.card; editHead = false; ruEdit.clear(); mCard = true; return render(); }
    const tg = t.closest('[data-tgsec]'); if (tg) { event.preventDefault(); const c = api().get().cards.find(x => x.id === selected); const s = c?.sections.find(x => x.id === tg.dataset.tgsec); if (s) api().setSection(selected, s.id, { off: !s.off }); return; }
    const orec = t.closest('[data-openrec]'); if (orec) { event.preventDefault(); openRecs.add(orec.dataset.openrec); render(); win.querySelector(`[data-rec="${CSS.escape(orec.dataset.openrec)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const exp = t.closest('[data-wkexpandbtn]'); if (exp) { event.preventDefault(); const box = exp.previousElementSibling; const on = box.classList.toggle('open'); exp.textContent = on ? 'свернуть' : 'показать целиком'; return; }
    const dfa = t.closest('[data-delfact]'); if (dfa) { const c = api().get().cards.find(x => x.id === selected); api().updateCard(selected, { wiki: { facts: wikiOf(c).facts.filter((_, i) => i !== Number(dfa.dataset.delfact)) } }); return; }
    const lg = t.closest('[data-lang]'); if (lg) { lang = lg.dataset.lang === 'ru' ? 'ru' : 'en'; return render(); }
    const go = t.closest('[data-goto]'); if (go) { event.preventDefault(); win.querySelector(`[data-h="${CSS.escape(go.dataset.goto)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const actEl = t.closest('[data-act]');
    const act = actEl?.dataset.act;
    if (!act) return;
    if (actEl.tagName === 'A') event.preventDefault();
    try {
      if (act === 'tr' || act === 'trforce' || act === 'trone' || act === 'trnsfw' || act === 'trinfo') {
        const opts = act === 'trinfo' ? { only: { kind: 'head' } } : act === 'trforce' ? { force: true } : act === 'trnsfw' ? { withIntimate: true } : act === 'trone' ? { only: { kind: actEl.dataset.kind, id: actEl.dataset.id } } : {};
        const plan = api().translatePlan(selected, opts);
        if (!plan.blocks.length) { note = 'Переводить нечего: всё актуально.'; return render(); }
        if (plan.edited && !window.confirm(`В ${plan.edited} блоках есть ваши правки перевода. Они будут заменены новым переводом. Продолжить?`)) return;
        if (act === 'trforce' && plan.blocks.length > 1 && !window.confirm(`Перевести заново ${plan.blocks.length} блоков? Это ${plan.blocks.length} запросов к вспомогательной модели.`)) return;
        note = '';
        const name = selected;
        const run = api().translateCard(name, opts);
        render();
        try { const r = await run; note = `Переведено блоков: ${r.done}${r.failed ? `. Не вышло разобрать ответ модели: ${r.failed} (нажмите «Дополнить перевод»)` : ''}`; }
        catch (error) { note = `Перевод остановлен: ${error?.message ?? error}${error?.done ? `. Успело перевестись блоков: ${error.done}` : ''}`; }
        return render();
      }
      if (act === 'rupen') { const k = actEl.dataset.key; if (ruEdit.has(k)) ruEdit.delete(k); else ruEdit.add(k); return render(); }
      if (act === 'trstop') { api().stopTranslation(); note = 'Останавливаю после текущего блока…'; return render(); }
      if (act === 'trclear') { if (window.confirm('Удалить русскую версию этой анкеты, включая ваши правки перевода?')) { api().clearRu(selected); note = 'Перевод удалён'; } return; }
      if (act === 'close') return shell.close();
      if (act === 'mback') { mCard = false; return render(); }
      if (act === 'new') { const name = window.prompt(tier === 'minor' ? 'Имя второстепенного персонажа' : 'Имя персонажа'); if (name) { const id = api().addCard(name, tier); if (id) { selected = id; } } return; }
      if (act === 'minor') { importing = { minor: true, found: null, pick: new Set(), error: '' }; render(); const found = await api().previewMinor(); importing = { minor: true, found, pick: new Set(found.filter(f => !f.exists).map(f => f.key)), error: '' }; return render(); }
      if (act === 'minorall') { importing.pick = new Set(importing.found.filter(f => !f.exists).map(f => f.key)); return render(); }
      if (act === 'minorgo') { const before = new Set(api().get().cards.map(c => c.id)); const r = await api().importMinor([...importing.pick]); note = `Второстепенных добавлено: ${r.created}`; importing = null; return render(); }
      if (act === 'merge') { const el = t.closest('[data-act]'); const keep = el.dataset.keep; if (api().mergeCards(keep, el.dataset.drop)) { selected = keep; note = 'Карточки объединены'; } return render(); }
      if (act === 'notdup') { const el = t.closest('[data-act]'); ignored.add([el.dataset.keep, el.dataset.drop].sort().join('|')); try { localStorage.setItem('sj-cards-ignored', JSON.stringify([...ignored])); } catch { /* без памяти браузера */ } return render(); }
      if (act === 'die') { const c = api().get().cards.find(x => x.id === selected); const info = shared.scene.get(); let pid = personOf(c)?.id || shared.scene.addPerson(c.name); if (!pid) pid = info.people.find(p => lowName(p.name) === lowName(c.name))?.id; if (pid) shared.scene.setDeath(pid, ''); return render(); }
      if (act === 'undie') { const c = api().get().cards.find(x => x.id === selected); const p = personOf(c); if (p) shared.scene.clearDeath(p.id); return render(); }
      if (act === 'edithead') { editHead = !editHead; return render(); }
      if (act === 'addfact') { const c = api().get().cards.find(x => x.id === selected); const w = wikiOf(c); api().updateCard(selected, { wiki: { facts: [...w.facts, { k: 'Новое', v: '—' }] } }); return; }
      if (act === 'autowiki') {
        const c = api().get().cards.find(x => x.id === selected);
        const facts = extractFacts(c.sections.map(s => s.text).join('\n')).filter(f => f.k !== 'Имя' && f.k !== 'Полное имя');
        api().updateCard(selected, { wiki: { facts, lead: '' } }); note = facts.length ? `Взято фактов из текста: ${facts.length}` : 'В тексте анкеты не нашлось строк вида «Раса: …»'; return render();
      }
      if (act === 'tomain') { api().updateCard(selected, { tier: 'main' }); tier = 'main'; return; }
      if (act === 'tominor') { api().updateCard(selected, { tier: 'minor' }); tier = 'minor'; return; }
      if (act === 'reloadall') {
        note = 'Обновляю из лорбуков…'; render();
        const r = await api().reloadAll((i, n, name) => { const el = win.querySelector('.sj-wh .sj-sub'); if (el) el.textContent = `Лорбук ${i} из ${n}: ${name}`; });
        note = `Обновлено карточек: ${r.updated}${r.skipped.length ? `. Пропущено книг (не привязаны к чату): ${r.skipped.join(', ')}` : ''}`;
        return render();
      }
      if (act === 'importall') {
        note = 'Просматриваю лорбуки…'; render();
        const r = await api().importAll((i, n, name) => { const el = win.querySelector('.sj-wh .sj-sub'); if (el) el.textContent = `Лорбук ${i} из ${n}: ${name}`; });
        note = `Просмотрено лорбуков: ${r.books}. Новых карточек: ${r.created}, обновлено: ${r.updated}.`;
        return render();
      }
      if (act === 'import') { importing = { books: true, found: null, error: '' }; return render(); }
      if (act === 'impcancel') { importing = null; return render(); }
      if (act === 'impall') { importing.pick = new Set(importing.found.map(f => f.name)); return render(); }
      if (act === 'impone') {
        const name = win.querySelector('[data-onename]')?.value ?? '';
        const r = await api().importBookAsOne(importing.book, name);
        note = `Одна карточка из «${importing.book}»: разделов ${r.sections}${r.skipped ? `, не влезло записей: ${r.skipped}` : ''}`; importing = null; return render();
      }
      if (act === 'impgo') { const before = new Set(api().get().cards.map(c => c.id)); const r = await api().importBook(importing.book, [...importing.pick]); note = `Новых: ${r.created}, обновлено: ${r.updated}`; importing = null; return render(); }
      if (act === 'delcard') {
        const c = api().get().cards.find(x => x.id === selected), p = c && personOf(c);
        const what = p ? ' и убрать персонажа из чата совсем: состав, чувства, раны, знания, метки в журналах; вещи станут общими' : '';
        if (c && window.confirm(`Удалить анкету «${c.name}»${what}?`)) {
          if (p) shared.scene.removePersonFromChat(p.id);
          api().removeCard(selected); editHead = false; note = `Анкета «${c.name}» удалена${p ? ', персонаж убран из чата' : ''}`; render();
        }
        return;
      }
      if (act === 'noimg') return void api().updateCard(selected, { image: '' });
      if (act === 'addsec') { api().addSection(selected); return; }
      if (act === 'delsec') { if (window.confirm('Удалить раздел?')) api().removeSection(selected, secOf(t)); return; }
      if (act === 'reload') { const c = api().get().cards.find(x => x.id === selected); const r = await api().importBook(c.source.book, [c.name]); note = `Обновлено разделов из лорбука «${c.source.book}»`; render(); return; }
    } catch (error) { note = `Ошибка: ${error?.message ?? error}`; if (importing) importing.error = note; render(); }
  };
  const onChange = async event => {
    const el = event.target;
    const d = el.dataset;
    try {
      if (d.book !== undefined) { if (!el.value) return; importing = { book: el.value, found: null, error: '' }; render(); const found = await api().previewBook(el.value); importing = { book: el.value, found, pick: new Set(found.filter(f => !f.exists).map(f => f.name)), error: '' }; return render(); }
      if (d.impm !== undefined) { if (el.checked) importing.pick.add(d.impm); else importing.pick.delete(d.impm); return render(); }
      if (d.imp !== undefined) { if (el.checked) importing.pick.add(d.imp); else importing.pick.delete(d.imp); return render(); }
      if (d.cardName !== undefined) return void api().updateCard(selected, { name: el.value });
      if (d.cardAlias !== undefined) return void api().updateCard(selected, { aliases: el.value });
      if (d.wiki !== undefined) return void api().updateCard(selected, { wiki: { [d.wiki]: el.value } });
      if (d.fk !== undefined || d.fv !== undefined) {
        const c = api().get().cards.find(x => x.id === selected), facts = wikiOf(c).facts.map(f => ({ ...f }));
        const i = Number(d.fk ?? d.fv); if (facts[i]) { if (d.fk !== undefined) facts[i].k = el.value; else facts[i].v = el.value; }
        return void api().updateCard(selected, { wiki: { facts } });
      }
      if (d.ru !== undefined) return void api().setRu(selected, { kind: 'section', id: secOf(el) }, { [d.ru]: el.value });
      if (d.ruhead !== undefined) return void api().setRu(selected, { kind: 'head' }, { [d.ruhead]: el.value });
      if (d.ruhf !== undefined) {
        const c = api().get().cards.find(x => x.id === selected), n = wikiOf(c).facts.length;
        const vals = Array.from({ length: n }, (_, i) => c.ru?.head?.facts?.[i] ?? '');
        vals[Number(d.ruhf)] = el.value;
        return void api().setRu(selected, { kind: 'head' }, { facts: vals });
      }
      if (d.st !== undefined) return void api().setSection(selected, secOf(el), { [d.st]: el.value });
      if (d.photo !== undefined && el.files?.[0]) { note = 'Сохраняю фото…'; render(); await api().setImage(selected, el.files[0]); note = ''; return render(); }
    } catch (error) { note = `Ошибка: ${error?.message ?? error}`; if (importing && !importing.found) importing.error = note; render(); }
  };
  win.addEventListener('toggle', event => {
    const el = event.target, id = el?.dataset?.rec;
    if (id) { if (el.open) openRecs.add(id); else openRecs.delete(id); }
    else if (el?.classList?.contains('wk-nsfw')) { if (el.open) openRecs.add('__nsfw'); else openRecs.delete('__nsfw'); }
  }, true);
  const onInput = event => { if (event.target.dataset.search !== undefined) { search = event.target.value; const pos = event.target.selectionStart; render(); const box = win.querySelector('[data-search]'); box?.focus(); box?.setSelectionRange(pos, pos); } };
  win.addEventListener('click', onClick);
  win.addEventListener('change', onChange);
  win.addEventListener('input', onInput);

  const unsubscribe = shared.cards?.subscribe(() => {
    if (!shell.isOpen) return;
    if (win.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    render();
  });

  function open() {
    importing = null; note = ''; mCard = false;
    shell.show(shared.scene?.get()?.state?.calendar ?? settings.calendar);
    render();
    win.focus();
  }
  shared.ui = { ...(shared.ui ?? {}), openCards: open, closeCards: shell.close };

  // кнопка в боковом меню расширений: её можно закрепить в блоке «Под рукой»
  const menu = document.createElement('div');
  menu.id = 'sj-cards-menu';
  menu.className = 'list-group-item flex-container flexGap5 interactable';
  menu.tabIndex = 0;
  menu.setAttribute('role', 'button');
  menu.innerHTML = '<i class="fa-solid fa-address-card"></i><span>Анкеты</span>';
  const onMenu = () => open();
  const onMenuKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  menu.addEventListener('click', onMenu);
  menu.addEventListener('keydown', onMenuKey);
  document.getElementById('sj-cards-menu')?.remove();
  document.querySelector('#extensionsMenu')?.append(menu);

  return () => {
    unsubscribe?.();
    menu.removeEventListener('click', onMenu);
    menu.removeEventListener('keydown', onMenuKey);
    menu.remove();
    win.removeEventListener('click', onClick);
    win.removeEventListener('change', onChange);
    win.removeEventListener('input', onInput);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openCards; delete shared.ui.closeCards; }
  };
}
