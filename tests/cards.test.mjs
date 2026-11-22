import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseSheetTitle, kindOfTitle, cardsFromBook, normalizeLibrary, normalizeChatCards, matchPerson, mentionedIn, selectSections, buildCardsBlock, sheetEntryTest, estimateTokens, DEFAULT_WHEN, KINDS } from '../src/core/cards.js';
import { normalizeState } from '../src/core/state.js';

const entry = (uid, comment, content, extra = {}) => ({ uid, comment, content, key: [], disable: false, ...extra });
const book = [
  entry(1, '[ Astarion Ancunín ] - Basic Info', 'Бледный эльф, бывший раб.'), entry(2, '[ Astarion Ancunín ] - Visual', 'Белые кудри, красные глаза.'),
  entry(3, '[ Astarion Ancunín ] - Character and psychology', 'Манипулятор.'), entry(4, '[ Astarion Ancunín ] - NSFW module', 'Модуль.'),
  entry(5, '[ Astarion Ancunín ] - Biography', 'Родился в Бэльдурсе.', { key: ['Каскадия', '/регулярка/iu'] }),
  entry(6, "[ Lae'zel ] - Basic Info", 'Гитьянки.'), entry(7, '[Секрет: Астарион] Шрамы', 'тайна'), entry(8, 'Просто запись', 'мир'),
  entry(9, "[ Lae'zel ] - Voice", 'Резко.', { disable: true }), entry(10, '[ Lae\'zel ] - Extra stuff', 'Прочее.'),
];

test('названия разделов: распознавание вида и запись лорбука', () => {
  assert.deepEqual(parseSheetTitle('[ Astarion Ancunín ] - Basic Info'), { name: 'Astarion Ancunín', title: 'Basic Info' });
  assert.deepEqual(parseSheetTitle('[Лилит]: Внешность'), { name: 'Лилит', title: 'Внешность' });
  assert.equal(parseSheetTitle('[Секрет: Лилит] Шрамы'), null);
  assert.equal(parseSheetTitle('Просто запись'), null);
  assert.equal(kindOfTitle('Character and psychology'), 'character');
  assert.equal(kindOfTitle('NSFW module'), 'nsfw');
  assert.equal(kindOfTitle('Что-то своё'), 'other');
  assert.ok(Object.keys(DEFAULT_WHEN).every(k => KINDS[k]));
});

test('лорбук → карточки: группировка по имени, пропуск секретов, выключенных и чужих записей', () => {
  const cards = cardsFromBook(book, 'Персонажи');
  assert.deepEqual(cards.map(c => c.name), ['Astarion Ancunín', "Lae'zel"]);
  assert.deepEqual(cards[0].sections.map(s => s.kind), ['basic', 'visual', 'character', 'nsfw', 'biography']);
  assert.deepEqual(cards[0].sections[4].keys, ['Каскадия', '/регулярка/iu']);   // все ключи записи сохраняются, и регулярки тоже
  assert.deepEqual(cards[1].sections.map(s => s.kind), ['basic', 'other']);  // выключенная запись (Voice) пропущена
  assert.deepEqual(cards[0].source, { book: 'Персонажи', uids: ['1', '2', '3', '4', '5'] });
  assert.deepEqual(cardsFromBook(null), []);
});

const lib = () => normalizeLibrary({ cards: [
  { id: 'a', name: 'Astarion Ancunín', aliases: ['Астарион'], image: '/user/images/cards/a.png', sections: cardsFromBook(book)[0].sections.map((s, i) => ({ id: 's' + i, ...s })) },
  { id: 'l', name: "Lae'zel", sections: [{ id: 'x', kind: 'basic', title: 'Basic Info', text: 'Гитьянки.' }, { id: 'y', kind: 'voice', title: 'Voice', text: 'Резко.', when: 'never' }] },
  { id: 'a', name: 'Дубль', sections: [] }, { id: '', name: 'без id' }, null,
] });

test('библиотека: нормализация, дубли id, картинка только безопасным путём', () => {
  const l = lib();
  assert.deepEqual(l.cards.map(c => c.id), ['a', 'l']);
  assert.equal(l.cards[0].image, '/user/images/cards/a.png');
  assert.equal(normalizeLibrary({ cards: [{ id: 'z', name: 'Z', image: 'javascript:alert(1)' }] }).cards[0].image, '');
  assert.equal(l.cards[1].sections[1].when, 'never');
  assert.deepEqual(normalizeLibrary('мусор'), { cards: [] });
  assert.deepEqual(normalizeChatCards({ ids: ['a', 'a', 'l', ''], entered: { a: 3, b: -1, c: 'x' } }), { ids: ['a', 'l'], entered: { a: 3 } });
  assert.deepEqual(normalizeState({ calendar: 'harptos' }).cards, { ids: [], entered: {} });
});

