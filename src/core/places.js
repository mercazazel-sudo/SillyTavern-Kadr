/**
 * Карта: дерево мест с карточками. Общая библиотека (места и папки, одна на все чаты) плюс слой чата:
 * места, найденные в этом чате, и «находки и перемены» (приметы и заметки), которые относятся только к этому чату.
 * Текущее место чата выбирается из дерева; рассказчику уходит карточка текущего места.
 * Чистая логика: Таверны и DOM не знает.
 */
export const LIMITS = Object.freeze({ nodes: 900, name: 80, aliases: 8, description: 2500, traits: 14, notes: 8, text: 160 });

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clipProse = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const list = (v, max, len) => [...new Set((Array.isArray(v) ? v : []).map(x => clip(x, len)).filter(Boolean))].slice(0, max);

function normNodes(raw, { chat = false } = {}) {
  const out = [], ids = new Set();
  for (const n of Array.isArray(raw) ? raw : []) {
    const id = clip(n?.id, 64), name = clip(n?.name, LIMITS.name);
    if (!id || !name || ids.has(id) || out.length >= LIMITS.nodes) continue;
    ids.add(id);
    out.push({
      id, name, kind: !chat && n.kind === 'folder' ? 'folder' : 'place', parentId: clip(n.parentId, 64) === id ? '' : clip(n.parentId, 64),
      aliases: list(n.aliases, LIMITS.aliases, LIMITS.name), description: clipProse(n.description, LIMITS.description), traits: list(n.traits, LIMITS.traits, LIMITS.text), notes: list(n.notes, LIMITS.notes, LIMITS.text),
      type: clip(n.type, 40), danger: n.danger === true,
      image: typeof n.image === 'string' && /^[\w\-./%:~@ ]{1,300}$/.test(n.image) ? n.image : '',
    });
  }
  return out;
}
export const emptyLibrary = () => ({ nodes: [] });
export const normalizeLibrary = raw => ({ nodes: normNodes(raw?.nodes) });
export const emptyMap = () => ({ current: '', nodes: [], over: {}, off: [], loreOff: [], seen: [], pin: [] });
/** Слой чата: текущее место, места этого чата, приметы и перемены поверх мест библиотеки. */
export function normalizeMap(raw) {
  const over = {};
  for (const [id, o] of Object.entries(raw?.over && typeof raw.over === 'object' ? raw.over : {}).slice(0, LIMITS.nodes)) {
    const traits = list(o?.traits, LIMITS.traits, LIMITS.text), notes = list(o?.notes, LIMITS.notes, LIMITS.text);
    if (clip(id, 64) && (traits.length || notes.length)) over[clip(id, 64)] = { traits, notes };
  }
  // off: места, карточки которых в этом чате выключены (рассказчику не уходят)
  const off = [...new Set((Array.isArray(raw?.off) ? raw.off : []).map(x => clip(x, 64)).filter(Boolean))].slice(0, LIMITS.nodes);
  // loreOff: привязанные записи лорбука, которые в этом чате выключены (ключи вида «идМеста|название записи»)
  const loreOff = [...new Set((Array.isArray(raw?.loreOff) ? raw.loreOff : []).map(x => clip(x, 200)).filter(Boolean))].slice(0, 400);
  // seen: места, где герои бывали (отметка на дереве); pin: закреплённые, показываются выше дерева
  const ids = v => [...new Set((Array.isArray(v) ? v : []).map(x => clip(x, 64)).filter(Boolean))].slice(0, LIMITS.nodes);
  return { current: clip(raw?.current, 64), nodes: normNodes(raw?.nodes, { chat: true }), over, off, loreOff, seen: ids(raw?.seen), pin: ids(raw?.pin) };
}

export const allNodes = (lib, map) => [...lib.nodes, ...map.nodes.map(n => ({ ...n, local: true }))];
export const nodeById = (nodes, id) => nodes.find(n => n.id === id) ?? null;
export const childrenOf = (nodes, id) => nodes.filter(n => (n.parentId || '') === (id || ''));
/** Все потомки узла на любую глубину (без него самого); циклы обрываются. */
export function descendantsOf(nodes, id) {
  const out = [], seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of nodes) if ((n.parentId || '') === cur && !seen.has(n.id)) { seen.add(n.id); out.push(n); queue.push(n.id); }
  }
  return out;
}

