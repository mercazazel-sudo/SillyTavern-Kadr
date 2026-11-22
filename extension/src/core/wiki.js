/**
 * Анкета как статья на вики: вступление, таблица фактов (инфобокс), разделы статьи, служебные записи и скрытый
 * модуль «Романтика и NSFW». Это только вид для чтения: рассказчику по-прежнему уходят записи разделов (их текст
 * и правила не меняются). Факты и вступление берутся из текста анкеты без модели; правятся руками и хранятся в card.wiki.
 * Чистая логика: Таверны и DOM не знает.
 */
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export const WIKI_LIMITS = Object.freeze({ tagline: 120, lead: 700, facts: 16, key: 40, value: 160 });

// пары «слово в анкете → подпись»; регистр не важен
const FACT_KEYS = [
  ['full name', 'Полное имя'], ['name', 'Имя'], ['race', 'Раса'], ['species', 'Раса'], ['sex', 'Пол'], ['gender', 'Пол'], ['age', 'Возраст'],
  ['height', 'Рост'], ['weight', 'Вес'], ['class', 'Класс'], ['alignment', 'Мировоззрение'], ['occupation', 'Занятие'], ['profession', 'Занятие'],
  ['eyes', 'Глаза'], ['hair', 'Орсосы'], ['build', 'Телосложение'], ['birthplace', 'Родина'], ['origin', 'Происхождение'], ['faction', 'Фракция'],
  ['полное имя', 'Полное имя'], ['имя', 'Имя'], ['раса', 'Раса'], ['пол', 'Пол'], ['возраст', 'Возраст'], ['рост', 'Рост'], ['вес', 'Вес'],
  ['класс', 'Класс'], ['мировоззрение', 'Мировоззрение'], ['профессия', 'Занятие'], ['занятие', 'Занятие'], ['глаза', 'Глаза'], ['волосы', 'Орсосы'],
  ['телосложение', 'Телосложение'], ['родина', 'Родина'], ['происхождение', 'Происхождение'], ['фракция', 'Фракция'],
];
const LABEL = new Map(FACT_KEYS);
const KEY_RE = new RegExp(`(?<![\\p{L}])(${FACT_KEYS.map(([k]) => k.replace(/ /g, '\\s+')).sort((a, b) => b.length - a.length).join('|')})\\s*[:：]\\s*`, 'giu');
const SEX = { male: 'Мужской', man: 'Мужской', female: 'Женский', woman: 'Женский', мужской: 'Мужской', женский: 'Женский', мужчина: 'Мужской', женщина: 'Женский' };

/** Факты из текста вида «Name: …  Race: …  Age: …» (в строку или в столбик): [{ k: 'Раса', v: 'Drow (dark elf)' }]. */
export function extractFacts(text, max = WIKI_LIMITS.facts) {
  const s = String(text ?? '');
  const hits = [];
  let prevOk = false, prevLine = -1;
  for (const m of s.matchAll(KEY_RE)) {
    const lineStart = s.lastIndexOf('\n', m.index) + 1;
    const atStart = /^[\s\-*•]*\**$/u.test(s.slice(lineStart, m.index));
    const ok = atStart || (prevOk && prevLine === lineStart);        // «Name: A Race: B» в одной строке: следующая подпись идёт цепочкой
    prevOk = ok; prevLine = lineStart;
    if (ok) hits.push({ key: m[1].toLowerCase().replace(/\s+/g, ' '), start: m.index, valueAt: m.index + m[0].length });
  }
  const out = [], seen = new Set();
  hits.forEach((h, i) => {
    const label = LABEL.get(h.key);
    if (!label || seen.has(label)) return;
    const end = Math.min(...[hits[i + 1]?.start ?? Infinity, s.indexOf('\n', h.valueAt) < 0 ? Infinity : s.indexOf('\n', h.valueAt), s.length]);
    let v = clip(s.slice(h.valueAt, end).replace(/[;,.\s]+$/g, ''), WIKI_LIMITS.value);
    if (!v) return;
    if (label === 'Пол') v = SEX[v.toLowerCase()] ?? v;
    seen.add(label);
    out.push({ k: label, v });
  });
  return out.slice(0, max);
}

