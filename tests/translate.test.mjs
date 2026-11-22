import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText, buildSectionRequest, parseSectionReply, buildHeadRequest, parseHeadReply, normalizeRu, planBlocks, blockState, headHash, sectionHash } from '../extension/src/core/translate.js';
import { normalizeLibrary } from '../extension/src/core/cards.js';
import { wikiOf, splitSections } from '../extension/src/core/wiki.js';

test('отпечаток меняется вместе с текстом', () => {
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
});

test('ответ по разделу: заголовок, три тире, текст; без разделителя берётся весь текст', () => {
  const r = parseSectionReply('Основное\n---\n- **Возраст:** 200 лет\n- **Рост:** 180 см', 'Basic');
  assert.equal(r.title, 'Основное'); assert.match(r.text, /^- \*\*Возраст:\*\* 200 лет\n- \*\*Рост:\*\* 180 см$/);
  const bare = parseSectionReply('Просто текст без заголовка.', 'Basic');
  assert.equal(bare.title, 'Basic'); assert.equal(bare.text, 'Просто текст без заголовка.');
  assert.equal(parseSectionReply('```\nЗаголовок: X\n---\nТекст\n```').text, 'Текст');
  assert.equal(parseSectionReply('   '), null);
  const withPrefix = parseSectionReply('TITLE: Внешность\n---\nТекст', 'Look');
  assert.equal(withPrefix.title, 'Внешность');
});

test('запрос по разделу содержит заголовок и текст', () => {
  const m = buildSectionRequest({ title: 'Basic', text: '- **Age:** old' });
  assert.equal(m[0].role, 'system'); assert.match(m[1].content, /TITLE: Basic\n---\n- \*\*Age:\*\* old/);
});

test('шапка: метки блоков разбираются, лишнее в скобках после метки отбрасывается', () => {
  const m = buildHeadRequest({ lead: 'Elf rogue.', tagline: 'vampire spawn', facts: [{ k: 'Возраст', v: 'late twenties' }, { k: 'Рост', v: '180 см' }] });
  assert.match(m[1].content, /\[fact 2\] \(Рост\)\n180 см/);
  const got = parseHeadReply('[lead]\nЭльф-плут.\n\n[tagline]\nотпрыск вампира\n\n[fact 1] (Возраст)\nпозднее третье десятилетие\n\n[fact 2]\n180 см', 2);
  assert.deepEqual(got, { lead: 'Эльф-плут.', tagline: 'отпрыск вампира', facts: ['позднее третье десятилетие', '180 см'], titles: [] });
  assert.equal(parseHeadReply('просто текст', 1), null);
});

test('сохранённый перевод нормализуется, пустое отбрасывается', () => {
  assert.equal(normalizeRu(null), null);
  assert.equal(normalizeRu({ head: null, sections: { s1: { text: '' } } }), null);
  const ru = normalizeRu({ head: { lead: 'Привет', facts: ['a', 7], h: 'x', edited: true }, sections: { s1: { title: 'Т', text: 'Текст', h: 'q' } } });
  assert.equal(ru.head.lead, 'Привет'); assert.equal(ru.head.edited, true); assert.deepEqual(ru.head.facts, ['a', '7']);
  assert.equal(ru.sections.s1.text, 'Текст');
});

test('перевод переживает нормализацию библиотеки карточек', () => {
  const lib = normalizeLibrary({ cards: [{ id: 'k1', name: 'Астарион', sections: [{ id: 's1', title: 'Basic', text: 'Elf.' }], ru: { sections: { s1: { title: 'Основное', text: 'Эльф.', h: 'z' } } } }] });
  assert.equal(lib.cards[0].ru.sections.s1.text, 'Эльф.');
});

function sampleCard(ruPatch) {
  const card = { id: 'k1', name: 'Астарион', aliases: [], sections: [
    { id: 's1', kind: 'basic', title: 'Basic Info', text: '- **Occupation and role:** Elf rogue.' },
    { id: 's2', kind: 'other', title: 'History', text: 'He was a slave.' },
    { id: 'n1', kind: 'other', title: 'Romance and intimacy', text: 'Intimate part.' },
  ] };
  if (ruPatch) card.ru = ruPatch(card);
  return card;
}
const planOf = (card, o = {}) => { const parts = splitSections(card.sections); return planBlocks(card, { wiki: wikiOf(card), article: parts.article, intimate: parts.intimate, ...o }); };

test('план: без перевода все блоки статьи, интимный модуль только по просьбе', () => {
  const card = sampleCard();
  assert.deepEqual(planOf(card).map(b => b.kind === 'head' ? 'head' : b.id), ['head', 's1', 's2']);
  assert.deepEqual(planOf(card, { withIntimate: true }).map(b => b.id ?? 'head'), ['head', 's1', 's2', 'n1']);
});

test('план: свежие блоки пропускаются, изменённый оригинал помечается устаревшим, force берёт всё', () => {
  const card = sampleCard(c => ({ head: { lead: 'x', tagline: '', facts: [], h: headHash(wikiOf(c)) }, titles: { s1: { t: 'Основное', h: hashText('Basic Info') }, s2: { t: 'История', h: hashText('History') } },
    sections: { s1: { title: 'Основное', text: 'Эльф.', h: sectionHash(c.sections[0]) }, s2: { title: 'История', text: 'Раб.', h: 'old', edited: true } } }));
  const plan = planOf(card);
  assert.deepEqual(plan.map(b => b.id), ['s2']);
  assert.equal(plan[0].state, 'stale'); assert.equal(plan[0].edited, true);
  assert.equal(planOf(card, { force: true }).length, 3);
  assert.equal(blockState(null, 'a'), 'none'); assert.equal(blockState({ h: 'a' }, 'a'), 'fresh');
});

test('шапка переводится вместе с названиями разделов, и они разбираются по номерам', () => {
  const m = buildHeadRequest({ lead: 'L', facts: [], titles: [{ id: 's1', title: 'Basic Info' }, { id: 's2', title: 'History' }] });
  assert.match(m[1].content, /\[title 2\]\nHistory/);
  const got = parseHeadReply('[lead]\nВ\n\n[title 1]\nОсновное\n\n[title 2]\nИстория', 0, 2);
  assert.deepEqual(got.titles, ['Основное', 'История']);
});
test('без перевода названия шапка считается устаревшей даже при свежем вступлении', () => {
  const card = sampleCard(c => ({ head: { lead: 'x', tagline: '', facts: [], h: headHash(wikiOf(c)) }, sections: {} }));
  const plan = planOf(card);
  assert.equal(plan[0].kind, 'head'); assert.equal(plan[0].state, 'stale');
});
