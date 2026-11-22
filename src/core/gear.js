/**
 * Гардероб и экипировка. Это не отдельный список, а свойства вещей из общего списка вещей (core/inventory.js):
 *   kind: 'gear' (одежда, слот slot) или 'weapon' (range 'melee' | 'ranged', hands 1 | 2); worn: надето или в руках;
 *   cond: состояние вещи («промокла», «порвана»), loot: откуда трофей. Вещь без kind это обычная вещь рюкзака.
 * Надеть можно только вещь из гардероба владельца: так персонаж не оденет то, чего у него нет.
 * Все операции чистые: возвращают новый список и снимок затронутого (before/touched) для отмены, как applyItemOp.
 */
export const SLOTS = Object.freeze([
  { id: 'head', ru: 'Голова' }, { id: 'cloak', ru: 'Накидка' }, { id: 'body', ru: 'Тело' },
  { id: 'hands', ru: 'Руки' }, { id: 'feet', ru: 'Обувь' },
]);
export const SLOT_IDS = Object.freeze(SLOTS.map(s => s.id));
export const RANGES = Object.freeze({ melee: 'Ближний бой', ranged: 'Дальний бой' });
export const slotRu = id => SLOTS.find(s => s.id === id)?.ru ?? id;

/**
 * Вид оружия (поле wtype у вещи kind 'weapon'): меч, кинжал, топор… От вида зависит только значок и подпись; дальность и руки
 * задаются отдельно (range, hands), вид даёт им значения по умолчанию. Если вид не задан, он угадывается по названию.
 */
export const WEAPON_KINDS = Object.freeze([
  { id: 'sword', ru: 'Меч', range: 'melee', hands: 1, re: /меч|клинок|сабл|рапир|шпаг|катан|скимитар|sword|rapier|saber|sabre|scimitar|blade/i },
  { id: 'dagger', ru: 'Кинжал', range: 'melee', hands: 1, re: /кинжал|нож|стилет|dagger|knife|dirk|stiletto/i },
  { id: 'axe', ru: 'Топор', range: 'melee', hands: 1, re: /топор|секир|axe|hatchet/i },
  { id: 'hammer', ru: 'Молот', range: 'melee', hands: 1, re: /молот|hammer|maul/i },
  { id: 'mace', ru: 'Булава', range: 'melee', hands: 1, re: /булав|шестопёр|шестопер|палица|mace|flail|club/i },
  { id: 'spear', ru: 'Копьё', range: 'melee', hands: 2, re: /копь|пика|алебард|spear|pike|halberd|glaive|trident/i },
  { id: 'staff', ru: 'Посох', range: 'melee', hands: 2, re: /посох|staff|quarterstaff/i },
  { id: 'bow', ru: 'Лук', range: 'ranged', hands: 2, re: /(?<![а-яё])лук(?![а-яё])|лука\b|луком|bow(?!ie)/i },
  { id: 'crossbow', ru: 'Арбалет', range: 'ranged', hands: 1, re: /арбалет|crossbow/i },
]);
export const WEAPON_IDS = Object.freeze(WEAPON_KINDS.map(k => k.id));
/** Вид оружия вещи: сохранённый wtype, иначе по названию (арбалет раньше лука), иначе '' (значок по умолчанию). */
export function weaponKindOf(item) {
  if (item?.kind !== 'weapon') return '';
  if (WEAPON_IDS.includes(item.wtype)) return item.wtype;
  const name = String(item.name ?? '');
  const order = ['crossbow', 'bow', 'dagger', 'staff', 'mace', 'hammer', 'axe', 'spear', 'sword'];
  return order.find(id => WEAPON_KINDS.find(k => k.id === id).re.test(name)) ?? '';
}

export const isGear = i => i?.kind === 'gear' || i?.kind === 'weapon';
export const wardrobeOf = (items, ownerId) => items.filter(i => i.ownerId === ownerId && isGear(i));
export const backpackOf = (items, ownerId) => items.filter(i => i.ownerId === ownerId && !isGear(i));