const people = [
  { id: 'c1', name: 'Лилит', persona: true, present: true }, { id: 'c2', name: 'Astarion', persona: false, present: true },
  { id: 'c3', name: "Lae'zel", persona: false, present: false }, { id: 'c4', name: 'Гейл', persona: false, present: true },
];

test('сопоставление карточки с человеком и упоминания', () => {
  const l = lib();
  assert.equal(matchPerson(l.cards[0], people)?.id, 'c2');                // по первому слову имени
  assert.equal(matchPerson({ name: 'Кто-то', aliases: [] }, people), null);
  assert.equal(mentionedIn(l.cards[0], 'Астариона не было слышно.'), true);   // по псевдониму и падежу
  assert.equal(mentionedIn(l.cards[1], 'Тихо.'), false);
});

test('правила «когда слать»: всегда, выход на сцену, пара, бой, близость, ключи, никогда', () => {
  const l = lib();
  const base = { people, recentText: 'Астарион смотрит на Гейла.', chatLength: 20, entered: { c2: 18 } };
  const kinds = sel => sel.flatMap(p => p.sections.map(s => s.section.kind));
  let r = selectSections(l, ['a', 'l'], base);
  assert.deepEqual(r.map(p => p.card.id), ['a']);                         // Лаэзель не в кадре и не названа
  assert.deepEqual(kinds(r), ['basic', 'visual', 'character']);           // база всегда, внешность и характер при выходе (вышел недавно)
  r = selectSections(l, ['a'], { ...base, entered: { c2: 2 } });
  assert.deepEqual(kinds(r), ['basic']);                                  // давно на сцене: выход на сцену не шлётся
  r = selectSections(l, ['a'], { ...base, entered: { c2: 2 }, mode: 'intimacy' });
  assert.ok(kinds(r).includes('nsfw'));
  r = selectSections(l, ['a'], { ...base, entered: { c2: 2 }, recentText: 'Астарион вспомнил Каскадия.' });
  assert.ok(kinds(r).includes('biography'));                              // по ключу
  r = selectSections(l, ['l'], { ...base, recentText: 'Лаэзель? Lae\'zel вошла.', people: people.map(p => ({ ...p, present: true })) });
  assert.deepEqual(kinds(r), ['basic']);                                  // голос «никогда»
  assert.deepEqual(selectSections(l, ['a'], { ...base, people: people.map(p => (p.persona ? { ...p } : { ...p, present: false })), recentText: 'тихо' }), []);
  assert.deepEqual(selectSections(l, ['нет'], base), []);
  const persona = normalizeLibrary({ cards: [{ id: 'p', name: 'Лилит', sections: [{ id: 's', kind: 'basic', title: 'b', text: 'я' }] }] });
  assert.deepEqual(selectSections(persona, ['p'], base), []);             // анкета персоны не уходит
});

