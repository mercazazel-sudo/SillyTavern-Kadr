import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCards, normSearch } from '../extension/src/core/card-search.js';

const card = (id, name, o = {}) => ({ id, name, aliases: o.aliases ?? [], tier: o.tier ?? 'main', sections: [{ title: 'Описание', text: o.text ?? '' }] });
const cards = [
  card('1', 'Астарион', { text: 'Vampire spawn. Rogue. Charming and sharp.' }),
  card('2', 'Лаэзель', { aliases: ['Lae\'zel'], text: 'Githyanki warrior.' }),
  card('3', 'Рафаил', { tier: 'minor', text: 'Raphael. Cambion. House of Hope.' }),
  card('4', 'Жрица Кишка', { tier: 'minor', text: 'Goblin priestess of the Absolute.' }),
  card('5', 'Карлах', { text: 'Tiefling barbarian from Avernus.' }),
  card('6', 'Старший мозг', { tier: 'minor', text: 'Elder brain in the Underdark.' }),
];
const ids = (q, o) => searchCards(cards, q, o).map(r => r.card.id);

test('normSearch: регистр, ё, знаки препинания, пробелы', () => {
  assert.equal(normSearch('  Лае\'зель,  Ёж! '), 'лае зель еж');
  assert.equal(normSearch(''), '');
  assert.equal(normSearch(null), '');
});

test('поиск по имени: начало слова, середина, любой порядок слов', () => {
  assert.deepEqual(ids('аст'), ['1']);
  assert.deepEqual(ids('ИШК'), ['4']);                  // середина слова
  assert.deepEqual(ids('кишка жрица'), ['4']);          // порядок слов не важен
  assert.deepEqual(ids('старш'), ['6']);
});

test('поиск по прозвищу и по латинице: Raphael находит Рафаил', () => {
  assert.deepEqual(ids('lae\'zel'), ['2']);
  assert.ok(ids('raphael').includes('3'));
  assert.equal(ids('raphael')[0], '3');
});

test('поиск по тексту анкеты, имя весит больше текста', () => {
  assert.deepEqual(ids('goblin'), ['4']);
  assert.deepEqual(ids('tiefling barbarian'), ['5']);
  const r = searchCards(cards, 'avernus');
  assert.equal(r[0].card.id, '5');
  assert.equal(r[0].where, 'текст анкеты');
  assert.equal(searchCards(cards, 'астар')[0].where, 'имя');
  const mix = [card('a', 'Гоблин', { text: '' }), card('b', 'Кто-то', { text: 'goblin' })];
  assert.deepEqual(searchCards(mix, 'гоблин').map(x => x.card.id), ['a']);
  assert.deepEqual(searchCards([card('a', 'Гоблин'), card('b', 'Goblin scout', { tier: 'minor' })], 'goblin').map(x => x.card.id), ['b', 'a']);
});

test('inText=false ищет только по именам', () => {
  assert.deepEqual(ids('goblin', { inText: false }), []);
  assert.deepEqual(ids('кишка', { inText: false }), ['4']);
});

test('все слова запроса должны найтись; пустой запрос и мусор ничего не дают', () => {
  assert.deepEqual(ids('астарион tiefling'), []);
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('   '), []);
  assert.deepEqual(ids('!!!'), []);
  assert.deepEqual(searchCards(null, 'а'), []);
});

test('порядок: точное имя выше, основные выше второстепенных при равенстве, лимит работает', () => {
  const list = [card('x', 'Рафаил Второй', { tier: 'minor' }), card('y', 'Рафаил', { tier: 'minor' }), card('z', 'Рафаил Великий')];
  assert.equal(searchCards(list, 'рафаил')[0].card.id, 'y');
  assert.equal(searchCards(list, 'рафаил', { limit: 2 }).length, 2);
});
