/**
 * Окно «Карта»: места показаны плитками с иконками, названием и тумблером «карточка уходит рассказчику».
 * Группы (папки) раскрываются по клику, внутри них подгруппы и места; у места внутри карточки видны его подместа
 * такими же плитками. Сверху хлебные крошки, по ним можно вернуться на любой уровень.
 * «Сделать текущим» ставит место сцены, и его карточка уходит рассказчику. Находки и перемены от Архивариуса
 * попадают в слой этого чата, основа места (библиотека) от них не меняется.
 */
import { esc } from './dom.js';
import { createShell } from './shell.js';
import { childrenOf, chainOf, canMove, pathOf, descendantsOf, LORE_WHEN, LORE_WHEN_RU, loreKey } from '../core/places.js';

const ICON_FOLDER = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 12a3 3 0 0 1 3-3h10l4 5h18a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/></svg>';
const ICON_PLACE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c-8 0-14 6-14 14 0 10 14 26 14 26s14-16 14-26c0-8-6-14-14-14z"/><circle cx="24" cy="18" r="5" class="hole"/></svg>';

const switchHtml = (id, on) => `<span class="sj-sw2${on ? ' on' : ''}" role="switch" tabindex="0" aria-checked="${on}" data-cardtoggle="${esc(id)}" title="${on ? 'Карточка включена: уходит рассказчику, когда сцена здесь' : 'Карточка выключена: рассказчику не уходит'}"><i></i></span>`;

