import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeLibrary, normalizeMap, emptyMap, allNodes, chainOf, pathOf, canMove, findNode, cardOf, placeLines, libraryFromKulisy, mapFromKulisy, childrenOf, mergePlaceFile, normalizeLinks, loreKey, loreEnabled, loreFires, loreStripped, placeLoreLines, RULE } from '../src/core/places.js';
import { normalizeState } from '../src/core/state.js';

const lib = () => normalizeLibrary({ nodes: [
  { id: 'f1', name: 'Врата Балдура 3', kind: 'folder' }, { id: 'f2', name: 'Побережье', kind: 'folder', parentId: 'f1' },
  { id: 'p1', name: 'Побережье Мечей', parentId: 'f2', aliases: ['берег'], description: 'Каменистый берег и бухта.', traits: ['галька', 'крики чаек'] },
  { id: 'p2', name: 'Лагерь', parentId: 'p1', aliases: ['лагерная стоянка'], description: 'Лощина среди гор.', traits: ['костёр'] },
  { id: 'p1', name: 'дубль' }, { id: '', name: 'без id' }, { id: 'p3', name: '', parentId: 'p1' },
] });

test('библиотека и слой чата: нормализация, дубли, цикл в родителях', () => {
  const l = lib();
  assert.deepEqual(l.nodes.map(n => n.id), ['f1', 'f2', 'p1', 'p2']);
  assert.equal(l.nodes[0].kind, 'folder');
  assert.deepEqual(normalizeLibrary('мусор'), { nodes: [] });
  const m = normalizeMap({ current: 'p2', nodes: [{ id: 'c1', name: 'Палатка Лилит', parentId: 'p2', kind: 'folder', traits: ['тёплая', 'тёплая', 'шкуры'] }], over: { p2: { traits: ['дым'], notes: ['мост обрушился'] }, p9: { traits: [], notes: [] } } });
  assert.equal(m.nodes[0].kind, 'place');                                   // в чате папок нет
  assert.deepEqual(m.nodes[0].traits, ['тёплая', 'шкуры']);
  assert.deepEqual(Object.keys(m.over), ['p2']);                            // пустое наложение не хранится
  assert.deepEqual(normalizeState({ calendar: 'harptos' }).map, emptyMap());
});

test('дерево: путь без папок, потомки, перемещение без циклов, поиск по названию и псевдониму', () => {
  const l = lib();
  const m = normalizeMap({ nodes: [{ id: 'c1', name: 'Палатка Лилит', parentId: 'p2' }] });
  const nodes = allNodes(l, m);
  assert.equal(pathOf(nodes, 'c1'), 'Побережье Мечей › Лагерь › Палатка Лилит');
  assert.deepEqual(chainOf(nodes, 'p2').map(n => n.id), ['f1', 'f2', 'p1', 'p2']);
  assert.deepEqual(childrenOf(nodes, 'p1').map(n => n.id), ['p2']);
  assert.equal(canMove(nodes, 'p1', 'c1'), false);                          // перенос внутрь собственного потомка
  assert.equal(canMove(nodes, 'c1', 'p1'), true);
  assert.equal(canMove(nodes, 'p1', 'p1'), false);
  assert.equal(findNode(nodes, 'лагерная стоянка')?.id, 'p2');
  assert.equal(findNode(nodes, 'на берегу побережья мечей')?.id, 'p1');      // название внутри фразы
  assert.equal(findNode(nodes, 'Врата Балдура 3'), null);                    // папка местом не считается
  assert.equal(findNode(nodes, 'ля'), null);
});

test('карточка места: основа библиотеки плюс находки и перемены этого чата; строка рассказчику', () => {
  const l = lib();
  const m = normalizeMap({ current: 'p2', over: { p2: { traits: ['дым над кострищем', 'костёр'], notes: ['мост у лагеря обрушился'] } } });
  const c = cardOf(l, m, 'p2');
  assert.deepEqual(c.traits, ['костёр', 'дым над кострищем']);               // без повторов
  assert.deepEqual(c.chatNotes, ['мост у лагеря обрушился']);
  assert.equal(c.path, 'Побережье Мечей › Лагерь');
  assert.deepEqual(placeLines(l, m), ['place card[Лагерь]: Лощина среди гор. | features: костёр; дым над кострищем | changes: мост у лагеря обрушился']);
  assert.deepEqual(placeLines(l, normalizeMap({ current: '' })), []);
  assert.deepEqual(placeLines(l, normalizeMap({ current: 'f1' })), []);       // папка не место
  assert.equal(placeLines(l, m, { maxChars: 30 })[0].length <= 30, true);
  assert.ok(RULE.includes('never reset them'));
});

