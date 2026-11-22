import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInventory } from '../src/core/inventory.js';
import { equipment, wear, unwear, findGear, gearLine, wardrobeOf, backpackOf } from '../src/core/gear.js';

const base = () => normalizeInventory([
  { id: 'd1', name: 'Кинжал', ownerId: 'a', kind: 'weapon', range: 'melee', hands: 1, worn: true },
  { id: 'd2', name: 'Кинжал запасной', ownerId: 'a', kind: 'weapon', range: 'melee', hands: 1 },
  { id: 'sw', name: 'Двуручный меч', ownerId: 'a', kind: 'weapon', range: 'melee', hands: 2 },
  { id: 'xb', name: 'Тяжёлый арбалет', ownerId: 'a', kind: 'weapon', range: 'ranged', hands: 2 },
  { id: 'lb', name: 'Лёгкий арбалет', ownerId: 'a', kind: 'weapon', range: 'ranged', hands: 1, worn: true },
  { id: 'c1', name: 'Накидка', ownerId: 'a', kind: 'gear', slot: 'cloak', worn: true, cond: 'промокла' },
  { id: 'c2', name: 'Чёрный плащ', ownerId: 'a', kind: 'gear', slot: 'cloak' },
  { id: 'k1', name: 'Ключ', ownerId: 'a' }, { id: 'z1', name: 'Чужая шапка', ownerId: 'b', kind: 'gear', slot: 'head' },
]);

test('вещи гардероба нормализуются, обычные вещи остаются рюкзаком', () => {
  const inv = base();
  assert.equal(wardrobeOf(inv, 'a').length, 7); assert.deepEqual(backpackOf(inv, 'a').map(i => i.id), ['k1']);
  assert.equal(normalizeInventory([{ id: 'x', name: 'Шлем', kind: 'gear', slot: 'вздор' }])[0].slot, 'body');
  assert.equal(normalizeInventory([{ id: 'x', name: 'Меч', kind: 'weapon', hands: 7 }])[0].hands, 1);
  assert.equal(normalizeInventory([{ id: 'x', name: 'Меч' }])[0].kind, undefined);
});
test('экипировка: слоты и пары рук; двуручное занимает обе ячейки', () => {
  let inv = base();
  let e = equipment(inv, 'a');
  assert.equal(e.slots.cloak.id, 'c1'); assert.equal(e.slots.head, null);
  assert.deepEqual([e.melee[0].id, e.melee[1]], ['d1', null]);
  assert.deepEqual([e.ranged[0].id, e.ranged[1]], ['lb', null]);
  inv = wear(inv, 'sw').items; e = equipment(inv, 'a');
  assert.deepEqual([e.melee[0].id, e.melee[1]], ['sw', 'ghost']);                     // кинжал убран, меч в обе руки
  assert.ok(!inv.find(i => i.id === 'd1').worn);
  inv = wear(inv, 'd1').items; e = equipment(inv, 'a');
  assert.deepEqual([e.melee[0].id, e.melee[1]], ['d1', null]);                        // одноручное освобождает вторую руку и меч уходит
  inv = wear(inv, 'd2').items; e = equipment(inv, 'a');
  assert.deepEqual([e.melee[0].id, e.melee[1].id], ['d1', 'd2']);                     // два кинжала
  inv = wear(inv, 'xb').items; e = equipment(inv, 'a');
  assert.deepEqual([e.ranged[0].id, e.ranged[1]], ['xb', 'ghost']);                   // тяжёлый арбалет вытеснил лёгкий
});
test('одежда вытесняет прежнюю в слоте; отмена возвращает как было; чужое надеть нельзя', () => {
  const inv = base();
  const r = wear(inv, 'c2');
  assert.equal(r.ok, true); assert.ok(!r.items.find(i => i.id === 'c1').worn); assert.equal(r.items.find(i => i.id === 'c2').worn, true);
  assert.deepEqual(r.touched.sort(), ['c1', 'c2']); assert.equal(r.before.find(i => i.id === 'c1').worn, true);
  assert.equal(wear(inv, 'k1').ok, false);                                            // обычная вещь не одежда
  assert.equal(wear(inv, 'нет').ok, false); assert.equal(wear(inv, 'c1').ok, false);  // уже надето
  assert.equal(unwear(inv, 'c1').items.find(i => i.id === 'c1').worn, false);
  assert.equal(unwear(inv, 'c2').ok, false);
});
test('поиск вещи по названию и строка для рассказчика', () => {
  const inv = base();
  assert.equal(findGear(inv, 'a', 'плащ')?.id, 'c2'); assert.equal(findGear(inv, 'a', 'шапка'), null);   // чужая шапка не находится
  assert.equal(gearLine('Астарион', inv, 'a'), 'outfit[Астарион]: cloak: Накидка (промокла); holding: Кинжал, Лёгкий арбалет');
  assert.equal(gearLine('Пусто', [], 'a'), '');
});