/**
 * Что надето и в руках: { slots: { head: вещь | null, … }, melee: [вещь|'ghost'|null, …], ranged: […] }.
 * В паре «ближний» и «дальний» две ячейки; двуручная вещь занимает обе: первая настоящая, вторая 'ghost' (рука занята).
 */
export function equipment(items, ownerId) {
  const worn = items.filter(i => i.ownerId === ownerId && i.worn);
  const slots = Object.fromEntries(SLOT_IDS.map(id => [id, worn.find(i => i.kind === 'gear' && i.slot === id) ?? null]));
  const pair = range => {
    const list = worn.filter(i => i.kind === 'weapon' && (i.range ?? 'melee') === range);
    const two = list.find(i => i.hands === 2);
    if (two) return [two, 'ghost'];
    return [list[0] ?? null, list[1] ?? null];
  };
  return { slots, melee: pair('melee'), ranged: pair('ranged') };
}

const copy = items => items.map(i => ({ ...i }));
const snap = (items, touched) => touched.map(id => items.find(i => i.id === id)).filter(Boolean).map(i => ({ ...i }));

/** Надевает вещь: одежда вытесняет прежнюю в слоте; оружие занимает руки по правилам пары. Возвращает { ok, items, touched, before, reason }. */
export function wear(items, itemId) {
  const it = items.find(i => i.id === itemId);
  if (!it || !isGear(it)) return { ok: false, reason: 'такой вещи нет в гардеробе', items };
  if (it.worn) return { ok: false, reason: 'уже надето', items };
  const next = copy(items), target = next.find(i => i.id === itemId);
  const touched = [itemId];
  const off = x => { if (x.worn) { x.worn = false; touched.push(x.id); } };
  const mine = next.filter(i => i.ownerId === target.ownerId && i.id !== target.id && i.worn);
  if (target.kind === 'gear') {
    mine.filter(i => i.kind === 'gear' && i.slot === target.slot).forEach(off);
  } else {
    const range = target.range ?? 'melee';
    const group = mine.filter(i => i.kind === 'weapon' && (i.range ?? 'melee') === range);
    if (target.hands === 2) group.forEach(off);                       // двуручное освобождает обе руки
    else { group.filter(i => i.hands === 2).forEach(off); const rest = group.filter(i => i.hands !== 2 && i.worn); if (rest.length >= 2) off(rest[0]); }
  }
  target.worn = true;
  return { ok: true, items: next, touched: [...new Set(touched)], before: snap(items, [...new Set(touched)]) };
}

/** Снимает вещь. */
export function unwear(items, itemId) {
  const it = items.find(i => i.id === itemId);
  if (!it || !it.worn) return { ok: false, reason: 'не надето', items };
  const next = copy(items);
  next.find(i => i.id === itemId).worn = false;
  return { ok: true, items: next, touched: [itemId], before: snap(items, [itemId]) };
}