test('перенос из Кулис: библиотека с папками, слой чата с привязкой к библиотеке', () => {
  const kuLib = { folders: [{ id: 'F', name: 'Врата' }, { id: 'G', name: 'Лагерь', parentId: 'F' }], locations: [{ id: 'L1', folderId: 'G', name: 'Лагерь', aliases: ['лагерь'], description: 'Описание' }] };
  const nodes = libraryFromKulisy(kuLib);
  assert.deepEqual(nodes.map(n => [n.id, n.kind, n.parentId]), [['F', 'folder', ''], ['G', 'folder', 'F'], ['L1', 'place', 'G']]);
  const ku = { world: { locations: [
    { id: 'x1', name: 'лагерь', libraryId: 'L1', traits: ['костёр', 'новая примета'], notes: ['сгорела палатка'], parentId: '' },
    { id: 'x2', name: 'тропа у реки', traits: ['мокрая глина'], notes: [], parentId: 'x1' },
    { id: 'x3', name: 'ниша', traits: [], notes: [], parentId: 'x2' },
  ] }, knowledge: { scene: { locationId: 'x2' } } };
  const m = mapFromKulisy(ku, nodes);
  assert.deepEqual(m.over, { L1: { traits: ['костёр', 'новая примета'], notes: ['сгорела палатка'] } });
  assert.deepEqual(m.nodes.map(n => [n.id, n.parentId]), [['x2', 'L1'], ['x3', 'x2']]);     // родитель, ставший узлом библиотеки, подменён
  assert.equal(m.current, 'x2');
  assert.deepEqual(mapFromKulisy({}, nodes), emptyMap());
});

const exportPath = './local-only/missing.json';
test('экспорт Нарратора1: 75 мест чата проходят перенос', { skip: !existsSync(exportPath) }, () => {
  const ku = JSON.parse(readFileSync(exportPath, 'utf8')).kulisy;
  const m = mapFromKulisy(ku, []);
  assert.equal(m.nodes.length, 75);
  assert.ok(m.nodes.filter(n => n.parentId).length >= 60);
  const nodes = allNodes({ nodes: [] }, m);
  assert.ok(nodes.every(n => pathOf(nodes, n.id).length > 0));
});

import { placeLines as pl2, normalizeMap as nm2, normalizeLibrary as nl2 } from '../src/core/places.js';
test('выключенная карточка места рассказчику не уходит, список выключенных сохраняется', () => {
  const lib = nl2({ nodes: [{ id: 'a', name: 'Лагерь', kind: 'place', description: 'Костёр и палатки.' }] });
  assert.equal(pl2(lib, nm2({ current: 'a' })).length, 1);
  assert.equal(pl2(lib, nm2({ current: 'a', off: ['a'] })).length, 0);
  assert.deepEqual(nm2({ off: ['a', 'a', 'b', ''] }).off, ['a', 'b']);
});

import { libraryFromKulisy as lfk, nestingFromKulisy as nfk } from '../src/core/places.js';
test('библиотека Кулис: место внутри места остаётся вложенным, картинка переносится', () => {
  const kl = { folders: [{ id: 'f1', name: 'Акт 1' }], locations: [
    { id: 'a', name: 'Изумрудная роща', folderId: 'f1', image: '/user/images/x/place_a.webp' },
    { id: 'b', name: 'Бастионы рощи', folderId: 'f1', parentId: 'a' },
    { id: 'c', name: 'Сирота', folderId: 'f1', parentId: 'нет-такого' },
  ] };
  const nodes = lfk(kl);
  const by = Object.fromEntries(nodes.map(n => [n.id, n]));
  assert.equal(by.a.parentId, 'f1');           // верхнее место лежит под папкой
  assert.equal(by.b.parentId, 'a');            // вложенное под своим местом
  assert.equal(by.c.parentId, 'f1');           // неизвестный родитель: остаётся папка
  assert.equal(by.a.image, '/user/images/x/place_a.webp');
  assert.deepEqual(nfk(kl).map(k => [k.id, k.parentId]), [['a', ''], ['b', 'a'], ['c', '']]);
});

test('место с названием своей папки остаётся в ней: «Лагерь» в папке «Лагерь»', () => {
  const kl = { folders: [{ id: 'fc', name: 'Лагерь' }], locations: [{ id: 'camp', name: 'Лагерь', folderId: 'fc', parentId: 'coast' }, { id: 'coast', name: 'Побережье Мечей', folderId: 'fa' }] };
  const k = nfk(kl).find(x => x.id === 'camp');
  assert.equal(k.ownFolder, 'fc');
  assert.equal(nfk(kl).find(x => x.id === 'coast').ownFolder, '');
});