/** Первые два предложения описания без строк с фактами: вступление статьи, пока своего нет. */
export function leadFromText(text, max = 320) {
  // без строк с фактами и без коротких заголовков без точки в конце («Arvenn Velúrin»)
  const plain = String(text ?? '').replace(/\*\*|__/g, '').split('\n').filter(l => { KEY_RE.lastIndex = 0; const s = l.trim(); return s && !KEY_RE.test(l) && !(s.length < 45 && !/[.!?…]$/.test(s)); }).join(' ');
  const sentences = plain.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+(\s|$)/g) ?? [];
  let out = '';
  for (const part of sentences) { if ((out + part).length > max) break; out += part; if (out.split(/[.!?…]/).length > 2) break; }
  return clip(out || plain, max);
}

export const INTIMATE_RE = /romance|романт|nsfw|интим|intimate|эрот|erotic|\bsex\b/i;
export const SERVICE_RE = /^\s*(relationships?|connections|связи|отношени)/i;

/** Делит разделы: статья, служебные записи (в статье не показываются) и интимные (в свёрнутом модуле). */
export function splitSections(sections) {
  const out = { article: [], service: [], intimate: [] };
  for (const s of sections ?? []) {
    const t = `${s.title} ${s.kind === 'other' ? '' : s.kind}`;
    if (INTIMATE_RE.test(s.title) || INTIMATE_RE.test(t)) out.intimate.push(s);
    else if (SERVICE_RE.test(s.title)) out.service.push(s);
    else out.article.push(s);
  }
  return out;
}

export function normalizeWiki(raw) {
  const facts = (Array.isArray(raw?.facts) ? raw.facts : []).map(f => ({ k: clip(f?.k, WIKI_LIMITS.key), v: clip(f?.v, WIKI_LIMITS.value) })).filter(f => f.k && f.v).slice(0, WIKI_LIMITS.facts);
  return { tagline: clip(raw?.tagline, WIKI_LIMITS.tagline), lead: clip(raw?.lead, WIKI_LIMITS.lead), facts };
}

/** Что показывать в статье: свои значения, а чего нет, то из текста анкеты (структурные пункты, затем строки «Ключ: значение»). */
export function wikiOf(card) {
  const own = normalizeWiki(card?.wiki);
  const secs = (card?.sections ?? []).filter(s => !INTIMATE_RE.test(s.title) && !SERVICE_RE.test(s.title));
  const entries = secs.flatMap(s => parseEntries(s.text).entries);
  const body = (card?.sections ?? []).map(s => s.text).join('\n');
  const auto = [...factsFromEntries(entries), ...extractFacts(body).filter(f => f.k !== 'Имя' && f.k !== 'Полное имя')].filter((f, i, a) => a.findIndex(x => x.k === f.k) === i);
  const first = secs[0]?.text ?? '';
  const lead = leadFromEntries(parseEntries(first).entries) || leadFromText(first);
  return { tagline: own.tagline, lead: own.lead || lead, facts: own.facts.length ? own.facts : auto, derived: { facts: !own.facts.length, lead: !own.lead } };
}