/** Название вещи → вещь гардероба владельца (для Архивариуса: «накинул плащ»). Совпадение или одно название внутри другого. */
export function findGear(items, ownerId, name) {
  const n = String(name ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const mine = wardrobeOf(items, ownerId);
  const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  return mine.find(i => norm(i.name) === n) ?? mine.find(i => Math.min(norm(i.name).length, n.length) >= 4 && (norm(i.name).includes(n) || n.includes(norm(i.name)))) ?? null;
}

/** Строка для рассказчика: что надето и в руках у человека. '' если ничего не отмечено. */
export function gearLine(name, items, ownerId) {
  const e = equipment(items, ownerId);
  const part = i => `${i.name}${i.cond ? ` (${i.cond})` : ''}`;
  const worn = SLOT_IDS.map(id => (e.slots[id] ? `${id}: ${part(e.slots[id])}` : '')).filter(Boolean);
  const hold = [...e.melee, ...e.ranged].filter(x => x && x !== 'ghost').map(part);
  if (!worn.length && !hold.length) return '';
  return `outfit[${name}]: ${worn.join('; ')}${worn.length && hold.length ? '; ' : ''}${hold.length ? `holding: ${hold.join(', ')}` : ''}`;
}
export const GEAR_RULE = 'outfit[X] is what X wears and holds right now: describe only these clothes and weapons on X; an item changes only when the story shows it being put on, taken off or swapped, never on your own; clothing conditions (wet, torn) persist until the story fixes them';

// ---------- комплекты одежды ----------
// Комплект это сохранённая раскладка «слот → вещь гардероба» у человека: Парадная, Походная, Лагерная (домашней нет).
// Хранится отдельно от вещей: outfits[ownerId][outfitId][slot] = id вещи. Вещь может входить в несколько комплектов.
// Комплект надевает только занятые слоты; остальное на человеке не трогается. Состояние вещи (промокла, порвана) остаётся у вещи.
export const OUTFITS = Object.freeze([
  { id: 'formal', ru: 'Парадная', re: /парадн|выходн|торжествен|бальн|формальн|нарядн|formal|dress|ceremon/i },
  { id: 'travel', ru: 'Походная', re: /походн|дорожн|в\s+путь|travel|journey|adventur|road/i },
  { id: 'camp', ru: 'Лагерная', re: /лагерн|привал|ночн[а-я]*\s+одежд|camp|rest\b/i },
]);
export const OUTFIT_IDS = Object.freeze(OUTFITS.map(o => o.id));
export const outfitRu = id => OUTFITS.find(o => o.id === id)?.ru ?? id;
/** Комплект по слову из текста («надел парадное», «переоделся в дорожное»), иначе ''. */
export const outfitByWords = text => OUTFITS.find(o => o.re.test(String(text ?? '')))?.id ?? '';

/** Чистка сохранённых комплектов: известные виды и слоты, вещи-одежда этого владельца с тем же слотом; пустое отбрасывается. */
export function normalizeOutfits(raw, items) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [owner, sets] of Object.entries(raw).slice(0, 80)) {
    if (!sets || typeof sets !== 'object') continue;
    const mine = {};
    for (const oid of OUTFIT_IDS) {
      const map = {};
      for (const slot of SLOT_IDS) {
        const id = sets[oid]?.[slot];
        const it = typeof id === 'string' ? items.find(i => i.id === id) : null;
        if (it && it.kind === 'gear' && it.slot === slot && it.ownerId === owner) map[slot] = id;
      }
      if (Object.keys(map).length) mine[oid] = map;
    }
    if (Object.keys(mine).length) out[owner.slice(0, 64)] = mine;
  }
  return out;
}

/** Записывает вещь в слот комплекта (itemId '' убирает слот). Возвращает новый объект комплектов. */
export function outfitSet(outfits, ownerId, outfitId, slot, itemId) {
  if (!OUTFIT_IDS.includes(outfitId) || !SLOT_IDS.includes(slot)) return outfits ?? {};
  const next = JSON.parse(JSON.stringify(outfits ?? {}));
  const mine = (next[ownerId] ??= {});
  const map = (mine[outfitId] ??= {});
  if (itemId) map[slot] = itemId; else delete map[slot];
  if (!Object.keys(map).length) delete mine[outfitId];
  if (!Object.keys(mine).length) delete next[ownerId];
  return next;
}

/** Комплект из того, что надето сейчас (одежда по слотам). Возвращает новый объект комплектов. */
export function outfitSaveWorn(items, outfits, ownerId, outfitId) {
  if (!OUTFIT_IDS.includes(outfitId)) return outfits ?? {};
  const next = JSON.parse(JSON.stringify(outfits ?? {}));
  const map = {};
  for (const i of items) if (i.ownerId === ownerId && i.kind === 'gear' && i.worn && SLOT_IDS.includes(i.slot)) map[i.slot] = i.id;
  const mine = (next[ownerId] ??= {});
  if (Object.keys(map).length) mine[outfitId] = map; else delete mine[outfitId];
  if (!Object.keys(mine).length) delete next[ownerId];
  return next;
}