import { weaponKindOf, WEAPON_KINDS, WEAPON_IDS } from '../src/core/gear.js';
import { normalizeItem } from '../src/core/inventory.js';
import { weaponIcon, WEAPON_ICON_IDS } from '../src/ui/weapon-icons.js';

test('вид оружия: сохранённый wtype главнее, иначе угадывается по названию, арбалет не путается с луком', () => {
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Что-то', wtype: 'mace' }), 'mace');
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Кинжал с золотым тиснением' }), 'dagger');
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Короткий арбалет' }), 'crossbow');
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Длинный лук' }), 'bow');
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Ледяной посох' }), 'staff');
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Жезл Огня' }), '');                          // жезла среди видов нет: общий значок
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Булава жреца' }), 'mace');
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Двуручный меч' }), 'sword');
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Странная штука' }), '');
  assert.equal(weaponKindOf({ kind: 'gear', name: 'Меч-плащ', slot: 'cloak' }), '');           // одежда без вида оружия
  assert.equal(weaponKindOf({ kind: 'weapon', name: 'Клубок', wtype: 'nope' }), '');
});
test('wtype переживает нормализацию только у оружия и только из списка', () => {
  const w = normalizeItem({ id: 'a', name: 'Булава', kind: 'weapon', range: 'melee', hands: 1, wtype: 'mace' });
  assert.equal(w.wtype, 'mace');
  assert.equal(normalizeItem({ id: 'b', name: 'Х', kind: 'weapon', wtype: 'laser' }).wtype, undefined);
  assert.equal(normalizeItem({ id: 'c', name: 'Плащ', kind: 'gear', slot: 'cloak', wtype: 'mace' }).wtype, undefined);
});
test('у каждого вида оружия есть значок и подпись; значок возвращает span-маску, для неизвестного пусто', () => {
  assert.deepEqual([...WEAPON_ICON_IDS].sort(), [...WEAPON_IDS].sort());
  for (const k of WEAPON_KINDS) { assert.ok(k.ru); assert.match(weaponIcon(k.id), /^<span class="wi" role="img" style="--wi:url\('.+\/assets\/weapons\/[a-z]+\.png'\)"><\/span>$/); }
  assert.equal(weaponIcon('laser'), '');
});

import { SLOTS as SLOTS_FOR_TEST, OUTFITS, outfitByWords, normalizeOutfits, outfitSet, outfitSaveWorn, outfitState, wearOutfit } from '../src/core/gear.js';
import { mergePeople as mergePeopleForOutfits } from '../src/core/merge-people.js';

const wardrobe = () => normalizeInventory([
  { id: 'b1', name: 'Камзол', ownerId: 'a', kind: 'gear', slot: 'body', worn: true },
  { id: 'b2', name: 'Парадный камзол', ownerId: 'a', kind: 'gear', slot: 'body' },
  { id: 'f1', name: 'Сапоги', ownerId: 'a', kind: 'gear', slot: 'feet', worn: true },
  { id: 'f2', name: 'Туфли', ownerId: 'a', kind: 'gear', slot: 'feet' },
  { id: 'h1', name: 'Шляпа', ownerId: 'a', kind: 'gear', slot: 'head' },
  { id: 'x1', name: 'Чужой плащ', ownerId: 'z', kind: 'gear', slot: 'cloak' },
  { id: 'w1', name: 'Кинжал', ownerId: 'a', kind: 'weapon', range: 'melee', hands: 1 },
]);

test('комплекты: три вида, без домашнего; слова из текста находят комплект', () => {
  assert.deepEqual(OUTFITS.map(o => o.id), ['formal', 'travel', 'camp']);
  assert.equal(outfitByWords('он надел парадное'), 'formal');
  assert.equal(outfitByWords('переоделся в дорожную одежду'), 'travel');
  assert.equal(outfitByWords('сменил на лагерную'), 'camp');
  assert.equal(outfitByWords('надел плащ'), '');
});

test('нормализация комплектов выбрасывает чужие вещи, неверные слоты и неизвестные виды', () => {
  const items = wardrobe();
  const raw = { a: { formal: { body: 'b2', feet: 'f2', head: 'nope', hands: 'h1' }, home: { body: 'b1' }, travel: { body: 'x1' } }, ghost: { camp: { body: 'b1' } } };
  assert.deepEqual(normalizeOutfits(raw, items), { a: { formal: { body: 'b2', feet: 'f2' } } });
  assert.deepEqual(normalizeOutfits(null, items), {});
});