/** Текст раздела для чтения в статье: без строк-фактов (они в таблице справа) и без строки с именем. Рассказчику это не влияет. */
export function articleText(text, name = '') {
  const low = String(name).trim().toLowerCase();
  const start = new RegExp(`^\\s*(${FACT_KEYS.map(([k]) => k.replace(/ /g, '\\s+')).sort((a, b) => b.length - a.length).join('|')})\\s*[:：]`, 'iu');
  return String(text ?? '').split('\n').filter((l, i) => !(i === 0 && low && l.trim().toLowerCase() === low) && !start.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- анкеты со структурой «- **Вопрос:** ответ» (типовой шаблон лорбуков) ----------
const stripMd = s => String(s ?? '').replace(/\*\*|__/g, '').replace(/[ \t]+\n/g, '\n').trim();

/** Текст раздела → { intro, entries: [{ label, value }] }: строки вида «- **Метка:** значение» с продолжением на следующих строках. */
export function parseEntries(text) {
  const head = /^\s*(?:[-*•]\s*)?\*\*(.+?)\*\*\s*[:：]?\s*(.*)$/u;
  const intro = [], entries = [];
  let cur = null;
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const m = head.exec(raw);
    if (m) { cur = { label: m[1].replace(/\s*[:：]\s*$/u, '').trim(), value: m[2].trim() }; entries.push(cur); continue; }
    const s = raw.trim();
    if (!s) continue;
    if (cur) cur.value += `${cur.value ? '\n' : ''}${s}`; else intro.push(s);
  }
  return { intro: stripMd(intro.join('\n')), entries: entries.map(e => ({ label: stripMd(e.label), value: stripMd(e.value) })).filter(e => e.label || e.value) };
}

/** Короткая подпись для длинного вопроса шаблона: до двоеточия и вопросительного знака, не длиннее 56 знаков. */
export function shortLabel(label) {
  let s = String(label ?? '').replace(/[?？]\s*$/u, '').trim();
  const colon = s.indexOf(':');
  if (colon > 8) s = s.slice(0, colon);
  if (s.length > 56) s = `${s.slice(0, s.lastIndexOf(' ', 56) > 20 ? s.lastIndexOf(' ', 56) : 56)}…`;
  return s;
}

const firstSentence = (v, max) => {
  const flat = String(v ?? '').replace(/\s+/g, ' ').trim();
  const m = /^.+?[.!?…](?=\s|$)/u.exec(flat);
  const s = m ? m[0] : flat;
  return s.length > max ? `${s.slice(0, max - 1).replace(/[\s,;:]+\S*$/, '')}…` : s;
};
// «Elf rogue.» -> раса Elf и занятие rogue: раса стоит в начале строки занятия
const RACE_WORDS = '(?:elf|elves|drow|human|dwarf|halfling|gnome|tiefling|dragonborn|orc|goblin|hobgoblin|githyanki|githzerai|genasi|aasimar|tabaxi|vampire|эльф|человек|дварф|полурослик|гном|тифлинг|драконорождённый|орк|гоблин|вампир)';
const RACE_RE = new RegExp(`^((?:(?:high|wood|dark|moon|sun|sea|wild|snow|half|deep|hill|mountain|forest|lightfoot|stout|gray|grey|полу|высший|лесной|тёмный)[ -]?)*${RACE_WORDS})(?![\\p{L}])[\\s,:-]*`, 'iu');
/** { race, rest } из начала строки занятия; race пусто, если расы нет. */
export function splitRace(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  const m = RACE_RE.exec(s);
  if (!m) return { race: '', rest: s };
  const race = m[1].trim().replace(/^./u, c => c.toUpperCase());
  const rest = s.slice(m[0].length).replace(/^[\s,.:;-]+/, '').replace(/[\s.]+$/, '').replace(/^./u, c => c.toUpperCase());
  return { race, rest };
}
const FACT_RULES = [
  [/^(visual and actual )?age\b|^возраст/i, 'Возраст', v => { const s = firstSentence(v, 110); const cut = s.search(/[,:;]/); return cut > 25 && s.length > 60 ? s.slice(0, cut) : s; }],
  [/occupation|role\b|профессия|занятие|роль/i, 'Занятие', v => firstSentence(v, 90)],
  [/height|рост\b/i, 'Рост', v => { const m = /(\d{2,3})\s*(?:cm|см)/i.exec(v); return m ? `${m[1]} см` : ''; }],
];
/** Факты для таблицы справа из структурных пунктов: возраст, занятие, рост. Имя и прочее в таблицу не идёт. */
export function factsFromEntries(entries) {
  const out = [], seen = new Set();
  for (const e of entries) {
    if (/name|alias|имя/i.test(e.label) && !/occupation|role/i.test(e.label)) continue;
    for (const [re, k, fn] of FACT_RULES) {
      if (seen.has(k) || !re.test(e.label)) continue;
      let v = clip(fn(e.value), WIKI_LIMITS.value);
      if (k === 'Занятие') {
        const { race, rest } = splitRace(v);
        if (race && !seen.has('Раса')) { seen.add('Раса'); out.push({ k: 'Раса', v: race }); }
        v = race ? (rest ? `${rest}.` : '') : v;
      }
      if (v) { seen.add(k); out.push({ k, v }); }
      break;
    }
  }
  return out;
}

/** Вступление из структурных пунктов: «Occupation and role», иначе первый пункт, кроме имени. Два предложения, без разметки. */
export function leadFromEntries(entries) {
  const pick = entries.find(e => /occupation|role\b|профессия|занятие|роль/i.test(e.label) && e.value) ?? entries.find(e => e.value && !/name|alias|имя|age|возраст/i.test(e.label));
  return pick ? leadFromText(pick.value) : '';
}