/** Как комплект сидит на человеке: { total (вещей в комплекте), worn (из них надето), full (надет целиком), slots: { слот: вещь } }. */
export function outfitState(items, outfits, ownerId, outfitId) {
  const map = outfits?.[ownerId]?.[outfitId] ?? {};
  const slots = {};
  for (const [slot, id] of Object.entries(map)) { const it = items.find(i => i.id === id && i.ownerId === ownerId); if (it) slots[slot] = it; }
  const list = Object.values(slots);
  const worn = list.filter(i => i.worn).length;
  return { total: list.length, worn, full: list.length > 0 && worn === list.length, slots };
}

/** Надевает комплект: каждая вещь по правилам wear(). Возвращает { ok, items, touched, before, reason } для отмены, как wear(). */
export function wearOutfit(items, outfits, ownerId, outfitId) {
  const st = outfitState(items, outfits, ownerId, outfitId);
  if (!st.total) return { ok: false, reason: 'комплект пуст или таких вещей уже нет', items };
  if (st.full) return { ok: false, reason: 'уже надето', items };
  let cur = items;
  const touched = [];
  for (const it of Object.values(st.slots)) {
    if (it.worn) continue;
    const r = wear(cur, it.id);
    if (r.ok) { cur = r.items; touched.push(...r.touched); }
  }
  const ids = [...new Set(touched)];
  return { ok: ids.length > 0, items: cur, touched: ids, before: snap(items, ids) };
}

// ---------- виды одежды ----------
/**
 * Вид одежды (поле ctype у вещи kind 'gear'): латы, кольчуга, мантия, плащ, перчатки, сапоги… Даёт значок и подпись.
 * Вид привязан к слоту: латы это «тело», сапоги это «обувь». Если вид не задан, он угадывается по названию среди видов слота вещи.
 * Отдельного слота для ног нет: «тело» это целый наряд (верх и штаны). Старые вещи со слотом «ноги» при загрузке становятся вещами «тела».
 */