test('блок рассказчику: бюджет режет по важности, пустое не отправляется', () => {
  const l = lib();
  const picked = selectSections(l, ['a'], { people, recentText: 'Астарион.', chatLength: 5, entered: {} });
  const full = buildCardsBlock(picked, { maxChars: 12000 });
  assert.match(full.text, /^\[CHARACTER SHEETS/);
  assert.match(full.text, /== Astarion Ancunín ==\n# Basic Info\nБледный эльф/);
  assert.ok(full.text.indexOf('Basic Info') < full.text.indexOf('Visual'));
  const tight = buildCardsBlock(picked, { maxChars: 60 });
  assert.ok(tight.text.includes('Basic Info') && !tight.text.includes('Character and psychology'));
  assert.ok(tight.dropped.length > 0);
  assert.equal(buildCardsBlock([], {}).text, '');
  assert.equal(estimateTokens('x'.repeat(30)), 10);
});

test('записи лорбука подключённых карточек отбираются, чужие и секреты нет', () => {
  const l = lib();
  const test1 = sheetEntryTest(l, ['a']);
  assert.equal(test1(book[0]), true);
  assert.equal(test1(book[5]), false);                                    // Лаэзель не подключена
  assert.equal(test1(book[6]), false);                                    // секрет
  assert.equal(test1(book[7]), false);
  assert.equal(sheetEntryTest(l, []), null);
  assert.equal(sheetEntryTest(l, ['нет']), null);
});

const lorePath = './local-only/missing.json';
test('настоящий лорбук персонажей разбирается в карточки', { skip: !existsSync(lorePath) }, () => {
  const w = JSON.parse(readFileSync(lorePath, 'utf8'));
  const cards = cardsFromBook(Object.values(w.entries), 'Врата Балдура 3 - Персонажи');
  assert.ok(cards.length >= 10);
  assert.ok(cards.every(c => c.sections.length >= 1));
  const lib2 = normalizeLibrary({ cards: cards.map((c, i) => ({ id: 'c' + i, ...c, sections: c.sections.map((s, j) => ({ id: 's' + j, ...s })) })) });
  assert.equal(lib2.cards.length, cards.length);
});

import { sameCharacter } from '../src/core/cards.js';

test('другие виды названий: «Имя (Русское имя) — Раздел» и одиночные записи NPC', () => {
  assert.deepEqual(parseSheetTitle('Astarion (Астарион) — Basic Info'), { name: 'Astarion', alias: 'Астарион', title: 'Basic Info' });
  assert.equal(parseSheetTitle('Astarion (Астарион) — что-то своё'), null);          // только с известным названием раздела
  assert.equal(parseSheetTitle('Camp Relations — live (edit)'), null);
  assert.equal(parseSheetTitle('Kagha (Кага)'), null);                              // одиночные только по просьбе
  assert.deepEqual(parseSheetTitle('Kagha (Кага)', { single: true }), { name: 'Kagha', alias: 'Кага', title: 'Описание', single: true });
  const entries = [entry(1, 'Astarion (Астарион) — Basic Info', 'База'), entry(2, 'Astarion (Астарион) — Visual', 'Вид'), entry(3, 'Kagha (Кага)', 'Друидка'), entry(4, 'Правило NPC', 'x')];
  const cards = cardsFromBook(entries, 'K', { single: true });
  assert.deepEqual(cards.map(c => [c.name, c.aliases, c.sections.map(s => s.kind)]), [['Astarion', ['Астарион'], ['basic', 'visual']], ['Kagha', ['Кага'], ['basic']]]);
  assert.deepEqual(cardsFromBook(entries, 'K').map(c => c.name), ['Astarion']);
  assert.equal(sameCharacter('Astarion', 'Astarion Ancunín'), true);
  assert.equal(sameCharacter('Astarion Ancunín', 'Astarion'), true);
  assert.equal(sameCharacter('Gale', 'Galen'), false);
  assert.equal(sameCharacter('Wyll', 'Wyll Ravengard'), true);
});

test('основные и второстепенные: уровень при разборе, замена одиночной записи лорбука', () => {
  const entries = [entry(1, '[ Wyll ] - Basic Info', 'Воин.'), entry(2, 'Kagha (Кага)', 'Друидка.'), entry(3, 'Wyll (Уилл)', 'Одиночная про Уилла')];
  const cards = cardsFromBook(entries, 'Б', { single: true });
  assert.deepEqual(cards.map(c => [c.name, c.tier]), [['Wyll', 'main'], ['Kagha', 'minor']]);     // раздел делает основным даже при одиночной записи
  const lib = normalizeLibrary({ cards: [{ id: 'k', name: 'Kagha', tier: 'minor', aliases: ['Кага'], sections: [{ id: 's', kind: 'basic', title: 'Описание', text: 'Друидка.' }] }, { id: 'w', name: 'Wyll', sections: [] }] });
  assert.deepEqual(lib.cards.map(c => c.tier), ['minor', 'main']);
  const t = sheetEntryTest(lib, ['k']);
  assert.equal(t(entries[1]), true);                       // одиночная запись второстепенного вырезается
  assert.equal(t(entries[2]), false);                      // чужая одиночная запись нет
  const tm = sheetEntryTest(lib, ['w']);
  assert.equal(tm(entries[1]), false);                     // у основного одиночные записи других не вырезаются
  assert.equal(tm(entries[0]), true);
  const sel = selectSections(lib, ['k'], { people: [{ id: 'p1', name: 'Кага', persona: false, present: false }], recentText: 'Кага смотрит вдаль.', chatLength: 3, entered: {} });
  assert.deepEqual(sel.map(p => p.card.id), ['k']);        // назван в тексте: описание уходит
});

test('служебные записи NPC-лорбуков не становятся анкетами', () => {
  assert.equal(parseSheetTitle('Act 3 main (Главное)', { single: true }), null);
  assert.equal(parseSheetTitle('Правило NPC (Правила)', { single: true }), null);
  assert.equal(parseSheetTitle('Orin (Орин)', { single: true })?.name, 'Orin');
});

import { findDuplicates } from '../src/core/cards.js';
test('похожие карточки: Vestor и Alden Vestor предлагаются к объединению, разные имена нет', () => {
  const mk = (id, name, text = '', aliases = []) => ({ id, name, aliases, sections: [{ id: 's', title: 'База', text }] });
  const r = findDuplicates([mk('1', 'Vestor', 'коротко'), mk('2', 'Alden Vestor', 'длинное описание персонажа'), mk('3', 'Astarion'), mk('4', 'Gale'), mk('5', 'Алия', '', ['Gale'])]);
  assert.equal(r.length, 2);
  assert.equal(r[0].a.id, '2'); assert.equal(r[0].b.id, '1');          // главная та, где больше текста
  assert.deepEqual([r[1].a.id, r[1].b.id].sort(), ['4', '5']);          // общий псевдоним
  assert.equal(findDuplicates([mk('1', 'Karlach'), mk('2', 'Shadowheart')]).length, 0);
});

test('упоминание ищется с начала слова, а не внутри чужого', () => {
  const mol = { name: 'Mol', aliases: ['Мол'] };
  assert.equal(mentionedIn(mol, 'Он смолк и отвернулся.'), false);
  assert.equal(mentionedIn(mol, 'Мол хочет уйти.'), true);
  assert.equal(mentionedIn(mol, 'Он сказал Молу подождать.'), true);
});

test('короткое имя не находится в длинном слове: «Мол» и «молитвы»', () => {
  const mol = { name: 'Mol', aliases: ['Мол'] };
  assert.equal(mentionedIn(mol, 'Целительные молитвы не дешёвое вино.'), false);
  assert.equal(mentionedIn(mol, 'Мол, постой.'), true);
  assert.equal(mentionedIn({ name: 'Гейл', aliases: [] }, 'Гейла не было видно.'), true);
});

test('второстепенная карточка срабатывает на название целиком, а не на отдельные обычные слова', () => {
  const place = { name: 'Refugee camp', tier: 'minor', aliases: ['Лагерь беженцев', 'До и после перекрестка'] };
  assert.equal(mentionedIn(place, 'Отложим до вечера в лагере. А после она вздохнула.'), false);
  assert.equal(mentionedIn(place, 'Они пришли в Лагерь беженцев.'), true);
  assert.equal(mentionedIn({ name: 'Alden Vestor', tier: 'main', aliases: [] }, 'Vestor молчал.'), true);
});

test('NPC-лорбук с записями-именами: «Кага», «Дейм Айлин» берутся как второстепенные, «Правило NPC» нет', () => {
  const entries = ['Правило NPC', 'Кага', 'Дейм Айлин', 'Изобель — Последний Свет'].map((comment, uid) => ({ uid, comment, content: 'описание', key: [] }));
  const cards = cardsFromBook(entries, 'Врата Балдура 3 - NPC', { single: true });
  assert.deepEqual(cards.map(c => c.name), ['Кага', 'Дейм Айлин', 'Изобель — Последний Свет']);
  assert.ok(cards.every(c => c.tier === 'minor'));
});

import { ctxMatches } from '../src/core/cards.js';
test('контекст раздела: Мол уходит только при тифлингах, если её нет в кадре', () => {
  const entries = [{ uid: 1, comment: 'Мол', content: 'Тифлинг, главарь детей.', key: ['/мол/iu'], keysecondary: ['/(?<![\p{L}])тифлинг(?:а|и|ов)?/iu'] }];
  const [card] = cardsFromBook(entries, 'NPC', { single: true });
  assert.equal(card.sections[0].ctx.length, 1);
  const lib = normalizeLibrary({ cards: [{ id: 'm', name: 'Мол', tier: 'minor', aliases: [], sections: card.sections }] });
  const pick = (text, present = false) => selectSections(lib, ['m'], { people: present ? [{ id: 'p', name: 'Мол', present: true }] : [], recentText: text, mode: '', entered: {}, chatLength: 5 });
  assert.equal(pick('Мол, хватит! — сказал он.').length, 0);                          // имя есть, контекста нет
  assert.equal(pick('Мол и другие тифлинги прячутся.').length, 1);                    // контекст есть
  assert.equal(pick('Тишина.', true).length, 1);                                       // она в кадре: контекст не нужен
  assert.equal(ctxMatches(['тифлинг'], 'Тифлингов привели'), true);
});

test('в карточке сохраняются все ключи записи, и регулярки тоже; Мол узнаётся по ним', () => {
  const entries = [{ uid: 1, comment: 'Мол', content: 'Тифлинг.', key: ['/(?<![а-яё])мол(?:а|у)?(?![а-яё])/iu', 'mol'], keysecondary: ['тифлинг'] }];
  const [card] = cardsFromBook(entries, 'NPC', { single: true });
  assert.equal(card.sections[0].keys.length, 2);
  assert.equal(card.sections[0].keys[0].startsWith('/'), true);
  assert.deepEqual(card.sections[0].ctx, ['тифлинг']);
  const lib = normalizeLibrary({ cards: [{ id: 'm', name: 'Совсем другое', tier: 'minor', aliases: [], sections: card.sections }] });
  assert.equal(lib.cards[0].sections[0].keys.length, 2);                                // нормализация ничего не теряет
  const pick = text => selectSections(lib, ['m'], { people: [], recentText: text, mode: '', entered: {}, chatLength: 5 });
  assert.equal(pick('Мола привели, она тифлинг.').length, 1);                          // имя по ключу-регулярке и контекст
  assert.equal(pick('Мола привели.').length, 0);                                       // контекста нет
  assert.equal(pick('смолк тифлинг').length, 0);                                       // ключ с границами слова не цепляет «смолк»
});

import { cardFromWholeBook } from '../src/core/cards.js';
test('лорбук об одном персонаже: все записи становятся разделами одной карточки', () => {
  const entries = [
    { uid: 1, comment: '1. Обряд и семь тысяч душ', content: 'Текст раз.', key: ['обряд'], keysecondary: [] },
    { uid: 2, comment: '2. Казадор', content: 'Текст два.', key: [], keysecondary: [] },
    { uid: 3, comment: '[Секрет: X]', content: 'тайна', key: [] },
    { uid: 4, comment: '10. Интимный модуль', content: 'Текст.', key: [], disable: true },
  ];
  const card = cardFromWholeBook(entries, 'Астарион Вознесённый', 'Астарион Вознесённый');
  assert.equal(card.name, 'Астарион Вознесённый');
  assert.deepEqual(card.sections.map(s => s.title), ['Обряд и семь тысяч душ', 'Казадор']);   // номера убраны, секрет и выключенная пропущены
  assert.deepEqual(card.sections[0].keys, ['обряд']);
});

test('карточка находит своего человека между алфавитами: «Astarion Ancunín» и «Астарион»', () => {
  const card = { name: 'Astarion Ancunín', aliases: [] };
  assert.equal(matchPerson(card, [{ id: 'a', name: 'Гейл' }, { id: 'b', name: 'Астарион' }])?.id, 'b');
  assert.equal(matchPerson(card, [{ id: 'a', name: 'Гейл' }]), null);
});

test('выключенная запись (off) не уходит рассказчику, остальные идут как раньше; флаг переживает нормализацию', () => {
  const l = lib();
  const base = { people, recentText: 'Астарион смотрит на Гейла.', chatLength: 20, entered: { c2: 18 } };
  const kinds = sel => sel.flatMap(p => p.sections.map(s => s.section.kind));
  assert.deepEqual(kinds(selectSections(l, ['a'], base)), ['basic', 'visual', 'character']);
  l.cards[0].sections.find(s => s.kind === 'basic').off = true;
  const again = normalizeLibrary(JSON.parse(JSON.stringify(l)));
  assert.equal(again.cards[0].sections.find(s => s.kind === 'basic').off, true);
  assert.deepEqual(kinds(selectSections(again, ['a'], base)), ['visual', 'character']);
  assert.equal(again.cards[0].sections.filter(s => s.off).length, 1);
});