test('вещь входит в комплект и выходит, пустые комплекты исчезают', () => {
  let o = outfitSet({}, 'a', 'formal', 'body', 'b2');
  o = outfitSet(o, 'a', 'formal', 'feet', 'f2');
  assert.deepEqual(o, { a: { formal: { body: 'b2', feet: 'f2' } } });
  o = outfitSet(o, 'a', 'formal', 'body', 'b1');                       // в слоте одна вещь
  assert.equal(o.a.formal.body, 'b1');
  o = outfitSet(outfitSet(o, 'a', 'formal', 'body', ''), 'a', 'formal', 'feet', '');
  assert.deepEqual(o, {});
  assert.deepEqual(outfitSet({}, 'a', 'home', 'body', 'b1'), {});         // неизвестный вид игнорируется
});

test('сохранить надетое как комплект: только одежда, оружие не попадает', () => {
  const o = outfitSaveWorn(wardrobe(), {}, 'a', 'travel');
  assert.deepEqual(o, { a: { travel: { body: 'b1', feet: 'f1' } } });
});

test('надеть комплект: занятые слоты меняются разом, остальное на месте; отмена по снимку', () => {
  const items = wardrobe();
  const o = { a: { formal: { body: 'b2', feet: 'f2', head: 'h1' } } };
  const st = outfitState(items, o, 'a', 'formal');
  assert.equal(st.total, 3); assert.equal(st.worn, 0); assert.equal(st.full, false);
  const r = wearOutfit(items, o, 'a', 'formal');
  assert.equal(r.ok, true);
  const worn = r.items.filter(i => i.worn).map(i => i.id).sort();
  assert.deepEqual(worn, ['b2', 'f2', 'h1']);                          // прежние камзол и сапоги сняты
  assert.ok(r.before.some(i => i.id === 'b1' && i.worn === true));    // снимок для отмены хранит прежнее состояние
  assert.equal(outfitState(r.items, o, 'a', 'formal').full, true);
  assert.equal(wearOutfit(r.items, o, 'a', 'formal').ok, false);       // уже надето
  assert.equal(wearOutfit(items, {}, 'a', 'camp').ok, false);          // комплект пуст
});

test('слияние людей переносит комплекты лишнего к основному', () => {
  const s = { cast: [{ id: 'k', name: 'Астарион', persona: false, present: true }, { id: 'd', name: 'Astarion Ancunín', persona: false, present: true }], bodies: {}, inventory: [], outfits: { d: { camp: { body: 'b1' } }, k: { camp: { feet: 'f1' } } },
    relations: { people: [], lines: [], headcanons: [], triangles: [], log: [] }, knowledge: { events: [], learned: [], acquaintances: {}, deaths: {} }, cards: { ids: [], entered: {} }, fate: {} };
  assert.equal(mergePeopleForOutfits(s, 'k', 'd').ok, true);
  assert.deepEqual(s.outfits, { k: { camp: { feet: 'f1' } } });          // у основного свой комплект главнее
});

import { CLOTHING_KINDS, CLOTHING_IDS, clothingKindOf, clothingForSlot } from '../src/core/gear.js';
import { clothIcon, CLOTH_ICON_IDS } from '../src/ui/cloth-icons.js';