export function startMapWindow(deps) {
  const { shared, settings } = deps;
  const scene = () => shared.scene;
  const shell = createShell({ id: 'sj-map', label: 'Карта', width: 1180 });
  const { win } = shell;
  let path = '';          // открытая группа (папка); пусто: самый верх
  let selected = '';      // открытое место (карточка); пусто: показаны плитки группы
  let search = '';
  let note = '';
  let view = ['tiles', 'list'].includes(settings.mapView) ? settings.mapView : 'wiki';
  let attach = { open: false, loading: false, list: [], q: '', error: '' };   // выбор записи лорбука к месту
  let groupFilter = 'all';        // карточки группы: all | seen | unseen | danger
  let listFilter = 'all';         // список мест: all | seen | know | danger      // «Вики»: дерево слева и карточка-статья; «Плитки»: прежний вид
  const openNodes = new Set();                                    // раскрытые ветки дерева

  const matches = (n, q) => [n.name, ...(n.aliases ?? [])].some(x => x.toLowerCase().includes(q));
  const curId = () => selected || path;

  /** Ближайшая папка выше узла: туда вернёт кнопка «назад» из карточки места. */
  const folderAbove = (nodes, id) => {
    const chain = chainOf(nodes, id);
    for (let i = chain.length - 2; i >= 0; i--) if (chain[i].kind === 'folder') return chain[i].id;
    return '';
  };

  function tileHtml(info, n) {
    const nodes = info.placeNodes;
    const isFolder = n.kind === 'folder';
    const kids = childrenOf(nodes, n.id);
    const here = info.map.current === n.id;
    const within = !here && info.map.current && chainOf(nodes, info.map.current).some(x => x.id === n.id);
    // у места своё состояние; у группы «включено», если включено хоть одно место внутри (переключатель меняет всё внутри)
    const inside = isFolder ? descendantsOf(nodes, n.id).filter(x => x.kind !== 'folder') : [];
    const off = isFolder ? inside.length > 0 && inside.every(x => (info.map.off ?? []).includes(x.id)) : (info.map.off ?? []).includes(n.id);
    const sub = isFolder ? (kids.length ? `внутри: ${kids.length}` : 'пусто') : (kids.length ? `подмест: ${kids.length}` : '');
    const badge = here ? '<span class="bd">сцена здесь</span>' : within ? '<span class="bd soft">сцена внутри</span>' : '';
    return `<div class="sj-tile${isFolder ? ' folder' : ''}${here ? ' here' : ''}${within ? ' within' : ''}${off ? ' off' : ''}" role="button" tabindex="0" draggable="true" data-dropid="${esc(n.id)}" data-open="${esc(n.id)}" title="${esc(pathOf(nodes, n.id) || n.name)}">
      ${isFolder && !inside.length ? '' : switchHtml(n.id, !off)}
      <button class="sj-tdel" data-deltile="${esc(n.id)}" title="Удалить${kids.length ? ' вместе с вложенными' : ''}" aria-label="Удалить">🗑</button>
      <div class="ico${n.image ? ' photo' : ''}">${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy">` : isFolder ? ICON_FOLDER : ICON_PLACE}</div>
      <div class="nm">${esc(n.name)}</div>
      <div class="sb">${esc(sub)}${n.local ? `${sub ? ' · ' : ''}чат` : ''}</div>${badge}</div>`;
  }

  const tilesSection = (info, title, items, empty) => (items.length || empty
    ? `<section class="sj-mp"><header><h3>${title}</h3><span>${items.length || ''}</span></header>${items.length ? `<div class="sj-tiles">${items.map(n => tileHtml(info, n)).join('')}</div>` : `<div class="sj-none">${empty}</div>`}</section>` : '');

  function crumbsHtml(info, id) {
    const nodes = info.placeNodes;
    const chain = id ? chainOf(nodes, id) : [];
    const parts = ['<button class="sj-crumb go" data-go="" data-dropid="">Все места</button>', ...chain.map((n, i) => (i === chain.length - 1
      ? `<span class="sj-crumb now">${esc(n.name)}</span>`
      : `<button class="sj-crumb go" data-go="${esc(n.id)}" data-dropid="${esc(n.id)}">${esc(n.name)}</button>`))];
    return `<nav class="sj-crumbs" aria-label="Путь">${parts.join('<span class="sj-crsep">›</span>')}</nav>`;
  }

  function listHtmlChips(items, field, scope, editable) {
    return items.length ? `<div class="sj-chips2">${items.map(t => `<span class="sj-chip2">${esc(t)}${editable ? `<button data-deltext="${esc(field)}|${esc(scope)}" data-text="${esc(t)}" aria-label="Убрать">×</button>` : ''}</span>`).join('')}</div>` : '<div class="sj-none">Пока нет.</div>';
  }
  const panel = (title, hint, inner) => `<section class="sj-mp"><header><h3>${title}</h3>${hint ? `<span>${hint}</span>` : ''}</header>${inner}</section>`;

  /** Где лежит, псевдонимы и удаление: общий блок для группы и места. */
  function settingsHtml(info, n) {
    const nodes = info.placeNodes;
    const kids = childrenOf(nodes, n.id);
    const parents = nodes.filter(x => canMove(nodes, n.id, x.id) && x.id !== n.id).map(x => `<option value="${esc(x.id)}"${x.id === n.parentId ? ' selected' : ''}>${esc(pathOf(nodes, x.id) || x.name)}${x.kind === 'folder' ? ' (папка)' : ''}</option>`).join('');
    return `<div class="sj-add"><select data-pparent aria-label="Внутри"><option value="">— верхний уровень —</option>${parents}</select><input data-palias value="${esc((n.aliases ?? []).join(', '))}" placeholder="псевдонимы через запятую" aria-label="Псевдонимы"></div>
      <div class="sj-add"><button class="sj-btn" data-act="delplace">Удалить${kids.length ? ' вместе с вложенными' : ''}</button></div>`;
  }

  /** Записи лорбука, привязанные к месту: тумблер (в этом чате), правило «когда слать», начало текста. */
  function loreHtml(info, n) {
    const links = (info.placeLinks ?? []).filter(l => l.placeId === n.id);
    const off = new Set(info.map.loreOff ?? []);
    const cardOn = !(info.map.off ?? []).includes(n.id);
    const store = shared.placeLore;
    const rows = links.map(l => {
      const on = cardOn && !off.has(loreKey(l));
      const text = store?.textOf(l.book, l.entry) ?? '';
      return `<div class="sj-lore${on ? '' : ' off'}"><div class="sj-lh"><b>${esc(l.entry)}</b>
          <select data-lorewhen data-entry="${esc(l.entry)}" aria-label="Когда слать">${LORE_WHEN.map(k => `<option value="${k}"${k === l.when ? ' selected' : ''}>${LORE_WHEN_RU[k]}</option>`).join('')}</select>
          <button class="sj-sw2${on ? ' on' : ''}" type="button" role="switch" aria-checked="${on}" data-loretoggle="${esc(l.entry)}" title="${on ? 'Запись включена в этом чате. Нажмите, чтобы выключить: рассказчик её не получит.' : 'Запись выключена в этом чате. Нажмите, чтобы включить.'}"><i></i></button><button class="sj-st" type="button" data-unlink="${esc(l.entry)}" title="Отвязать запись от этого места (сама запись в лорбуке останется)">отвязать</button></div>
        <div class="sj-lmeta">${esc(l.book || 'лорбук не указан')}${l.how ? ` · привязано: ${esc(l.how)}` : ''}${text ? ` · ≈ ${Math.ceil(text.length / 3)} ток.` : ''}</div>
        ${text ? `<div class="sj-ltxt">${esc(text.length > 320 ? `${text.slice(0, 320)}…` : text)}</div>` : '<div class="sj-ltxt none">Текст записи не найден: лорбук не привязан к чату или записи в нём нет. Пока она работает как обычно, по ключам.</div>'}</div>`;
    }).join('');
    const picker = attach.open ? `<div class="sj-attach"><input data-attsearch value="${esc(attach.q)}" placeholder="Найти запись по названию или ключу" aria-label="Поиск записи"><div class="sj-attlist">${attachListHtml(info, n)}</div></div>` : '';
    return panel('Из лорбука', links.length ? 'сюжет, условия, слухи' : '', `${rows || '<div class="sj-none">Записей лорбука у этого места нет. Привяжите кнопкой ниже или при импорте мест из файла.</div>'}<div class="sj-add"><button class="sj-btn" data-act="attachopen">${attach.open ? 'Закрыть выбор' : '+ Привязать запись'}</button></div>${picker}`);
  }

  /** Список записей для привязки: сначала те, чьё название или ключи похожи на название места; уже привязанные и чужие места пропускаются. */
  function attachListHtml(info, n) {
    if (attach.loading) return '<div class="sj-none">Читаю лорбуки…</div>';
    if (attach.error) return `<div class="sj-none">${esc(attach.error)}</div>`;
    const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();
    const mine = new Set((info.placeLinks ?? []).filter(l => l.placeId === n.id).map(l => norm(l.entry)));
    const q = norm(attach.q), name = norm(n.name), names = [name, ...(n.aliases ?? []).map(norm)].filter(Boolean);
    const rank = e => (names.includes(norm(e.entry)) ? 0 : names.some(x => norm(e.entry).includes(x) || e.keys.some(k => norm(k).includes(x))) ? 1 : 2);
    const list = attach.list.filter(e => !e.secret && !mine.has(norm(e.entry)) && (!q || norm(e.entry).includes(q) || e.keys.some(k => norm(k).includes(q)))).sort((a, b) => rank(a) - rank(b) || a.entry.localeCompare(b.entry, 'ru')).slice(0, 40);
    if (!list.length) return '<div class="sj-none">Подходящих записей нет. Лорбук должен быть привязан к чату или персонажу.</div>';
    return list.map(e => `<div class="sj-attrow"><span class="t"><b>${esc(e.entry)}</b><small>${esc(e.book)} · ≈ ${Math.ceil(e.text.length / 3)} ток.${rank(e) < 2 ? ' · похоже на это место' : ''}</small></span><button class="sj-btn" data-attach="${esc(e.book)}|${esc(e.entry)}">Привязать</button></div>`).join('');
  }

  /** Карточка места: тумблер, описание, приметы, перемены; подместа внутри плитками. */
  function placeHtml(info, n) {
    const nodes = info.placeNodes;
    const o = info.map.over[n.id] ?? { traits: [], notes: [] };
    const isHere = info.map.current === n.id;
    const cardOn = !(info.map.off ?? []).includes(n.id);
    const kids = childrenOf(nodes, n.id);
    const sent = info.placeLines.length && isHere ? `<div class="sj-tell"><div class="sj-lbl">Уйдёт рассказчику</div><pre>${esc(info.placeLines.join('\n'))}</pre></div>` : '';
    const aside = `<aside class="sj-maside"><div class="sj-pic${n.image ? '' : ' none'}">${n.image ? `<img src="${esc(n.image)}" alt="${esc(n.name)}">` : `<div class="ph">${ICON_PLACE}<span>картинки нет</span></div>`}</div>
      <div class="sj-add"><label class="sj-btn" title="Загрузить картинку места">${n.image ? 'Сменить картинку' : 'Загрузить картинку'}<input type="file" accept="image/*" data-pimg hidden></label>${n.image ? '<button class="sj-btn" data-act="noimg">Убрать</button>' : ''}</div></aside>`;
    return `<div class="sj-mcols"><div class="sj-mmain"><div class="sj-mhead"><input class="sj-nm" data-pname value="${esc(n.name)}" aria-label="Название"><div class="sj-mmeta">${n.local ? 'место только этого чата' : 'общая библиотека'}</div></div>
      <div class="sj-mbar"><button class="sj-bigsw${cardOn ? ' on' : ''}" role="switch" aria-checked="${cardOn}" data-cardtoggle="${esc(n.id)}"><i></i><span>Карточка ${cardOn ? 'включена' : 'выключена'}<small>${cardOn ? 'уходит рассказчику, когда сцена здесь' : 'рассказчик её не получает'}</small></span></button>
        <button class="sj-btn${isHere ? ' sj-pri' : ''}" data-act="here">${isHere ? '◉ Обстановка здесь' : 'Сделать текущим'}</button>
        <button class="sj-btn sj-del" data-act="delplace" title="Удалить это место${kids.length ? ' вместе с вложенными' : ''}">Удалить${kids.length ? ` (с вложенными: ${kids.length})` : ''}</button></div>
      ${kids.length ? tilesSection(info, 'Внутри', kids, '') : ''}
      ${panel('Описание', 'для сцены: уходит рассказчику, когда герои здесь', `<textarea data-pdesc rows="5" aria-label="Описание">${esc(n.description ?? '')}</textarea>`)}
      ${loreHtml(info, n)}
      ${panel('Приметы', 'что здесь есть', `${n.local ? '' : listHtmlChips(n.traits, 'traits', 'library', true)}${listHtmlChips(n.local ? n.traits : o.traits, 'traits', 'chat', true)}
        <div class="sj-add"><input data-newtrait placeholder="мост из тросов, выжженная трава…" aria-label="Примета"><select data-traitscope style="width:auto"><option value="chat">в этом чате</option>${n.local ? '' : '<option value="library">в библиотеку</option>'}</select><button class="sj-btn" data-act="addtrait">+</button></div>`)}
      ${panel('Перемены', 'что изменилось в этом чате', `${listHtmlChips(n.local ? n.notes : o.notes, 'notes', 'chat', true)}
        <div class="sj-add"><input data-newnote placeholder="мост обрушился, дверь сожжена…" aria-label="Перемена"><button class="sj-btn" data-act="addnote">+</button></div>`)}
      <div class="sj-add"><button class="sj-btn" data-act="addin" title="Подместо внутри этого (в библиотеку)">+ подместо</button><button class="sj-btn" data-act="addinchat" title="Подместо внутри этого, только для этого чата">+ подместо (чат)</button></div>
      <details class="sj-more"><summary>Расположение и удаление</summary>${settingsHtml(info, n)}</details>${sent}</div>${aside}</div>`;
  }

  /** Группа (или самый верх): плитки подгрупп и мест. */
  function groupHtml(info, n, { cards = false } = {}) {
    const nodes = info.placeNodes;
    const items = n ? childrenOf(nodes, n.id) : nodes.filter(x => !x.parentId || !nodes.some(y => y.id === x.parentId));
    const folders = items.filter(x => x.kind === 'folder'), places = items.filter(x => x.kind !== 'folder');
    const head = n ? `<div class="sj-mhead"><input class="sj-nm" data-pname value="${esc(n.name)}" aria-label="Название группы"><div class="sj-mmeta">${n.local ? 'только этот чат' : 'общая библиотека'}</div><button class="sj-btn sj-del" data-act="delplace" title="Удалить группу${childrenOf(nodes, n.id).length ? ' вместе с тем, что в ней' : ''}">Удалить группу${childrenOf(nodes, n.id).length ? ` (внутри: ${childrenOf(nodes, n.id).length})` : ''}</button></div>` : '';
    const innerPlaces = n ? descendantsOf(nodes, n.id).filter(x => x.kind !== 'folder') : [];
    const offSet = new Set(info.map.off ?? []);
    const groupOn = innerPlaces.some(x => !offSet.has(x.id));
    const bar = n && innerPlaces.length ? `<div class="sj-mbar"><button class="sj-bigsw${groupOn ? ' on' : ''}" role="switch" aria-checked="${groupOn}" data-cardtoggle="${esc(n.id)}"><i></i><span>Карточки мест в группе ${groupOn ? 'включены' : 'выключены'}<small>${groupOn ? `выключит все ${innerPlaces.length} разом, и вложенные тоже` : `включит все ${innerPlaces.length} разом`}</small></span></button></div>` : '';
    return `${head}${bar}<div class="sj-add sj-mtools"><button class="sj-btn" data-act="newfolder">+ Группа</button><button class="sj-btn" data-act="newplace">+ Место</button>${(info.map.off ?? []).length ? `<button class="sj-btn" data-act="allon" title="Включить все карточки мест этого чата">Включить все карточки (выключено: ${info.map.off.length})</button>` : ''}<button class="sj-btn" data-act="placefile" title="Загрузить places.json, собранный из заметок Obsidian (tools/places/build_places.py): дерево мест и привязки записей лорбука">Импорт из файла</button><button class="sj-btn" data-act="renest" title="Вернуть вложенность мест и картинки из библиотеки Кулис («Палатка» внутри «Лагеря»)">Вложенность из Кулис</button></div>
      ${cards ? cardsSection(info, n, folders, places) : `${tilesSection(info, n ? 'Подгруппы' : 'Группы', folders, n ? '' : 'Групп пока нет. «+ Группа» создаст первую, «Перенести из Кулис» подтянет ваши.')}
      ${tilesSection(info, 'Места', places, n && !folders.length ? 'Здесь пока пусто. «+ Место» добавит первое.' : '')}`}
      ${n ? `<details class="sj-more"><summary>Настройки группы</summary>${settingsHtml(info, n)}</details>` : ''}`;
  }

  function searchHtml(info, q) {
    return tilesSection(info, 'Найдено', info.placeNodes.filter(n => matches(n, q)), 'Ничего не нашлось.');
  }

  // ---------- вид «Вики»: дерево мест слева, карточка места как статья ----------
  const byName = (a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name, 'ru');
  const rootsOf = nodes => nodes.filter(x => !x.parentId || !nodes.some(y => y.id === x.parentId)).sort(byName);
  const has = (info, f, id) => (info.map[f] ?? []).includes(id);

  function treeHtml(info) {
    const nodes = info.placeNodes, q = search.trim().toLowerCase();
    const here = info.map.current, cur = curId();
    const lore = new Map();
    for (const l of info.placeLinks ?? []) lore.set(l.placeId, (lore.get(l.placeId) ?? 0) + 1);
    const keep = new Set();
    if (q) for (const n of nodes) if (matches(n, q)) for (const c of chainOf(nodes, n.id)) keep.add(c.id);
    const rows = [];
    const walk = (list, depth) => {
      for (const n of list) {
        if (q && !keep.has(n.id)) continue;
        const kids = childrenOf(nodes, n.id).sort(byName);
        const open = q ? true : openNodes.has(n.id);
        const off = has(info, 'off', n.id), isFolder = n.kind === 'folder';
        rows.push(`<div class="sj-tr${n.id === cur ? ' cur' : ''}${isFolder ? ' folder' : ''}${off ? ' off' : ''}" role="treeitem" tabindex="0" draggable="true" data-dropid="${esc(n.id)}" data-open="${esc(n.id)}" style="--d:${depth}" title="${esc(pathOf(nodes, n.id) || n.name)}">
          <span class="car" data-tcar="${esc(n.id)}" role="button" aria-label="${open ? 'Свернуть' : 'Раскрыть'}">${kids.length ? (open ? '▾' : '▸') : ''}</span><span class="nm">${esc(n.name)}</span>
          ${lore.get(n.id) ? `<span class="lc" title="записей лорбука: ${lore.get(n.id)}">${lore.get(n.id)}</span>` : ''}
          <span class="st">${here === n.id ? '<i class="here" title="сцена здесь"></i>' : ''}${has(info, 'seen', n.id) ? '<i class="seen" title="герои бывали"></i>' : ''}${n.danger ? '<i class="danger" title="опасно или закрыто"></i>' : ''}</span></div>`);
        if (kids.length && open) walk(kids, depth + 1);
      }
    };
    walk(rootsOf(nodes), 0);
    const pinned = (info.map.pin ?? []).map(id => nodes.find(n => n.id === id)).filter(Boolean);
    const pins = pinned.length ? `<div class="sj-wlbl">Закреплённые</div>${pinned.map(n => `<div class="sj-tr pin${n.id === cur ? ' cur' : ''}" role="button" tabindex="0" data-open="${esc(n.id)}" style="--d:0"><span class="car">★</span><span class="nm">${esc(n.name)}</span></div>`).join('')}` : '';
    return `${pins}<div class="sj-droproot" data-dropid="">Сюда: на верхний уровень</div><div class="sj-wlbl">Дерево мест<span>${nodes.filter(n => n.kind !== 'folder').length}</span></div>${rows.join('') || '<div class="sj-none">Ничего не нашлось.</div>'}`;
  }

  /** Переключатель в таблице справа: сам переключатель с подписью. */
  const wsw = (cls, on, title, sub, attrs) => `<div class="sj-wsw ${cls}${on ? ' on' : ''}" role="switch" tabindex="0" aria-checked="${on}" ${attrs}><span class="t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="tg"></span></div>`;

  function wikiPlaceHtml(info, n) {
    const nodes = info.placeNodes;
    const o = info.map.over[n.id] ?? { traits: [], notes: [] };
    const isHere = info.map.current === n.id;
    const cardOn = !has(info, 'off', n.id);
    const kids = childrenOf(nodes, n.id).sort(byName);
    const links = (info.placeLinks ?? []).filter(l => l.placeId === n.id);
    const inner = descendantsOf(nodes, n.id).filter(x => x.kind !== 'folder').length;
    const sent = info.placeLines.length && isHere ? `<div class="sj-tell"><div class="sj-lbl">Уйдёт рассказчику</div><pre>${esc(info.placeLines.join('\n'))}</pre></div>` : '';
    const subs = kids.length ? cardsSection(info, n, kids.filter(c => c.kind === 'folder'), kids.filter(c => c.kind !== 'folder')) : '';
    const dl = `<dl class="sj-wdl"><dt>Тип</dt><dd>${esc(n.type || '—')}</dd><dt>Внутри</dt><dd>${esc(pathOf(nodes, n.parentId) || '—')}</dd><dt>Вложено</dt><dd>${inner} мест</dd><dt>Лорбук</dt><dd>${links.length} зап.</dd><dt>Где хранится</dt><dd>${n.local ? 'только этот чат' : 'общая библиотека'}</dd></dl>`;
    const info2 = `<aside class="sj-winfo"><div class="ih">${esc(n.name)}</div>
      <div class="sj-pic${n.image ? '' : ' none'}">${n.image ? `<img src="${esc(n.image)}" alt="${esc(n.name)}">` : `<div class="ph">${ICON_PLACE}<span>картинки нет</span></div>`}</div>
      <div class="sj-add" style="padding:0 12px 6px"><label class="sj-btn" title="Загрузить картинку места">${n.image ? 'Сменить' : 'Загрузить картинку'}<input type="file" accept="image/*" data-pimg hidden></label>${n.image ? '<button class="sj-btn" data-act="noimg">Убрать</button>' : ''}</div>
      <div class="sj-wsws">${wsw('', isHere, 'Сейчас здесь', 'герои в этом месте: оно становится местом сцены', 'data-act="heretoggle"')}${wsw('', cardOn, 'Рассказчик знает', 'карточка и привязанные записи уходят в запрос', `data-cardtoggle="${esc(n.id)}"`)}${wsw('seen', has(info, 'seen', n.id), 'Герои бывали', '', 'data-flag="seen"')}${wsw('', has(info, 'pin', n.id), 'Закреплено', 'показывать выше дерева', 'data-flag="pin"')}${wsw('warn', Boolean(n.danger), 'Опасно или закрыто', 'красная отметка на дереве', 'data-flag="danger"')}</div>${dl}</aside>`;
    return `<div class="sj-wart"><div class="sj-wbody">
        ${crumbsHtml(info, n.id)}
        <div class="sj-mhead"><input class="sj-nm" data-pname value="${esc(n.name)}" aria-label="Название"><div class="sj-mmeta">${(n.aliases ?? []).length ? `также: ${esc(n.aliases.join(', '))}` : ''}</div></div>
        ${panel('Описание', 'для сцены: уходит рассказчику, когда герои здесь', `<textarea data-pdesc rows="6" aria-label="Описание">${esc(n.description ?? '')}</textarea>`)}
        ${panel('Приметы', 'что здесь есть', `${n.local ? '' : listHtmlChips(n.traits, 'traits', 'library', true)}${listHtmlChips(n.local ? n.traits : o.traits, 'traits', 'chat', true)}
          <div class="sj-add"><input data-newtrait placeholder="мост из тросов, выжженная трава…" aria-label="Примета"><select data-traitscope style="width:auto"><option value="chat">в этом чате</option>${n.local ? '' : '<option value="library">в библиотеку</option>'}</select><button class="sj-btn" data-act="addtrait">+</button></div>`)}
        ${panel('Перемены', 'что изменилось в этом чате', `${listHtmlChips(n.local ? n.notes : o.notes, 'notes', 'chat', true)}
          <div class="sj-add"><input data-newnote placeholder="мост обрушился, дверь сожжена…" aria-label="Перемена"><button class="sj-btn" data-act="addnote">+</button></div>`)}
        ${subs}
        ${loreHtml(info, n)}
        <div class="sj-add"><button class="sj-btn" data-act="addin" title="Подместо внутри этого (в библиотеку)">+ подместо</button><button class="sj-btn" data-act="addinchat" title="Подместо внутри этого, только для этого чата">+ подместо (чат)</button>
          <button class="sj-btn sj-del" data-act="delplace" title="Удалить это место${kids.length ? ' вместе с вложенными' : ''}">Удалить${kids.length ? ` (с вложенными: ${kids.length})` : ''}</button></div>
        <details class="sj-more"><summary>Расположение и псевдонимы</summary>${settingsHtml(info, n)}</details>${sent}
      </div>${info2}</div>`;
  }

  /** Короткий текст для карточки: первая фраза описания. */
  const snippet = (s, n = 110) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

  /** Карточка подместа или подгруппы в виде «Вики»: картинка, название, начало описания, отметки и быстрое «Мы здесь». */
  function wikiCard(info, c) {
    const nodes = info.placeNodes;
    const isFolder = c.kind === 'folder';
    const kids = childrenOf(nodes, c.id);
    const here = info.map.current === c.id;
    const off = has(info, 'off', c.id);
    const lore = (info.placeLinks ?? []).filter(l => l.placeId === c.id).length;
    const chips = [c.type, kids.length ? `внутри: ${kids.length}` : '', lore ? `лорбук: ${lore}` : '', off ? 'рассказчик не знает' : ''].filter(Boolean).map(x => `<span class="sj-wchip">${esc(x)}</span>`).join('');
    return `<div class="sj-wcard${here ? ' here' : ''}${off ? ' off' : ''}${isFolder ? ' folder' : ''}" role="button" tabindex="0" draggable="true" data-dropid="${esc(c.id)}" data-open="${esc(c.id)}">
      <div class="im">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : (isFolder ? ICON_FOLDER : ICON_PLACE)}${here ? '<span class="badge">сцена здесь</span>' : ''}</div>
      <div class="bd"><h4>${esc(c.name)}<span class="st">${here ? '<i class="here"></i>' : ''}${has(info, 'seen', c.id) ? '<i class="seen"></i>' : ''}${c.danger ? '<i class="danger"></i>' : ''}</span></h4>
        ${isFolder ? '' : `<p>${esc(snippet(c.description))}</p>`}<div class="mt">${chips}</div>
        ${isFolder || here ? '' : `<div class="qa"><button class="sj-btn" data-hereid="${esc(c.id)}">Мы здесь</button></div>`}</div></div>`;
  }

  function cardsSection(info, n, folders, places) {
    const f = {
      all: () => true, seen: c => has(info, 'seen', c.id), unseen: c => !has(info, 'seen', c.id), danger: c => Boolean(c.danger),
    }[groupFilter] ?? (() => true);
    const shown = places.filter(f).sort(byName);
    const count = k => places.filter({ all: () => true, seen: c => has(info, 'seen', c.id), unseen: c => !has(info, 'seen', c.id), danger: c => Boolean(c.danger) }[k]).length;
    const bar = places.length ? `<div class="sj-wbar" role="group" aria-label="Фильтр">${[['all', 'Все'], ['seen', 'Были'], ['unseen', 'Не были'], ['danger', 'Опасные']].map(([k, ru]) => `<button type="button" data-gfilter="${k}" aria-pressed="${groupFilter === k}">${ru} · ${count(k)}</button>`).join('')}</div>` : '';
    const groups = folders.length ? `<section class="sj-mp"><header><h3>${n ? 'Подгруппы' : 'Группы'}</h3><span>${folders.length}</span></header><div class="sj-wcards">${folders.sort(byName).map(c => wikiCard(info, c)).join('')}</div></section>` : (n ? '' : '<div class="sj-none">Групп пока нет. «+ Группа» создаст первую, «Перенести из Кулис» или «Импорт из файла» подтянут ваши.</div>');
    const items = places.length ? `<section class="sj-mp"><header><h3>Места</h3><span>${shown.length}</span></header>${bar}${shown.length ? `<div class="sj-wcards">${shown.map(c => wikiCard(info, c)).join('')}</div>` : '<div class="sj-none">По этому фильтру пусто.</div>'}</section>` : (n && !folders.length ? '<div class="sj-none">Здесь пока пусто. «+ Место» добавит первое.</div>' : '');
    return `${groups}${items}`;
  }

  /** Список всех мест таблицей: переключатели прямо в строках, без открытия карточек. */
  function listHtml(info) {
    const nodes = info.placeNodes, q = search.trim().toLowerCase();
    const links = new Map();
    for (const l of info.placeLinks ?? []) links.set(l.placeId, (links.get(l.placeId) ?? 0) + 1);
    const all = nodes.filter(n => n.kind !== 'folder');
    const pass = {
      all: () => true, seen: n => has(info, 'seen', n.id), know: n => !has(info, 'off', n.id), danger: n => Boolean(n.danger),
    };
    const rows = all.filter(n => (!q || matches(n, q)) && (pass[listFilter] ?? pass.all)(n)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const tg = (on, kind, attrs, label) => `<span class="sj-ltg ${kind}${on ? ' on' : ''}" role="switch" tabindex="0" aria-checked="${on}" aria-label="${label}" ${attrs}></span>`;
    const body = rows.slice(0, 500).map(n => {
      const parent = n.parentId ? pathOf(nodes, n.parentId) : '';
      const chars = (n.description ?? '').length + (n.traits ?? []).join(' ').length;
      return `<tr class="${info.map.current === n.id ? 'cur' : ''}"><td><a class="sj-wl" data-lopen="${esc(n.id)}">${esc(n.name)}</a>${links.get(n.id) ? `<span class="sj-wchip" title="записей лорбука">${links.get(n.id)}</span>` : ''}</td><td class="sub">${esc(parent || '—')}</td>
        <td class="c">${tg(info.map.current === n.id, '', `data-hid="${esc(n.id)}"`, 'Сейчас здесь')}</td><td class="c">${tg(!has(info, 'off', n.id), '', `data-cardtoggle="${esc(n.id)}"`, 'Рассказчик знает')}</td>
        <td class="c">${tg(has(info, 'seen', n.id), 'seen', `data-flag="seen" data-fid="${esc(n.id)}"`, 'Герои бывали')}</td><td class="c">${tg(Boolean(n.danger), 'warn', `data-flag="danger" data-fid="${esc(n.id)}"`, 'Опасно или закрыто')}</td><td class="num">${chars ? Math.ceil(chars / 3) : '—'}</td></tr>`;
    }).join('');
    const bar = `<div class="sj-wbar" role="group" aria-label="Фильтр">${[['all', 'Все', all.length], ['seen', 'Были', all.filter(pass.seen).length], ['know', 'Рассказчик знает', all.filter(pass.know).length], ['danger', 'Опасные', all.filter(pass.danger).length]].map(([k, ru, c]) => `<button type="button" data-lfilter="${k}" aria-pressed="${listFilter === k}">${ru} · ${c}</button>`).join('')}</div>`;
    return `<div class="sj-wkm list"><section class="sj-wmain"><div class="sj-listtop"><input data-search value="${esc(search)}" placeholder="Поиск места" aria-label="Поиск">${bar}
      <span class="sj-listbtns"><button class="sj-btn" data-act="newplace">+ Место</button><button class="sj-btn" data-act="newfolder">+ Группа</button><button class="sj-btn" data-act="placefile" title="Загрузить places.json, собранный из заметок Obsidian">Импорт из файла</button></span></div>
      <table class="sj-ltbl"><thead><tr><th>Место</th><th>Внутри</th><th class="c">Сейчас</th><th class="c">Знает</th><th class="c">Бывали</th><th class="c">Опасно</th><th class="num">Токены</th></tr></thead><tbody>${body || '<tr><td colspan="7" class="sub">Ничего не нашлось.</td></tr>'}</tbody></table>
      ${rows.length > 500 ? `<div class="sj-sub">Показано 500 из ${rows.length}: уточните поиск.</div>` : ''}<div class="sj-sub" style="margin-top:6px">«Сейчас» включён у одного места: при включении другого прежнее выключается само.</div></section></div>`;
  }

  function wikiHtml(info) {
    const nodes = info.placeNodes;
    const sel = selected ? nodes.find(n => n.id === selected) : null;
    const grp = !sel && path ? nodes.find(n => n.id === path) : null;
    const q = search.trim().toLowerCase();
    const main = sel ? wikiPlaceHtml(info, sel) : `${crumbsHtml(info, path)}${groupHtml(info, grp, { cards: true })}`;
    return `<div class="sj-wkm"><aside class="sj-wtree"><input data-search value="${esc(search)}" placeholder="Поиск места" aria-label="Поиск">${treeHtml(info)}</aside><section class="sj-wmain">${main}</section></div>`;
  }

  function render() {
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    shell.theme(info.state.calendar);
    const nodes = info.placeNodes;
    if (selected && !nodes.some(n => n.id === selected)) selected = '';
    if (path && !nodes.some(n => n.id === path)) path = '';
    if (isMobile()) { renderMobile(info); return; }
    const q = search.trim().toLowerCase();
    const sel = selected ? nodes.find(n => n.id === selected) : null;
    const grp = !sel && path ? nodes.find(n => n.id === path) : null;
    const plan = scene().previewKulisyMap?.();
    const kulisy = plan && (plan.freshLib || plan.chatPlaces) ? `<div class="sj-import"><div class="sj-sub">У Кулис: в библиотеке новых ${plan.freshLib}, мест этого чата ${plan.chatPlaces}.</div><button class="sj-btn sj-pri" data-act="import">Перенести из Кулис</button></div>` : '';
    const cur = info.map.current ? nodes.find(n => n.id === info.map.current) : null;
    const body = q ? searchHtml(info, q) : sel ? placeHtml(info, sel) : groupHtml(info, grp);
    const crumbs = q ? '' : crumbsHtml(info, sel ? sel.id : path);
    const back = !q && (sel || path) ? '<button class="sj-btn" data-act="back">← Назад</button>' : '';
    const viewSw = `<span class="sj-viewsw" role="group" aria-label="Вид"><button type="button" data-view="wiki" aria-pressed="${view === 'wiki'}">Вики</button><button type="button" data-view="list" aria-pressed="${view === 'list'}">Список</button><button type="button" data-view="tiles" aria-pressed="${view === 'tiles'}">Плитки</button></span>`;
    win.innerHTML = `<div class="sj-wh"><h2>Карта</h2><span class="sj-sub">${cur ? `сцена: ${esc(pathOf(nodes, cur.id))}` : 'текущее место не выбрано'}${note ? ` · ${esc(note)}` : ''}</span>${viewSw}<button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      ${view === 'list' ? `<div class="sj-mapbody wiki">${kulisy}${listHtml(info)}</div>` : view === 'wiki' ? `<div class="sj-mapbody wiki">${kulisy}${wikiHtml(info)}</div>` : `<div class="sj-mapbody"><div class="sj-maptop">${back}<input data-search value="${esc(search)}" placeholder="Поиск места" aria-label="Поиск">${crumbs}</div>${kulisy}${body}</div>`}`;
  }

  // ---------- телефон: один простой список, карточка места с раскрывающимися разделами ----------
  const isMobile = () => Boolean(document.documentElement.dataset.sjMobile);
  const mdOpen = new Set();          // раскрытые разделы карточки (помнятся между перерисовками)
  win.addEventListener('toggle', e => { const k = e.target?.dataset?.mdk; if (k) { if (e.target.open) mdOpen.add(k); else mdOpen.delete(k); } }, true);
  const mtog = (on, title, sub, attrs) => `<div class="sj-trow sj-mtog" role="switch" tabindex="0" aria-checked="${on}" ${attrs}><span class="tx">${title}<small>${sub}</small></span><span class="sj-sw2 big${on ? ' on' : ''}"><i></i></span></div>`;
  const mdet = (key, title, inner) => `<details class="sj-mdet2" data-mdk="${key}"${mdOpen.has(key) ? ' open' : ''}><summary>${title}</summary><div class="in">${inner}</div></details>`;

  function mobileRow(info, n) {
    const isFolder = n.kind === 'folder';
    const kids = childrenOf(info.placeNodes, n.id);
    const here = info.map.current === n.id;
    const off = has(info, 'off', n.id);
    const sub = isFolder ? (kids.length ? `внутри: ${kids.length}` : 'пусто') : snippet(n.description, 70);
    return `<button type="button" class="sj-mrow${here ? ' here' : ''}${off ? ' off' : ''}" data-open="${esc(n.id)}"><span class="ico${n.image ? ' photo' : ''}">${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy">` : isFolder ? ICON_FOLDER : ICON_PLACE}</span><span class="tx"><b>${esc(n.name)}</b><small>${esc(sub)}${n.danger ? `${sub ? ' · ' : ''}опасно` : ''}</small></span>${here ? '<span class="bd">здесь</span>' : ''}<span class="go">›</span></button>`;
  }

  function mobilePlace(info, n) {
    const nodes = info.placeNodes;
    const o = info.map.over[n.id] ?? { traits: [], notes: [] };
    const isHere = info.map.current === n.id;
    const cardOn = !has(info, 'off', n.id);
    const kids = childrenOf(nodes, n.id).sort(byName);
    const links = (info.placeLinks ?? []).filter(l => l.placeId === n.id);
    const traits = (n.local ? '' : listHtmlChips(n.traits, 'traits', 'library', true)) + listHtmlChips(n.local ? n.traits : o.traits, 'traits', 'chat', true);
    const notes = listHtmlChips(n.local ? n.notes : o.notes, 'notes', 'chat', true);
    const sent = info.placeLines.length && isHere ? `<div class="sj-tell"><div class="sj-lbl">Уйдёт рассказчику</div><pre>${esc(info.placeLines.join('\n'))}</pre></div>` : '';
    return `${n.image ? `<div class="sj-mpic"><img src="${esc(n.image)}" alt="${esc(n.name)}"></div>` : ''}
      <div class="sj-sgrp">${mtog(isHere, 'Сейчас здесь', 'герои тут: место становится местом сцены', 'data-act="heretoggle"')}${mtog(cardOn, 'Рассказчик знает', 'карточка и записи лорбука уходят в запрос', `data-cardtoggle="${esc(n.id)}"`)}</div>
      <div class="sj-sgrp"><div class="gh">Описание</div><textarea class="sj-mdesc" data-pdesc rows="5" aria-label="Описание">${esc(n.description ?? '')}</textarea></div>
      ${kids.length ? `<div class="sj-sgrp"><div class="gh">Внутри</div>${kids.map(k => mobileRow(info, k)).join('')}</div>` : ''}
      ${mdet('traits', `Приметы${(n.local ? n.traits : [...n.traits, ...o.traits]).length ? ` · ${(n.local ? n.traits : [...n.traits, ...o.traits]).length}` : ''}`, `${traits}<div class="sj-add"><input data-newtrait placeholder="мост из тросов, выжженная трава…" aria-label="Примета"><select data-traitscope style="width:auto"><option value="chat">в этом чате</option>${n.local ? '' : '<option value="library">в библиотеку</option>'}</select><button class="sj-btn" data-act="addtrait">+</button></div>`)}
      ${mdet('notes', `Перемены${(n.local ? n.notes : o.notes).length ? ` · ${(n.local ? n.notes : o.notes).length}` : ''}`, `${notes}<div class="sj-add"><input data-newnote placeholder="мост обрушился, дверь сожжена…" aria-label="Перемена"><button class="sj-btn" data-act="addnote">+</button></div>`)}
      ${mdet('lore', `Из лорбука${links.length ? ` · ${links.length}` : ''}`, loreHtml(info, n))}
      ${mdet('place', 'Название, расположение, удаление', `<input class="sj-nm" data-pname value="${esc(n.name)}" aria-label="Название">${settingsHtml(info, n)}<div class="sj-add"><label class="sj-btn">${n.image ? 'Сменить картинку' : 'Загрузить картинку'}<input type="file" accept="image/*" data-pimg hidden></label>${n.image ? '<button class="sj-btn" data-act="noimg">Убрать картинку</button>' : ''}<button class="sj-btn" data-act="addin">+ подместо</button></div>`)}
      ${sent}`;
  }

  function renderMobile(info) {
    const nodes = info.placeNodes;
    const q = search.trim().toLowerCase();
    const sel = selected ? nodes.find(n => n.id === selected) : null;
    const grp = !sel && path ? nodes.find(n => n.id === path) : null;
    const cur = info.map.current ? nodes.find(n => n.id === info.map.current) : null;
    const plan = scene().previewKulisyMap?.();
    const kulisy = plan && (plan.freshLib || plan.chatPlaces) ? `<button class="sj-btn sj-pri" data-act="import" style="width:100%;margin-bottom:8px">Перенести из Кулис</button>` : '';
    const title = sel ? sel.name : grp ? grp.name : 'Карта';
    const back = !q && (sel || grp) ? '<button class="sj-btn sj-back" data-act="back" aria-label="Назад">‹</button>' : '';
    const subtitle = sel || grp ? pathOf(nodes, (sel ?? grp).id) : (cur ? `сцена: ${pathOf(nodes, cur.id)}` : 'место сцены не выбрано');
    let body;
    if (q) {
      const found = nodes.filter(n => matches(n, q)).sort(byName);
      body = found.length ? `<div class="sj-sgrp">${found.map(n => mobileRow(info, n)).join('')}</div>` : '<div class="sj-none">Ничего не нашлось.</div>';
    } else if (sel) {
      body = mobilePlace(info, sel);
    } else {
      const items = (grp ? childrenOf(nodes, grp.id) : nodes.filter(x => !x.parentId || !nodes.some(y => y.id === x.parentId))).sort(byName);
      const inner = grp ? descendantsOf(nodes, grp.id).filter(x => x.kind !== 'folder') : [];
      const groupOn = inner.some(x => !(info.map.off ?? []).includes(x.id));
      const nowBtn = cur && (!grp || cur.id !== grp.id) ? `<button type="button" class="sj-mnow" data-open="${esc(cur.id)}"><span>Сцена сейчас</span><b>${esc(cur.name)}</b><span class="go">›</span></button>` : '';
      const more = `${(info.map.off ?? []).length ? '<button class="sj-btn" data-act="allon">Включить все карточки</button>' : ''}<button class="sj-btn" data-act="placefile">Импорт из файла</button><button class="sj-btn" data-act="renest">Вложенность из Кулис</button>`;
      body = `${kulisy}${nowBtn}${grp && inner.length ? `<div class="sj-sgrp">${mtog(groupOn, 'Рассказчик знает места группы', groupOn ? `выключит все ${inner.length} разом` : `включит все ${inner.length} разом`, `data-cardtoggle="${esc(grp.id)}"`)}</div>` : ''}
        ${items.length ? `<div class="sj-sgrp">${items.map(n => mobileRow(info, n)).join('')}</div>` : `<div class="sj-none">${grp ? 'Здесь пока пусто.' : 'Мест пока нет.'} Кнопки ниже добавят первое.</div>`}
        <div class="sj-add" style="margin-top:4px"><button class="sj-btn sj-pri" data-act="newplace">+ Место</button><button class="sj-btn" data-act="newfolder">+ Группа</button></div>
        ${mdet('more', 'Ещё', `<div class="sj-add">${more}</div>`)}
        ${grp ? mdet('grp', 'Название и удаление группы', `<input class="sj-nm" data-pname value="${esc(grp.name)}" aria-label="Название группы">${settingsHtml(info, grp)}`) : ''}`;
    }
    win.innerHTML = `<div class="sj-wh">${back}<h2>${esc(title)}</h2><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button><span class="sj-sub">${esc(subtitle)}${note ? ` · ${esc(note)}` : ''}</span></div>
      <div class="sj-mapm">${sel ? '' : `<input class="sj-ssearch" data-search value="${esc(search)}" placeholder="Найти место" aria-label="Найти место" type="search" autocomplete="off">`}${body}</div>`;
  }

  /** Скрытое поле выбора файла для «Импорт из файла…»: читает places.json, показывает, что изменится, и спрашивает подтверждение. */
  let fileEl = null;
  const fileInput = () => {
    if (fileEl) return fileEl;
    fileEl = document.createElement('input');
    fileEl.type = 'file'; fileEl.accept = '.json,application/json'; fileEl.hidden = true;
    fileEl.addEventListener('change', async () => {
      const f = fileEl.files?.[0]; fileEl.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const pre = scene().previewPlaceFile(data);
        if (!pre.ok) { note = pre.error; return render(); }
        const lines = `Новых мест и групп: ${pre.added}, обновится: ${pre.updated}, без изменений: ${pre.same}. Привязок записей лорбука: ${pre.links}.${pre.imagesSkipped ? ` Картинок с неверным адресом: ${pre.imagesSkipped}, они пропущены.` : ''}`;
        if (!window.confirm(`Импорт мест${pre.world ? ` «${pre.world}»` : ''}.\n${lines}\nВаши картинки и свои приметы остаются. Продолжить?`)) return;
        const r = scene().importPlaceFile(data);
        note = r.ok ? `импорт: новых ${r.added}, обновлено ${r.updated}, привязок ${r.links}` : r.error;
      } catch (e) { note = `не удалось прочитать файл: ${e?.message ?? e}`; }
      render();
    });
    document.body.append(fileEl);
    return fileEl;
  };

  const goTo = id => {
    const nodes = scene().get().placeNodes;
    const n = nodes.find(x => x.id === id);
    if (!id || !n) { path = ''; selected = ''; return; }
    if (n.kind === 'folder') { path = id; selected = ''; } else { selected = id; path = folderAbove(nodes, id); }
    for (const c of chainOf(nodes, id)) openNodes.add(c.id);
    search = '';
  };

  const onClick = event => {
    const t = event.target;
    const lt = t.closest('[data-loretoggle]'); if (lt) { event.stopPropagation(); scene().toggleLore(curId(), lt.dataset.loretoggle); return; }
    const ct = t.closest('[data-cardtoggle]'); if (ct) { event.stopPropagation(); scene().togglePlaceCard(ct.dataset.cardtoggle); return; }
    const dt = t.closest('[data-deltile]');
    if (dt) {
      event.stopPropagation();
      const nodes0 = scene().get().placeNodes, id0 = dt.dataset.deltile, n0 = nodes0.find(x => x.id === id0);
      const inside = nodes0.filter(x => x.parentId === id0).length;
      if (n0 && window.confirm(`Удалить «${n0.name}»${inside ? ` вместе с вложенными (${inside})` : ''}?`)) { scene().removePlace(id0); if (selected === id0) selected = ''; if (path === id0) path = ''; render(); }
      return;
    }
    const vw = t.closest('[data-view]'); if (vw) { view = ['tiles', 'list'].includes(vw.dataset.view) ? vw.dataset.view : 'wiki'; settings.mapView = view; try { deps.save?.(); } catch { /* сохранится позже */ } return render(); }
    const car = t.closest('[data-tcar]'); if (car) { event.stopPropagation(); const id = car.dataset.tcar; if (openNodes.has(id)) openNodes.delete(id); else openNodes.add(id); return render(); }
    const gf = t.closest('[data-gfilter]'); if (gf) { groupFilter = gf.dataset.gfilter; return render(); }
    const lf = t.closest('[data-lfilter]'); if (lf) { listFilter = lf.dataset.lfilter; return render(); }
    const lo = t.closest('[data-lopen]'); if (lo) { event.preventDefault(); view = 'wiki'; goTo(lo.dataset.lopen); return render(); }
    const att = t.closest('[data-attach]');
    if (att) { const [book, ...rest] = att.dataset.attach.split('|'); const entry = rest.join('|'); event.stopPropagation(); scene().addPlaceLink(curId(), { entry, book }); return; }
    const unl = t.closest('[data-unlink]'); if (unl) { event.stopPropagation(); if (window.confirm(`Отвязать запись «${unl.dataset.unlink}» от этого места? Сама запись в лорбуке останется.`)) scene().removePlaceLink(curId(), unl.dataset.unlink); return; }
    const hid = t.closest('[data-hid]'); if (hid) { event.stopPropagation(); const cur = scene().get().map.current; scene().setCurrentPlace(cur === hid.dataset.hid ? '' : hid.dataset.hid); return; }
    const hr = t.closest('[data-hereid]'); if (hr) { event.stopPropagation(); scene().setCurrentPlace(hr.dataset.hereid); return; }
    const fl = t.closest('[data-flag]');
    if (fl) {
      event.stopPropagation();
      const id = fl.dataset.fid || curId(), f = fl.dataset.flag;
      if (f === 'danger') { const n = scene().get().placeNodes.find(x => x.id === id); scene().updatePlace(id, { danger: !n?.danger }); } else scene().togglePlaceFlag(id, f);
      return;
    }
    const op = t.closest('[data-open]'); if (op) { goTo(op.dataset.open); return render(); }
    const go = t.closest('[data-go]'); if (go) { goTo(go.dataset.go); return render(); }
    const del = t.closest('[data-deltext]');
    if (del) { const [field, scope] = del.dataset.deltext.split('|'); scene().placeText(selected, field, del.dataset.text, scope, true); return; }
    const act = t.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const nodes = scene().get().placeNodes;
    if (act === 'close') return shell.close();
    if (act === 'back') { const up = selected ? folderAbove(nodes, selected) : (nodes.find(n => n.id === path)?.parentId ?? ''); selected = ''; path = nodes.some(n => n.id === up) ? up : ''; return render(); }
    if (act === 'newplace' || act === 'newfolder') {
      const name = window.prompt(act === 'newfolder' ? 'Название группы' : 'Название места');
      if (name) { const id = scene().addPlace({ name, kind: act === 'newfolder' ? 'folder' : 'place', parentId: path }); if (id) { if (act === 'newfolder') path = id; else selected = id; } }
      return;
    }
    if (act === 'addin' || act === 'addinchat') { const name = window.prompt('Название подместа'); if (name) { const id = scene().addPlace({ name, parentId: selected, scope: act === 'addinchat' ? 'chat' : 'library' }); if (id) selected = id; } return; }
    if (act === 'here') { scene().setCurrentPlace(selected); return; }
    if (act === 'attachopen') {
      attach.open = !attach.open;
      if (attach.open && !attach.list.length) {
        attach.loading = true; attach.error = '';
        shared.placeLore?.entries?.().then(list => { attach.list = list; attach.loading = false; render(); }).catch(e => { attach.loading = false; attach.error = `не удалось прочитать лорбуки: ${e?.message ?? e}`; render(); });
      }
      return render();
    }
    if (act === 'heretoggle') { scene().setCurrentPlace(scene().get().map.current === selected ? '' : selected); return; }
    if (act === 'delplace') {
      if (!window.confirm('Удалить это?')) return;
      const id = curId(); const up = nodes.find(n => n.id === id)?.parentId ?? '';
      scene().removePlace(id); selected = ''; path = nodes.some(n => n.id === up && n.kind === 'folder') ? up : ''; return render();
    }
    if (act === 'addtrait') { const box = win.querySelector('[data-newtrait]'); if (!scene().placeText(selected, 'traits', box.value, win.querySelector('[data-traitscope]').value)) box.classList.add('sj-bad'); return; }
    if (act === 'addnote') { const box = win.querySelector('[data-newnote]'); if (!scene().placeText(selected, 'notes', box.value, 'chat')) box.classList.add('sj-bad'); return; }
    if (act === 'allon') { scene().enableAllPlaceCards(); return; }
    if (act === 'noimg') { scene().updatePlace(selected, { image: '' }); return; }
    if (act === 'renest') {
      note = 'Восстанавливаю вложенность…'; render();
      scene().restoreMapNesting({ force: true }).then(r => { note = `вложено мест: ${r.nested}, картинок подтянуто: ${r.images}`; render(); }).catch(e => { note = `не вышло: ${e?.message ?? e}`; render(); });
      return;
    }
    if (act === 'placefile') { fileInput().click(); return; }
    if (act === 'import') { const r = scene().importMapFromKulisy(); note = r.ok ? `перенесено: библиотека ${r.library}, мест чата ${r.places}` : 'Кулисы не найдены'; render(); }
  };
  const onChange = event => {
    const el = event.target, d = el.dataset, id = curId();
    if (d.pname !== undefined) scene().updatePlace(id, { name: el.value });
    else if (d.pparent !== undefined) scene().updatePlace(id, { parentId: el.value });
    else if (d.palias !== undefined) scene().updatePlace(id, { aliases: el.value });
    else if (d.pdesc !== undefined) scene().updatePlace(id, { description: el.value });
    else if (d.lorewhen !== undefined) scene().setLoreWhen(id, d.entry, el.value);
    else if (d.pimg !== undefined && el.files?.[0]) {
      note = 'Сохраняю картинку…'; render();
      shared.cards.uploadImage(el.files[0], 'SceneJournalPlaces', id)
        .then(path => { scene().updatePlace(id, { image: path }); note = ''; render(); })
        .catch(e => { note = `картинка не сохранилась: ${e?.message ?? e}`; render(); });
    }
  };
  const onInput = event => {
    if (event.target.dataset.attsearch !== undefined) { attach.q = event.target.value; const box = win.querySelector('.sj-attlist'); const info = scene().get(); const n = info.placeNodes.find(x => x.id === curId()); if (box && n) box.innerHTML = attachListHtml(info, n); return; }
    if (event.target.dataset.search !== undefined) { search = event.target.value; const pos = event.target.selectionStart; render(); const b = win.querySelector('[data-search]'); b?.focus(); b?.setSelectionRange(pos, pos); } };
  const onKey = event => {
    const d = event.target.dataset ?? {};
    if ((event.key === 'Enter' || event.key === ' ') && (d.cardtoggle !== undefined || d.open !== undefined || d.flag !== undefined || d.hid !== undefined || d.act === 'heretoggle')) { event.preventDefault(); event.target.click(); return; }
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (d.newtrait !== undefined) { event.preventDefault(); win.querySelector('[data-act="addtrait"]')?.click(); }
    else if (d.newnote !== undefined) { event.preventDefault(); win.querySelector('[data-act="addnote"]')?.click(); }
  };
  // ---------- перетаскивание: положить место в другое, как файл в папку ----------
  let dragId = '';
  /** Можно ли положить dragId в targetId ('' = на верхний уровень): без циклов, чужой чат в общую библиотеку не кладётся, группа только в группу. */
  const canDrop = (id, targetId) => {
    const nodes = scene().get().placeNodes;
    const a = nodes.find(n => n.id === id), b = targetId ? nodes.find(n => n.id === targetId) : null;
    if (!a || (targetId && !b) || id === targetId) return false;
    if ((a.parentId || '') === (targetId || '')) return false;                       // уже лежит там
    if (!canMove(nodes, id, targetId)) return false;                                  // нельзя в собственного потомка
    if (b && b.local && !a.local) return false;                                       // место из общей библиотеки не кладётся в место только этого чата
    if (a.kind === 'folder' && b && b.kind !== 'folder') return false;               // группа кладётся только в группу
    return true;
  };
  const clearOver = () => { for (const el of win.querySelectorAll('.sj-dragover')) el.classList.remove('sj-dragover'); };
  const onDragStart = event => {
    const el = event.target.closest?.('[draggable="true"][data-open]');
    if (!el) return;
    dragId = el.dataset.open;
    try { event.dataTransfer.setData('text/plain', dragId); event.dataTransfer.effectAllowed = 'move'; } catch { /* без данных тоже работает */ }
    el.classList.add('sj-dragging');
    win.classList.add('dragging-node');
  };
  const onDragOver = event => {
    if (!dragId) return;
    const t = event.target.closest?.('[data-dropid]');
    clearOver();
    if (!t || !canDrop(dragId, t.dataset.dropid)) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = 'move'; } catch { /* не страшно */ }
    t.classList.add('sj-dragover');
  };
  const onDrop = event => {
    const t = event.target.closest?.('[data-dropid]');
    const id = dragId || (() => { try { return event.dataTransfer.getData('text/plain'); } catch { return ''; } })();
    dragId = ''; win.classList.remove('dragging-node'); clearOver();
    if (!t || !id) return;
    const targetId = t.dataset.dropid;
    if (!canDrop(id, targetId)) return;
    event.preventDefault();
    const nodes = scene().get().placeNodes;
    const a = nodes.find(n => n.id === id), b = targetId ? nodes.find(n => n.id === targetId) : null;
    scene().updatePlace(id, { parentId: targetId });
    if (targetId) openNodes.add(targetId);
    note = b ? `«${a.name}» теперь внутри «${b.name}»` : `«${a.name}» вынесено на верхний уровень`;
    render();
  };
  const onDragEnd = () => { dragId = ''; win.classList.remove('dragging-node'); clearOver(); for (const el of win.querySelectorAll('.sj-dragging')) el.classList.remove('sj-dragging'); };
  win.addEventListener('dragstart', onDragStart);
  win.addEventListener('dragover', onDragOver);
  win.addEventListener('drop', onDrop);
  win.addEventListener('dragend', onDragEnd);
  win.addEventListener('click', onClick);
  win.addEventListener('change', onChange);
  win.addEventListener('input', onInput);
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
    note = ''; search = '';
    if (info.map.current) goTo(info.map.current); else if (!selected) path = '';
    shell.show(info.state.calendar);
    render();
    win.focus();
    // один раз: вернуть вложенность и картинки мест из библиотеки Кулис (при первом переносе места легли плоско)
    scene().restoreMapNesting().then(r => { if (r.nested || r.images) { note = `восстановлено: вложено мест ${r.nested}, картинок ${r.images}`; if (shell.isOpen) render(); } }).catch(() => {});
  }
  shared.ui = { ...(shared.ui ?? {}), openMap: openWindow, closeMap: shell.close };
  return () => {
    unsubscribe?.();
    win.removeEventListener('dragstart', onDragStart);
    win.removeEventListener('dragover', onDragOver);
    win.removeEventListener('drop', onDrop);
    win.removeEventListener('dragend', onDragEnd);
    win.removeEventListener('click', onClick);
    win.removeEventListener('change', onChange);
    win.removeEventListener('input', onInput);
    win.removeEventListener('keydown', onKey);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openMap; delete shared.ui.closeMap; }
  };
}
