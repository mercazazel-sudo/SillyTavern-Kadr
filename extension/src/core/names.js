/**
 * Имена на двух алфавитах: в анкете «Arvenn Velúrin», в рассказе «Арвенн». Без этого Архивариус считал их разными людьми
 * и заводил двойника. Здесь имя приводится к латинской записи (транслитерация), и два имени считаются одним, если у них
 * совпало целое слово (не короче четырёх знаков). Чистые функции.
 */
const CYR = Object.fromEntries(
  'а=a б=b в=v г=g д=d е=e ё=e ж=zh з=z и=i й=y к=k л=l м=m н=n о=o п=p р=r с=s т=t у=u ф=f х=h ц=ts ч=ch ш=sh щ=sch ъ= ы=y ь= э=e ю=yu я=ya'.split(' ').map(pair => [pair[0], pair.slice(2)]),
);

/** Имя латиницей: без регистра, диакритики, апострофов и знаков; кириллица транслитерируется. */
export function latinKey(name) {
  const plain = String(name ?? '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  return plain.replace(/[а-яё]/g, ch => CYR[ch] ?? '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
const words = key => key.split(' ').filter(w => w.length >= 4);

/** Совпали ли имена между алфавитами: у них есть общее слово (после транслитерации), длиной не меньше четырёх знаков. */
export function sameNameAcrossScripts(a, b) {
  const wa = words(latinKey(a)), wb = new Set(words(latinKey(b)));
  return wa.some(w => wb.has(w));
}

/** Человек из списка по имени или псевдониму между алфавитами: [{ name, aliases }] → первый подходящий или undefined. */
export function findAcrossScripts(people, name) {
  return people.find(p => [p.name, ...(p.aliases ?? [])].some(a => sameNameAcrossScripts(a, name)));
}