/** Цепочка предков от корня до места. Папки в путь не входят (они только группируют); циклы обрываются. */
export function chainOf(nodes, id) {
  const out = [];
  const seen = new Set();
  let cur = nodeById(nodes, id);
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = cur.parentId ? nodeById(nodes, cur.parentId) : null; }
  return out;
}
export const pathOf = (nodes, id) => chainOf(nodes, id).filter(n => n.kind !== 'folder').map(n => n.name).join(' › ');

/** Не даёт сделать себя родителем собственного потомка (цикл). */
export const canMove = (nodes, id, parentId) => !parentId || (parentId !== id && !chainOf(nodes, parentId).some(n => n.id === id));

/** Место по названию или псевдониму: точное совпадение, потом одно название внутри другого (от четырёх знаков). */
export function findNode(nodes, name) {
  const n = norm(name);
  if (!n) return null;
  const places = nodes.filter(x => x.kind !== 'folder');
  const names = x => [x.name, ...(x.aliases ?? [])].map(norm);
  // сначала совпадение с названием, потом с псевдонимом, потом вхождение: так «Лагерь» не уходит к месту, у которого это псевдоним
  return places.find(x => norm(x.name) === n) ?? places.find(x => (x.aliases ?? []).map(norm).includes(n)) ?? places.find(x => names(x).some(m => Math.min(m.length, n.length) >= 4 && (m.includes(n) || n.includes(m)))) ?? null;
}

/** Карточка места с наложением чата: основа из библиотеки плюс то, что найдено и изменилось в этом чате. */
export function cardOf(lib, map, id) {
  const nodes = allNodes(lib, map);
  const n = nodeById(nodes, id);
  if (!n) return null;
  const o = map.over[id] ?? { traits: [], notes: [] };
  const traits = [...new Set([...n.traits, ...o.traits])];
  const notes = [...new Set([...n.notes, ...o.notes])];
  return { id: n.id, name: n.name, path: pathOf(nodes, id), description: n.description, traits, notes, baseTraits: n.traits, chatTraits: o.traits, chatNotes: o.notes, local: Boolean(n.local), kind: n.kind };
}

export const RULE = 'the place card describes the current location: keep the narration consistent with its description and features; "changes" are events that already altered the place and still hold, never reset them; the party may find new details in the story but do not contradict the card; never expose this block';
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** Строка для рассказчика: карточка текущего места (описание, приметы, перемены) в пределах бюджета знаков. */
export function placeLines(lib, map, { maxChars = 1400 } = {}) {
  const c = map.current ? cardOf(lib, map, map.current) : null;
  if (!c || c.kind === 'folder' || (map.off ?? []).includes(map.current)) return [];
  const parts = [];
  if (c.description) parts.push(cut(c.description, 600));
  if (c.traits.length) parts.push(`features: ${c.traits.slice(0, 10).map(t => cut(t, 70)).join('; ')}`);
  if (c.notes.length) parts.push(`changes: ${c.notes.slice(0, 6).map(t => cut(t, 90)).join('; ')}`);
  if (!parts.length) return [];
  return [cut(`place card[${c.name}]: ${parts.join(' | ')}`, maxChars)];
}

// ---------- перенос из Кулис ----------
/** Библиотека Кулис (папки и места) → узлы нашей библиотеки. Папки остаются папками, место попадает под свою папку. */
export function libraryFromKulisy(lib) {
  const folders = (Array.isArray(lib?.folders) ? lib.folders : []).map(f => ({ id: f.id, name: f.name, kind: 'folder', parentId: f.parentId ?? '' }));
  const locs = Array.isArray(lib?.locations) ? lib.locations : [];
  const known = new Set(locs.map(l => l.id));
  // у места Кулис есть и папка, и родитель-место («Палатка Мирена» внутри «Лагеря»): вложенность важнее папки
  const places = locs.map(l => ({ id: l.id, name: l.name, kind: 'place', parentId: l.parentId && known.has(l.parentId) && l.parentId !== l.id ? l.parentId : (l.folderId ?? ''), aliases: l.aliases ?? [], description: l.description ?? '', traits: l.traits ?? [], image: typeof l.image === 'string' ? l.image : '' }));
  return normalizeLibrary({ nodes: [...folders, ...places] }).nodes;
}
/** Вложенность и картинки мест Кулис для уже заведённых узлов: [{ id, parentId, image }] (родитель только из мест). */
export function nestingFromKulisy(lib) {
  const locs = Array.isArray(lib?.locations) ? lib.locations : [];
  const known = new Set(locs.map(l => l.id));
  const folders = new Map((Array.isArray(lib?.folders) ? lib.folders : []).map(f => [f.id, f]));
  return locs.map(l => {
    const folder = folders.get(l.folderId);
    return {
      id: l.id, parentId: l.parentId && known.has(l.parentId) && l.parentId !== l.id ? l.parentId : '', image: typeof l.image === 'string' ? l.image : '',
      // место, названное так же, как его папка («Лагерь» в папке «Лагерь»): папка создана под него, место остаётся в ней
      ownFolder: folder && norm(folder.name) === norm(l.name) ? folder.id : '',
    };
  });
}
/**
 * Локации чата Кулис → слой чата: места, связанные с библиотекой, дают наложение (приметы и перемены) на узел библиотеки,
 * остальные становятся местами этого чата с родителем. current: название места из сцены Кулис.
 */