import { descendantsOf as desc2 } from '../src/core/places.js';
test('потомки узла на любую глубину, без него самого и без зацикливания', () => {
  const nodes = [{ id: 'f', parentId: '' }, { id: 'a', parentId: 'f' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'x', parentId: '' }];
  assert.deepEqual(desc2(nodes, 'a').map(n => n.id), ['b', 'c']);
  assert.deepEqual(desc2(nodes, 'f').map(n => n.id), ['a', 'b', 'c']);
  assert.deepEqual(desc2([{ id: 'p', parentId: 'q' }, { id: 'q', parentId: 'p' }], 'p').map(n => n.id), ['q']);
});

test('импорт из файла сборщика: новые добавляются, найденные по названию обновляются без дублей, картинка и родитель-место сохраняются', () => {
  const l = lib();
  const file = {
    world: 'Врата Балдура 3',
    nodes: [
      { id: 'fd:act1', kind: 'folder', name: 'Акт 1', parentId: '' },
      { id: 'pl:1', kind: 'place', name: 'Побережье Мечей', parentId: 'fd:act1', aliases: ['Sword Coast'], traits: ['галька', 'новая примета'], description: 'Новое описание.', type: 'регион' },
      { id: 'pl:2', kind: 'place', name: 'Дорога Воскрешения', parentId: 'pl:1', description: 'Дорога вдоль берега.', traits: ['телеги'], danger: true },
      { id: 'pl:3', kind: 'place', name: 'Лагерь', parentId: 'pl:1', description: 'Лощина.' },
    ],
    lore: [{ entry: 'Эльфийская песнь', place: 'pl:2', book: 'Книга', file: 'Мир/x.md', when: 'here_or_keys', how: 'по названию' }, { entry: 'Висит', place: 'нет', when: 'here' }],
  };
  const before = JSON.stringify(l);
  const r = mergePlaceFile(l, file);
  assert.equal(JSON.stringify(l), before);                                   // библиотека не тронута
  const out = normalizeLibrary({ nodes: r.nodes });
  const byName = n => out.nodes.find(x => x.name === n);
  assert.equal(out.nodes.filter(x => x.name === 'Лагерь').length, 1);        // «Лагерь» уже был: не дубль
  assert.equal(byName('Лагерь').id, 'p2');                                   // остался прежний id
  assert.equal(byName('Побережье Мечей').id, 'p1');
  assert.equal(byName('Побережье Мечей').description, 'Новое описание.');    // описание обновилось
  assert.deepEqual(byName('Побережье Мечей').aliases, ['Sword Coast']);
  assert.equal(byName('Дорога Воскрешения').parentId, 'p1');                 // родитель в файле «pl:1» стал нашим p1
  assert.equal(byName('Дорога Воскрешения').danger, true);
  assert.equal(byName('Акт 1').kind, 'folder');
  assert.equal(r.added, 2); assert.equal(r.updated, 2);
  assert.deepEqual(r.links.map(x => [x.placeId, x.entry, x.book]), [[byName('Дорога Воскрешения').id, 'Эльфийская песнь', 'Книга']]);   // привязка на неизвестное место отброшена
  // повторный импорт того же файла: ничего нового, всё без изменений
  const again = mergePlaceFile(out, file);
  assert.equal(again.added, 0); assert.equal(again.updated, 0);
  assert.equal(again.same, 4);
});

test('настоящий places.json сборщика (если собран): все узлы переносятся, цикла и потерянных родителей нет', () => {
  const path = new URL('../tools/places/out/places.json', import.meta.url);
  if (!existsSync(path)) return;
  const file = JSON.parse(readFileSync(path, 'utf-8'));
  const r = mergePlaceFile(normalizeLibrary({ nodes: [] }), file);
  const out = normalizeLibrary({ nodes: r.nodes });
  assert.equal(out.nodes.length, file.nodes.length);
  const ids = new Set(out.nodes.map(n => n.id));
  for (const n of out.nodes) {
    assert.ok(!n.parentId || ids.has(n.parentId), `родитель ${n.parentId} у «${n.name}»`);
    assert.ok(canMove(out.nodes, n.id, n.parentId), `цикл у «${n.name}»`);
  }
  assert.ok(r.links.length > 0);
});