export const CLOTHING_KINDS = Object.freeze([
  { id: 'plate', ru: 'Латы', hint: 'тяжёлая броня', slot: 'body', re: /(?<![а-яё])латы(?![а-яё])|латн|нагрудник|кирас|плитн|plate|cuirass|breastplate/i },
  { id: 'mail', ru: 'Кольчуга', hint: 'средняя броня', slot: 'body', re: /кольчуг|хауберк|чешуйч|mail|hauberk/i },
  { id: 'leather', ru: 'Кожаный доспех', hint: 'лёгкая броня', slot: 'body', re: /кожан|стёган|стеган|бригантин|leather|gambeson|jerkin/i },
  { id: 'robe', ru: 'Мантия', hint: 'одежда заклинателя', slot: 'body', re: /мантия|ряса|роба|балахон|халат|robe|cassock/i },
  { id: 'cloth', ru: 'Простая одежда', hint: 'ткань', slot: 'body', re: /ткан|рубах|рубаш|туник|блуз|платье|сарафан|cloth|shirt|tunic|dress|blouse/i },
  { id: 'camp', ru: 'Лагерная одежда', hint: 'облик из десяти', slot: 'body', re: /лагерн|привал|ночн\S*\s+одежд|(?<![a-z])camp(?![a-z])/i },
  { id: 'doublet', ru: 'Камзол', hint: 'парадная одежда', slot: 'body', re: /камзол|дублет|жакет|сюртук|кафтан|doublet|jacket|coat/i },
  { id: 'helmet', ru: 'Шлем', hint: 'металлический', slot: 'head', re: /шлем|каска|шишак|шапель|helm|helmet/i },
  { id: 'cap', ru: 'Кожаная шапка', hint: 'кожаный шлем, шапка', slot: 'head', re: /кожан\S*\s+(шлем|шапк)|шлем-?шапк|шапк|ушанк|(?<![a-z])cap(?![a-z])/i },
  { id: 'hat', ru: 'Шляпа', hint: 'шляпы, колпаки', slot: 'head', re: /шляп|колпак|берет|(?<![a-z])hat(?![a-z])|beret|fedora/i },
  { id: 'hood', ru: 'Капюшон', hint: '', slot: 'head', re: /капюшон|клобук|cowl|(?<![a-z])hood(?![a-z])/i },
  { id: 'cloak', ru: 'Плащ', hint: '', slot: 'cloak', re: /плащ|накидк|пелерин|cloak|cape/i },
  { id: 'gloves', ru: 'Перчатки', hint: '', slot: 'hands', re: /перчатк|митенк|glove|mitten/i },
  { id: 'bracers', ru: 'Наручи', hint: '', slot: 'hands', re: /наруч|bracer|vambrace/i },
  { id: 'gauntlets', ru: 'Латные рукавицы', hint: '', slot: 'hands', re: /рукавиц|латн\S*\s+перчатк|gauntlet/i },
  { id: 'sabatons', ru: 'Сабатоны', hint: 'латные сапоги', slot: 'feet', re: /сабатон|латн\S*\s+(сапог|ботинк)|sabaton|sabatons/i },
  { id: 'boots', ru: 'Сапоги', hint: '', slot: 'feet', re: /сапог|ботфорт|(?<![а-яё])боты(?![а-яё])|boot/i },
  { id: 'shoes', ru: 'Ботинки', hint: '', slot: 'feet', re: /ботинк|туфл|башмак|сандал|shoe|sandal/i },
]);
export const CLOTHING_IDS = Object.freeze(CLOTHING_KINDS.map(k => k.id));
export const clothingRu = id => CLOTHING_KINDS.find(k => k.id === id)?.ru ?? '';
/** Виды одежды для слота (для выбора в карточке вещи). */
export const clothingForSlot = slot => CLOTHING_KINDS.filter(k => k.slot === slot);
// при угадывании по названию специфичное раньше общего: рукавицы и сабатоны раньше перчаток и сапог, латы раньше ткани
const GUESS_ORDER = ['cap', 'helmet', 'hood', 'hat', 'gauntlets', 'bracers', 'gloves', 'sabatons', 'shoes', 'boots', 'cloak', 'camp', 'robe', 'doublet', 'mail', 'plate', 'leather', 'cloth'];
/** Вид одежды вещи: сохранённый ctype (если он подходит слоту), иначе по названию среди видов её слота, иначе ''. */
export function clothingKindOf(item) {
  if (item?.kind !== 'gear') return '';
  const kind = CLOTHING_KINDS.find(k => k.id === item.ctype);
  if (kind && kind.slot === item.slot) return kind.id;
  const name = String(item.name ?? '');
  return GUESS_ORDER.find(id => { const k = CLOTHING_KINDS.find(x => x.id === id); return k.slot === item.slot && k.re.test(name); }) ?? '';
}

/** Десять обликов лагерной одежды (вид 'camp'); номер хранится у вещи в поле look (1..10), значок assets/clothes/camp<N>.png. */
export const CAMP_LOOKS = Object.freeze([
  'песочная безрукавка со шнуровкой и широким поясом', 'кремовая рубаха с тёмными манжетами', 'потёртые кожаные штаны с заплатами',
  'оливковые приталенные штаны, чёрный верх', 'рыже-коричневая жилетка с зелёной вставкой', 'зелёный жилет с рыжим кантом',
  'серебристо-серый жилет с листовым узором', 'сланцево-серый топ со шнуровкой', 'белая рубашка с жабо и чёрные штаны', 'индиго с вышивкой и поясом с заклёпками',
]);
export const campLookOf = item => { const n = Math.trunc(Number(item?.look)); return n >= 1 && n <= CAMP_LOOKS.length ? n : 1; };