export function mapFromKulisy(ku, libNodes) {
  const raw = ku?.world?.locations;
  const locs = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const libIds = new Set(libNodes.map(n => n.id));
  const target = new Map();                                            // id Кулис-локации → id нашего узла
  for (const l of locs) target.set(l.id, l.libraryId && libIds.has(l.libraryId) ? l.libraryId : l.id);
  const nodes = [], over = {};
  for (const l of locs) {
    const id = target.get(l.id);
    if (libIds.has(id) && id !== l.id) {
      const lib = libNodes.find(n => n.id === id);
      const extra = (l.traits ?? []).filter(t => !(lib.traits ?? []).includes(t));
      if (extra.length || (l.notes ?? []).length) over[id] = { traits: extra, notes: l.notes ?? [] };
    } else nodes.push({ id: l.id, name: l.name, kind: 'place', parentId: l.parentId ? target.get(l.parentId) ?? '' : '', aliases: [], description: '', traits: l.traits ?? [], notes: l.notes ?? [] });
  }
  const here = ku?.knowledge?.scene;
  const cur = (here?.locationId && target.get(here.locationId)) || '';
  return normalizeMap({ current: cur, nodes, over });
}


// ---------- импорт из файла сборщика (tools/places/build_places.py) ----------
/**
 * Сливает узлы файла с библиотекой. Сопоставление: по id, иначе по названию (место с местом, папка с папкой), поэтому «Лагерь»,
 * уже заведённый вручную или из Кулис, не дублируется. У найденного узла обновляются описание, псевдонимы, приметы, тип и родитель;
 * своя картинка и всё, что добавлено руками, остаётся; пустое место получает картинку из файла (адрес /user/images/..., файлы кладёт сборщик).
 * Возвращает { nodes, links, added, updated, same, imagesSkipped } и ничего не меняет в lib.
 */