test('импорт: картинка из файла (адрес /user/images/…) попадает пустому месту, чужая картинка не затирается, неверный адрес отбрасывается', () => {
  const l = normalizeLibrary({ nodes: [{ id: 'a', name: 'Лагерь', image: '/user/images/kulisy-library/my.png' }, { id: 'b', name: 'Роща' }] });
  const file = { nodes: [
    { id: 'pl:1', name: 'Лагерь', image: '/user/images/SceneJournalPlaces/pl_1.webp' },
    { id: 'pl:2', name: 'Роща', image: '/user/images/SceneJournalPlaces/pl_2.webp' },
    { id: 'pl:3', name: 'Новое', image: '/user/images/SceneJournalPlaces/pl_3.webp' },
    { id: 'pl:4', name: 'Плохое', image: './local-only/missing.json' },
  ] };
  const r = mergePlaceFile(l, file);
  const img = n => r.nodes.find(x => x.name === n)?.image;
  assert.equal(img('Лагерь'), '/user/images/kulisy-library/my.png');           // уже была своя
  assert.equal(img('Роща'), '/user/images/SceneJournalPlaces/pl_2.webp');        // пустому месту выдана
  assert.equal(img('Новое'), '/user/images/SceneJournalPlaces/pl_3.webp');
  assert.equal(img('Плохое'), '');
  assert.equal(r.imagesSkipped, 1);
});

test('привязанные записи лорбука: правила here, inside, here_or_keys, keys, never; выключение; что вырезать у Таверны', () => {
  const l = lib();                                  // p1 «Побережье Мечей» › p2 «Лагерь»
  const nodes = allNodes(l, emptyMap());
  const links = normalizeLinks([
    { placeId: 'p2', entry: 'Запись про лагерь', when: 'here', book: 'Б' },
    { placeId: 'p1', entry: 'Про берег', when: 'inside', book: 'Б' },
    { placeId: 'p2', entry: 'Слухи', when: 'here_or_keys', book: 'Б' },
    { placeId: 'p2', entry: 'Ключевая', when: 'keys', book: 'Б' },
    { placeId: 'p2', entry: 'Запрещённая', when: 'never', book: 'Б' },
    { placeId: 'p2', entry: 'запись про лагерь', when: 'here' },          // повтор по ключу
    { placeId: 'p2', entry: 'Мусор', when: 'странное' },
  ]);
  assert.equal(links.length, 6);
  assert.equal(links.find(x => x.entry === 'Мусор').when, 'here_or_keys');  // неизвестное правило заменяется
  const map = n => normalizeMap({ current: n });
  const fires = (m) => links.filter(x => loreFires(x, m, nodes)).map(x => x.entry);
  assert.deepEqual(fires(map('p2')), ['Запись про лагерь', 'Про берег', 'Слухи', 'Мусор']);   // в лагере: here, inside родителя, here_or_keys
  assert.deepEqual(fires(map('p1')), ['Про берег']);                                            // на берегу: только inside
  assert.deepEqual(fires(map('')), []);
  // вырезание: here/inside/never всегда, here_or_keys только когда шлём мы, keys никогда
  const strip = (m) => links.filter(x => loreStripped(x, m, nodes)).map(x => x.entry);
  assert.deepEqual(strip(map('p2')), ['Запись про лагерь', 'Про берег', 'Слухи', 'Запрещённая', 'Мусор']);
  assert.deepEqual(strip(map('p1')), ['Запись про лагерь', 'Про берег', 'Запрещённая']);       // «Слухи» вне места остаются Таверне (ключи)
  // выключено в чате: не шлётся и вырезается совсем; выключена карточка места: то же для всех её записей
  const off = normalizeMap({ current: 'p2', loreOff: [loreKey(links[2])] });
  assert.ok(!fires(off).includes('Слухи') && strip(off).includes('Слухи'));
  assert.equal(loreEnabled(links[0], normalizeMap({ current: 'p2', off: ['p2'] })), false);
  assert.deepEqual(fires(normalizeMap({ current: 'p2', off: ['p2'] })), ['Про берег']);          // у p1 карточка включена
  // строки рассказчику: только сработавшие, из текста (пустой пропускается), с ограничением длины
  const texts = { 'Б|Запись про лагерь': 'Описание лагеря.', 'Б|Про берег': 'Берег. '.repeat(200), 'Б|Слухи': '' };
  const lines = placeLoreLines(links, nodes, map('p2'), (b, e) => texts[`${b}|${e}`], { perEntry: 100 });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('lore[Запись про лагерь]: Описание'));
  assert.ok(lines[1].length <= 100);
});