test('вид одежды: по названию внутри слота, специфичное раньше общего', () => {
  const g = (name, slot, extra = {}) => clothingKindOf({ kind: 'gear', name, slot, ...extra });
  assert.equal(g('Пурпурный камзол', 'body'), 'doublet');
  assert.equal(g('Накидка с капюшоном', 'cloak'), 'cloak');
  assert.equal(g('Чёрный плащ', 'cloak'), 'cloak');
  assert.equal(g('Нагрудник стража', 'body'), 'plate');
  assert.equal(g('Кольчуга', 'body'), 'mail');
  assert.equal(g('Лагерная одежда', 'body'), 'camp');
  assert.equal(g('Одежда для привала', 'body'), 'camp');
  assert.equal(g('Кожаный доспех', 'body'), 'leather');
  assert.equal(g('Мантия мага', 'body'), 'robe');
  assert.equal(g('Дорожная рубаха', 'body'), 'cloth');
  assert.equal(g('Кожаные перчатки', 'hands'), 'gloves');
  assert.equal(g('Латные рукавицы', 'hands'), 'gauntlets');
  assert.equal(g('Наручи следопыта', 'hands'), 'bracers');
  assert.equal(g('Латные сапоги', 'feet'), 'sabatons');
  assert.equal(g('Высокие сапоги', 'feet'), 'boots');
  assert.equal(g('Бальные туфли', 'feet'), 'shoes');
  assert.equal(g('Шляпа с пером', 'head'), 'hat');
  assert.equal(g('Стальной шлем', 'head'), 'helmet');
  assert.equal(g('Колпак мага', 'head'), 'hat');
  assert.equal(g('Кожаный шлем', 'head'), 'cap');
  assert.equal(g('Кожаная шапка', 'head'), 'cap');
  assert.equal(g('Зелёный капюшон', 'head'), 'hood');
  assert.equal(g('Штаны', 'legs'), '');                         // слота ног больше нет
  assert.equal(g('Плащ', 'body'), '');                          // «плащ» не вид слота «тело»
  assert.equal(clothingKindOf({ kind: 'weapon', name: 'Кинжал' }), '');
});
test('сохранённый ctype главнее названия, но только если подходит слоту', () => {
  assert.equal(clothingKindOf({ kind: 'gear', name: 'Странная вещь', slot: 'body', ctype: 'robe' }), 'robe');
  assert.equal(clothingKindOf({ kind: 'gear', name: 'Странная вещь', slot: 'feet', ctype: 'robe' }), '');
  assert.equal(clothingKindOf({ kind: 'gear', name: 'Сапоги', slot: 'feet', ctype: 'shoes' }), 'shoes');
});
test('ctype переживает нормализацию только у одежды и только из списка', () => {
  assert.equal(normalizeItem({ id: 'a', name: 'Мантия', kind: 'gear', slot: 'body', ctype: 'robe' }).ctype, 'robe');
  assert.equal(normalizeItem({ id: 'b', name: 'Х', kind: 'gear', slot: 'body', ctype: 'spacesuit' }).ctype, undefined);
  assert.equal(normalizeItem({ id: 'c', name: 'Меч', kind: 'weapon', ctype: 'robe' }).ctype, undefined);
});
test('у каждого вида одежды есть значок, подпись и слот; значки для неизвестного нет', () => {
  assert.deepEqual([...CLOTH_ICON_IDS].sort(), [...CLOTHING_IDS].sort());
  for (const k of CLOTHING_KINDS) { assert.ok(k.ru); assert.match(clothIcon(k.id), /^<img class="ci" src=".+\/assets\/clothes\/[a-z0-9]+\.png"/); }
  assert.equal(clothIcon('spacesuit'), '');
  assert.deepEqual(clothingForSlot('feet').map(k => k.id), ['sabatons', 'boots', 'shoes']);
});

test('слот ног убран: старые штаны становятся «телом», двух надетых вещей в слоте не бывает', () => {
  const items = normalizeInventory([
    { id: 'b', name: 'Камзол', ownerId: 'a', kind: 'gear', slot: 'body', worn: true },
    { id: 'l', name: 'Штаны', ownerId: 'a', kind: 'gear', slot: 'legs', worn: true },
    { id: 'm', name: 'Рубаха', ownerId: 'z', kind: 'gear', slot: 'legs', worn: true },
  ]);
  assert.equal(items.find(i => i.id === 'l').slot, 'body');
  assert.equal(items.find(i => i.id === 'b').worn, true);
  assert.equal(items.find(i => i.id === 'l').worn, undefined);          // в слоте остаётся первая надетая
  assert.equal(items.find(i => i.id === 'm').worn, true);               // у другого человека не мешает
  assert.deepEqual(SLOTS_FOR_TEST.map(s => s.id), ['head', 'cloak', 'body', 'hands', 'feet']);
});

import { CAMP_LOOKS, campLookOf } from '../src/core/gear.js';
test('лагерная одежда: десять обликов, номер хранится у вещи, значок берётся по номеру', () => {
  assert.equal(CAMP_LOOKS.length, 10);
  assert.equal(campLookOf({ look: 7 }), 7); assert.equal(campLookOf({}), 1); assert.equal(campLookOf({ look: 99 }), 1); assert.equal(campLookOf({ look: 'x' }), 1);
  assert.equal(normalizeItem({ id: 'a', name: 'Лагерная одежда', kind: 'gear', slot: 'body', ctype: 'camp', look: 4 }).look, 4);
  assert.equal(normalizeItem({ id: 'b', name: 'Х', kind: 'gear', slot: 'body', look: 11 }).look, undefined);
  assert.equal(normalizeItem({ id: 'c', name: 'Меч', kind: 'weapon', look: 3 }).look, undefined);
  assert.match(clothIcon('camp', 6), /camp6\.png/); assert.match(clothIcon('camp'), /camp1\.png/); assert.match(clothIcon('camp', 99), /camp1\.png|camp10\.png/);
});

import { slotIcon, SLOT_ICON_IDS } from '../src/ui/cloth-icons.js';
test('у каждого слота есть значок пустого слота, и он тот же набор, что слоты одежды', () => {
  assert.deepEqual([...SLOT_ICON_IDS].sort(), SLOTS_FOR_TEST.map(s => s.id).sort());
  for (const id of SLOT_ICON_IDS) assert.match(slotIcon(id), /^<span class="wi sph" role="img" style="--wi:url\('.+\/assets\/slots\/[a-z]+\.png'\)"><\/span>$/);
  assert.equal(slotIcon('legs'), '');
});