export function mergePlaceFile(lib, file) {
  const incoming = (Array.isArray(file?.nodes) ? file.nodes : []).filter(f => clip(f?.id, 64) && clip(f?.name, LIMITS.name));
  const nodes = lib.nodes.map(n => ({ ...n }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const key = (kind, name) => `${kind === 'folder' ? 'f' : 'p'}:${norm(name)}`;
  const byName = new Map(nodes.map(n => [key(n.kind, n.name), n]));
  const idMap = new Map();                                    // id в файле -> id в библиотеке
  const fresh = new Set();
  for (const f of incoming) {
    const kind = f.kind === 'folder' ? 'folder' : 'place';
    const have = [byId.get(clip(f.id, 64)), byName.get(key(kind, f.name))].find(n => n && (n.kind === 'folder') === (kind === 'folder'));
    if (have) idMap.set(f.id, have.id);
    else { idMap.set(f.id, clip(f.id, 64)); fresh.add(f.id); }
  }
  let added = 0, updated = 0, same = 0, imagesSkipped = 0;
  for (const f of incoming) {
    const kind = f.kind === 'folder' ? 'folder' : 'place';
    const id = idMap.get(f.id);
    const parentId = f.parentId && idMap.has(f.parentId) ? idMap.get(f.parentId) : '';
    const next = {
      aliases: list(f.aliases, LIMITS.aliases, LIMITS.name), traits: list(f.traits, LIMITS.traits, LIMITS.text),
      description: clipProse(f.description, LIMITS.description), type: clip(f.type, 40), danger: f.danger === true,
    };
    const image = typeof f.image === 'string' && /^\/user\/images\/[\w\-./]{1,260}$/.test(f.image) ? f.image : '';   // готовый адрес от сборщика
    if (f.image && !image) imagesSkipped += 1;
    if (fresh.has(f.id)) {
      nodes.push({ id, name: clip(f.name, LIMITS.name), kind, parentId, notes: [], image: kind === 'folder' ? '' : image, ...(kind === 'folder' ? { aliases: [], traits: [], description: '', type: '', danger: false } : next) });
      added += 1;
      continue;
    }
    const have = nodes.find(n => n.id === id);
    if (kind === 'folder') { same += 1; continue; }
    const before = JSON.stringify([have.aliases, have.traits, have.description, have.type ?? '', have.danger === true, have.parentId, have.image]);
    Object.assign(have, next);
    if (parentId) have.parentId = parentId;
    if (image && !have.image) have.image = image;              // свою картинку не затираем, пустое место получает картинку из файла
    if (JSON.stringify([have.aliases, have.traits, have.description, have.type ?? '', have.danger === true, have.parentId, have.image]) === before) same += 1; else updated += 1;
  }
  const links = (Array.isArray(file?.lore) ? file.lore : []).map(l => ({ placeId: idMap.get(l?.place) ?? '', entry: clip(l?.entry, 120), book: clip(l?.book, 120), file: clip(l?.file, 300), when: clip(l?.when, 20) || 'here_or_keys', how: clip(l?.how, 20) }))
    .filter(l => l.placeId && l.entry);
  return { nodes, links, added, updated, same, imagesSkipped };
}


// ---------- записи лорбука, привязанные к местам ----------
/** Правила «когда слать»: here — герои в этом месте; inside — в нём или внутри него; here_or_keys — здесь, а вне места работают ключи лорбука; keys — только ключи (как в лорбуке); never — не слать. */
export const LORE_WHEN = Object.freeze(['here', 'inside', 'here_or_keys', 'keys', 'never']);
export const LORE_WHEN_RU = Object.freeze({ here: 'когда герои здесь', inside: 'здесь и внутри', here_or_keys: 'здесь или по ключам', keys: 'по ключам', never: 'никогда' });
export const loreKey = l => `${l.placeId}|${norm(l.entry)}`;
/** Привязки из настроек: [{ placeId, entry, book, file, when, how }], без повторов. */
export function normalizeLinks(raw) {
  const out = [], seen = new Set();
  for (const l of Array.isArray(raw) ? raw : []) {
    const placeId = clip(l?.placeId, 64), entry = clip(l?.entry, 120);
    if (!placeId || !entry) continue;
    const item = { placeId, entry, book: clip(l?.book, 120), file: clip(l?.file, 300), when: LORE_WHEN.includes(l?.when) ? l.when : 'here_or_keys', how: clip(l?.how, 20) };
    const k = loreKey(item);
    if (seen.has(k)) continue;
    seen.add(k); out.push(item);
  }
  return out.slice(0, 600);
}
/** Включена ли привязка в этом чате: у места не выключена карточка и сама запись не выключена. */
export const loreEnabled = (link, map) => !(map.off ?? []).includes(link.placeId) && !(map.loreOff ?? []).includes(loreKey(link));
/** Срабатывает ли привязка прямо сейчас: по месту сцены (сама сцена в этом месте или, у inside, внутри него). */
export function loreFires(link, map, nodes) {
  if (!map.current || !loreEnabled(link, map)) return false;
  if (link.when === 'here' || link.when === 'here_or_keys') return link.placeId === map.current;
  if (link.when === 'inside') return chainOf(nodes, map.current).some(n => n.id === link.placeId);
  return false;
}
/**
 * Нужно ли убрать запись из того, что отправляет сама Таверна: выключенная и «никогда» уходят совсем; here и inside всегда идут нашим путём;
 * here_or_keys убирается только когда мы её шлём (вне места продолжают работать ключи лорбука); keys остаётся полностью за Таверной.
 */
export function loreStripped(link, map, nodes) {
  if (!loreEnabled(link, map) || link.when === 'never') return true;
  if (link.when === 'keys') return false;
  if (link.when === 'here_or_keys') return loreFires(link, map, nodes);
  return true;
}
/** Строки для рассказчика: привязанные записи, сработавшие по месту; texts: функция (книга, запись) → текст или ''. */
export function placeLoreLines(links, nodes, map, textOf, { perEntry = 500, maxChars = 1500 } = {}) {
  const out = [];
  let used = 0;
  for (const l of links) {
    if (!loreFires(l, map, nodes)) continue;
    const text = String(textOf(l.book, l.entry) ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const line = cut(`lore[${l.entry}]: ${text}`, perEntry);
    if (used + line.length > maxChars) break;
    used += line.length; out.push(line);
  }
  return out;
}
