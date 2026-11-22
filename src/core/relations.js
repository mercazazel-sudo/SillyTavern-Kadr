/**
 * Отношения: направленные линии «А к Б» с 15 шкалами (−100..100), стадией, воспоминаниями, напряжениями,
 * факторами роста и конечной точкой; треугольники и общие воспоминания.
 * Модель совместима с данными Кулис (идея и истоки: ApprovalRoster), поэтому старые чаты переезжают без потерь.
 * Чистая логика: к Таверне не обращается. Рассказчику уходят только линии тех, кто сейчас в кадре.
 */
import { normalizeItem } from './inventory.js';

export const SCALES = Object.freeze([
  { id: 'affection', ru: 'Привязанность' }, { id: 'love', ru: 'Любовь' }, { id: 'family', ru: 'Семейная любовь' },
  { id: 'trust', ru: 'Доверие' }, { id: 'respect', ru: 'Уважение' }, { id: 'attraction', ru: 'Влечение' },
  { id: 'friendship', ru: 'Дружба' }, { id: 'fear', ru: 'Страх' }, { id: 'resentment', ru: 'Обида' },
  { id: 'hostility', ru: 'Враждебность' }, { id: 'jealousy', ru: 'Ревность' }, { id: 'dependency', ru: 'Зависимость' },
  { id: 'approval', ru: 'Одобрение' }, { id: 'guilt', ru: 'Вина' }, { id: 'anxiety', ru: 'Тревога' },
]);
export const SCALE_IDS = SCALES.map(s => s.id);
/**
 * Десять шкал, которые предлагает окно и Архивариус. Четыре основные всегда на виду, остальные добавляются кнопкой «+».
 * Остальные пять (привязанность, семейная любовь, обида, вина, тревога) по-прежнему допустимы в данных и в чатах Кулис:
 * если в линии они уже заполнены, окно их показывает, но заново не предлагает.
 */
export const MAIN_SCALES = Object.freeze(['approval', 'hostility', 'friendship', 'love']);
export const UI_SCALES = Object.freeze(['approval', 'hostility', 'friendship', 'love', 'trust', 'respect', 'attraction', 'fear', 'jealousy', 'dependency']);
/** Тёмные шкалы: рост значения это плохо; в окне подсвечиваются иначе. */
export const DARK_SCALES = new Set(['fear', 'resentment', 'hostility', 'jealousy', 'guilt', 'anxiety']);
export const LIMITS = Object.freeze({ people: 150, lines: 400, records: 30, factors: 20, shared: 60, triangles: 30, headcanons: 120, log: 150 });

/** Короткие подсказки по уровню шкалы: модель действует по смыслу, а не читает голые числа. */
const HINTS = {
  love: { high: 'любит всем сердцем, предан', mid: 'влюблён, чувство взаимное или нет', low: 'теплеет, интерес к человеку', neg: 'любовь прошла' },
  family: { high: 'как с родным, ближе семьи', mid: 'держится по-родственному, оберегает', low: 'начинает относиться как к своему', neg: 'держится как с посторонним' },
  attraction: { high: 'жгучее желание, трудно держать себя в руках', mid: 'тянет физически, замечает каждое движение', low: 'приятно находиться близко', neg: 'близость неприятна' },
  affection: { high: 'человек стал дорог', mid: 'привязывается', low: 'нравится', neg: 'всё равно' },
  trust: { high: 'принимает слова за правду, делится секретами', mid: 'слушает всерьёз', low: 'пробует положиться', neg: 'ждёт подвоха' },
  friendship: { high: 'близкий друг, свой', mid: 'по-дружески тепло', low: 'приятель', neg: 'сторонится' },
  respect: { high: 'смотрит снизу вверх', mid: 'считается с ним', low: 'признаёт его силу', neg: 'не ставит ни во что' },
  fear: { high: 'страшно, старается не попадаться на глаза', mid: 'держится настороже', low: 'неуютно рядом', neg: 'рядом спокойно и безопасно' },
  resentment: { high: 'давняя горькая обида', mid: 'припоминает, копит счёт', low: 'осадок после ссоры', neg: '' },
  hostility: { high: 'готов к открытой схватке', mid: 'язвит, перечит', low: 'недолюбливает', neg: '' },
  jealousy: { high: 'ревность до одержимости', mid: 'следит за соперником, ревнует к вниманию', low: 'неспокойно за своё место', neg: '' },
  dependency: { high: 'без этого человека не мыслит себя', mid: 'во всём ищет его опоры', low: 'тянется по привычке', neg: '' },
  approval: { high: 'горячо поддерживает всё, что тот делает', mid: 'считает его выбор верным', low: 'скорее согласен', neg: 'осуждает его поступки' },
  anxiety: { high: 'не находит покоя из-за человека', mid: 'переживает за него', low: 'слегка тревожится', neg: 'с ним спокойно' },
  guilt: { high: 'совесть гложет перед этим человеком', mid: 'чувствует вину, готов загладить', low: 'неловко за прошлое', neg: '' },
};
/** Подсказка к значению шкалы; у «тёмных» шкал с пустым neg отрицательное значение подсказки не даёт. */
export function describeScale(id, value) {
  const hints = HINTS[id];
  const n = Number(value) || 0;
  if (!hints) return '';
  const magnitude = Math.abs(n);
  if (magnitude < 30) return magnitude >= 10 && (n > 0 || hints.neg) ? `(${n < 0 ? hints.neg : hints.low})` : '';
  const hint = magnitude >= 65 ? hints.high : hints.mid;
  return n < 0 ? (hints.neg ? `(${hints.neg})` : '') : (hint ? `(${hint})` : '');
}

export const RULE = 'a feeling belongs to the named character and shows in behaviour (posture, word choice, who speaks first, subtext) only while that character is in the scene and it suits the moment, not in every reply; read the levels as strong from 65, clear from 30, faint from 10, anything not listed is neutral; bad feelings carry as much weight as good ones: do not soften or settle them quickly and do not turn a quarrel into closeness unless the story gives a reason; never push a bond forward yourself (no sudden confessions, truces or trust) and never skip a stage; grow[] on A>B lists what moves A toward B, it explains reactions and is not a plan; endpoint is a far direction of that single directed line, do not hurry toward it; headcanon lines are settled facts about how a pair behaves (habits, jokes, unspoken rules): treat them as true background, let them colour a scene when they fit, never quote them; never show these numbers';

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clipKeep = (value, max) => String(value ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max);   // факторы Кулис многострочные
const clamp100 = v => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));
const id24 = v => clip(v, 64);

export const emptyRelations = () => ({ people: [], lines: [], shared: [], triangles: [], headcanons: [], log: [], seen: {} });

function normRecords(raw, limit = LIMITS.records) {
  const out = [], seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    const text = clip(r?.text, 400), id = id24(r?.id);
    if (!text || !id || seen.has(id) || out.length >= limit) continue;
    seen.add(id);
    out.push({ id, text, intensity: Math.min(Math.max(Math.round(Number(r.intensity) || 3), 1), 5), pinned: r.pinned === true, disabled: r.disabled === true });
  }
  return out;
}

export function normalizeRelations(raw) {
  const base = emptyRelations();
  if (!raw || typeof raw !== 'object') return base;
  const people = [], seenP = new Set();
  for (const p of Array.isArray(raw.people) ? raw.people : []) {
    const id = id24(p?.id), name = clip(p?.name, 80);
    if (!id || !name || seenP.has(id) || people.length >= LIMITS.people) continue;
    seenP.add(id);
    people.push({ id, name, aliases: (Array.isArray(p.aliases) ? p.aliases : []).map(a => clip(a, 80)).filter(Boolean).slice(0, 10) });
  }
  const lines = [], seenL = new Set(), pairs = new Set();
  for (const l of Array.isArray(raw.lines) ? raw.lines : []) {
    const id = id24(l?.id), from = id24(l?.from), to = id24(l?.to);
    const pair = `${from}>${to}`;
    if (!id || !from || !to || from === to || seenL.has(id) || pairs.has(pair) || lines.length >= LIMITS.lines) continue;
    seenL.add(id); pairs.add(pair);
    const scales = {};
    for (const sid of SCALE_IDS) { const v = clamp100(l.scales?.[sid]); if (v !== 0) scales[sid] = v; }
    const factors = [], seenF = new Set();
    for (const f of Array.isArray(l.factors) ? l.factors : []) {
      const text = clipKeep(f?.text, 700);
      const key = `${f?.scaleId}|${f?.direction}|${text}`;
      if (!text || !SCALE_IDS.includes(f?.scaleId) || seenF.has(key) || factors.length >= LIMITS.factors) continue;
      seenF.add(key);
      factors.push({ scaleId: f.scaleId, direction: f.direction === 'down' ? 'down' : 'up', text });
    }
    lines.push({
      id, from, to, scales, hidden: (Array.isArray(l.hidden) ? l.hidden : []).filter(s => SCALE_IDS.includes(s)),
      stage: clip(l.stage, 40), goal: clipKeep(l.goal, 600), memories: normRecords(l.memories), tensions: normRecords(l.tensions), factors,
    });
  }
  const shared = [], seenS = new Set();
  for (const r of Array.isArray(raw.shared) ? raw.shared : []) {
    const id = id24(r?.id), text = clip(r?.text, 400);
    if (!id || !text || seenS.has(id) || shared.length >= LIMITS.shared) continue;
    seenS.add(id);
    shared.push({ id, kind: r.kind === 'tension' ? 'tension' : 'memory', text, intensity: Math.min(Math.max(Math.round(Number(r.intensity) || 3), 1), 5), pinned: r.pinned === true, disabled: r.disabled === true, who: (Array.isArray(r.who) ? r.who : []).map(id24).filter(Boolean).slice(0, 12) });
  }
  const triangles = [], seenT = new Set();
  for (const t of Array.isArray(raw.triangles) ? raw.triangles : []) {
    const id = id24(t?.id), c = id24(t?.centerId), a = id24(t?.firstId), b = id24(t?.secondId);
    if (!id || !c || !a || !b || seenT.has(id) || triangles.length >= LIMITS.triangles) continue;
    seenT.add(id);
    triangles.push({ id, name: clip(t.name, 80), centerId: c, firstId: a, secondId: b, goal: clipKeep(t.goal, 600), resolved: t.resolved === true });
  }
  // хедканоны: устоявшиеся факты о паре (привычки, правила без слов); пара не зависит от порядка имён
  const headcanons = [], seenH = new Set();
  for (const h of Array.isArray(raw.headcanons) ? raw.headcanons : []) {
    const id = id24(h?.id), text = clip(h?.text, 300);
    const [a, b] = String(h?.pair ?? '').split('|');
    if (!id || !text || !a || !b || a === b || seenH.has(id) || headcanons.length >= LIMITS.headcanons) continue;
    seenH.add(id);
    headcanons.push({ id, pair: [a, b].sort().join('|'), text, enabled: h.enabled !== false });
  }
  // журнал автоматических изменений: по нему их можно отменить и откатить вместе с ответом (свайп, правка, удаление)
  const log = [], seenLog = new Set();
  for (const e of Array.isArray(raw.log) ? raw.log : []) {
    const id = id24(e?.id), at = Math.trunc(Number(e?.at));
    const kind = e?.kind === 'cast' ? 'cast' : e?.kind === 'rel' ? 'rel' : e?.kind === 'item' ? 'item' : e?.kind === 'body' ? 'body' : e?.kind === 'place' ? 'place' : e?.kind === 'know' ? 'know' : e?.kind === 'moment' ? 'moment' : e?.kind === 'quest' ? 'quest' : '';
    if (!id || !kind || !Number.isFinite(at) || at < 0 || seenLog.has(id)) continue;
    seenLog.add(id);
    const item = { id, at, kind, label: clip(e.label, 300) };
    if (kind === 'moment') {
      const sid = id24(e.sharedId);
      if (!sid) continue;
      const rec = e.removed && typeof e.removed === 'object' && id24(e.removed.id) ? { id: id24(e.removed.id), kind: e.removed.kind === 'tension' ? 'tension' : 'memory', text: clip(e.removed.text, 400), intensity: Math.min(Math.max(Math.round(Number(e.removed.intensity) || 3), 1), 5), pinned: false, disabled: e.removed.disabled === true, who: (e.removed.who ?? []).map(id24).filter(Boolean).slice(0, 12) } : null;
      Object.assign(item, { sharedId: sid, removed: rec });
    } else if (kind === 'quest') {
      const qid = id24(e.questId);
      if (!qid) continue;
      Object.assign(item, { questId: qid, entryId: id24(e.entryId), leadId: id24(e.leadId), prevState: ['open', 'work', 'done', 'dead'].includes(e.prevState) ? e.prevState : '', prevNote: clip(e.prevNote, 300) });
    } else if (kind === 'know') {
      const ids = a => (Array.isArray(a) ? a : []).map(id24).filter(Boolean).slice(0, 8);
      const meet = {};
      for (const [k, v] of Object.entries(e.meet && typeof e.meet === 'object' ? e.meet : {}).slice(0, 8)) meet[clip(k, 140)] = ['known', 'seen', 'strangers'].includes(v) ? v : null;
      const item2 = { events: ids(e.events), learned: ids(e.learned), deaths: ids(e.deaths), meet };
      // журнал наблюдений: запись, куда дописали строку (added: дописанная строка для отката; prev: прежний текст в старых записях отката;
      // created: запись создана этим ответом)
      if (e.watch && typeof e.watch === 'object' && id24(e.watch.eventId)) {
        const w = { eventId: id24(e.watch.eventId), created: Boolean(e.watch.created) };
        if (typeof e.watch.added === 'string') w.added = e.watch.added.slice(0, 1000);
        else w.prev = String(e.watch.prev ?? '').slice(0, 1500);
        item2.watch = w;
      }
      if (!item2.events.length && !item2.learned.length && !item2.deaths.length && !Object.keys(meet).length && !item2.watch) continue;
      Object.assign(item, item2);
    } else if (kind === 'place') {
      const b = e.before && typeof e.before === 'object' ? e.before : {};
      const over = {};
      for (const [pid, o] of Object.entries(b.over && typeof b.over === 'object' ? b.over : {}).slice(0, 12)) over[id24(pid)] = o && typeof o === 'object' ? { traits: (o.traits ?? []).map(x => clip(x, 160)).slice(0, 14), notes: (o.notes ?? []).map(x => clip(x, 160)).slice(0, 8) } : null;
      Object.assign(item, { before: { current: id24(b.current), place: clip(b.place, 400), over }, addedNodeIds: (Array.isArray(e.addedNodeIds) ? e.addedNodeIds : []).map(id24).filter(Boolean).slice(0, 6) });
    } else if (kind === 'body') {
      if (!id24(e.personId)) continue;
      const add = { conds: (e.add?.conds ?? []).map(id24).filter(Boolean).slice(0, 8), wounds: (e.add?.wounds ?? []).map(id24).filter(Boolean).slice(0, 8) };
      const removed = (Array.isArray(e.removed) ? e.removed : []).map(c => ({ id: id24(c?.id), t: clip(c?.t, 120), until: c?.until && typeof c.until === 'object' ? { year: Math.trunc(Number(c.until.year)) || 0, doy: Math.trunc(Number(c.until.doy)) || 1 } : null })).filter(c => c.id && c.t).slice(0, 8);
      if (!add.conds.length && !add.wounds.length && !removed.length && !e.moodSet && !e.arousalSet) continue;
      Object.assign(item, { personId: id24(e.personId), add, removed });
      if (e.moodSet) { item.moodSet = true; item.prevMood = e.prevMood && typeof e.prevMood === 'object' ? { id: clip(e.prevMood.id, 12), lvl: Math.min(Math.max(Math.trunc(Number(e.prevMood.lvl)) || 2, 1), 3) } : null; }
      if (e.arousalSet) { item.arousalSet = true; item.prevArousal = Math.min(Math.max(Math.trunc(Number(e.prevArousal)) || 0, 0), 4); }
      if (Number.isFinite(Number(e.prevTier))) item.prevTier = Math.min(Math.max(Math.trunc(Number(e.prevTier)), 0), 4);
    } else if (kind === 'item') {
      const touched = (Array.isArray(e.touched) ? e.touched : []).map(id24).filter(Boolean).slice(0, 6);
      if (!touched.length) continue;
      Object.assign(item, { op: ['gain', 'lose', 'give', 'wear'].includes(e.op) ? e.op : 'gain', touched, before: (Array.isArray(e.before) ? e.before : []).map(normalizeItem).filter(Boolean).slice(0, 6) });
    } else if (kind === 'rel') {
      if (!SCALE_IDS.includes(e.scale) || !id24(e.fromId) || !id24(e.toId)) continue;
      Object.assign(item, { fromId: id24(e.fromId), toId: id24(e.toId), scale: e.scale, delta: Math.round(Number(e.delta) || 0) });
      if (e.memoryId) item.memoryId = id24(e.memoryId);
      if (e.lineCreated) item.lineCreated = true;
    } else {
      if (!id24(e.personId)) continue;
      Object.assign(item, { personId: id24(e.personId), wasPresent: e.wasPresent === true, joined: e.joined === true });
      if (e.addedToCast) item.addedToCast = true;
      if (e.createdPerson) item.createdPerson = true;
    }
    log.push(item);
  }
  // слова с заглавной буквы, которые Архивариус уже проверял и не признал героями: сколько раз (после двух раз не беспокоим)
  const seen = {};
  for (const [w, n] of Object.entries(raw.seen && typeof raw.seen === 'object' ? raw.seen : {}).slice(-300)) { const k = clip(w, 40); if (k) seen[k] = Math.min(Math.max(Math.trunc(Number(n)) || 1, 1), 9); }
  return { people, lines, shared, triangles, headcanons, log: log.slice(-LIMITS.log), seen };
}

/** Имя человека: сперва участники сцены, потом реестр отношений. */
export function nameOf(id, cast, rel) {
  return cast.find(p => p.id === id)?.name ?? rel.people.find(p => p.id === id)?.name ?? '';
}
/** Все известные люди: участники сцены и реестр отношений, без повторов по id. */
export function allPeople(cast, rel) {
  const out = cast.map(p => ({ id: p.id, name: p.name, persona: p.persona, present: p.present, aliases: rel.people.find(x => x.id === p.id)?.aliases ?? [] }));
  for (const p of rel.people) if (!out.some(x => x.id === p.id)) out.push({ id: p.id, name: p.name, persona: false, present: false, aliases: p.aliases ?? [] });
  return out;
}

const weight = (line, personaId) => Object.entries(line.scales).filter(([id]) => !line.hidden.includes(id)).reduce((s, [, v]) => s + Math.abs(v), 0) + (personaId && line.to === personaId ? 50 : 0);

function fit(lines, limit) {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost <= limit) { kept.push(line); used += cost; continue; }
    if (!kept.length && limit - used > 80) { const s = `${line.slice(0, limit - used - 2)}…`; kept.push(s); used += s.length + 1; }
  }
  return { kept, used };
}
const recentItems = (items, limit) => {
  const live = items.filter(i => !i.disabled);
  const fresh = new Set(limit > 0 ? live.filter(i => !i.pinned).slice(-limit) : []);
  return live.filter(i => i.pinned || fresh.has(i)).map(i => i.text).join(' | ');
};

/**
 * Строки для рассказчика. Только присутствующие: линия идёт, если и тот, кто чувствует, и тот, к кому, сейчас в кадре.
 * Линии самой персоны не отправляются (её чувства решает игрок). Сильные чувства первыми, лишнее срезается бюджетом.
 */
export function relationLines(rel, cast, { maxChars = 2500, memoryLimit = 3, tensionLimit = 3, sharedLimit = 5, headcanonLimit = 6, factors = true, dead = [] } = {}) {
  const present = new Set(cast.filter(p => p.present).map(p => p.id));
  const persona = cast.find(p => p.persona)?.id ?? '';
  const name = id => nameOf(id, cast, rel) || id;
  const gone = new Set(dead);
  const chosen = rel.lines.filter(l => l.from !== persona && !gone.has(l.from) && present.has(l.from) && present.has(l.to))
    .sort((a, b) => weight(b, persona) - weight(a, persona) || a.id.localeCompare(b.id));
  const lines = chosen.map(l => {
    const scales = Object.entries(l.scales).filter(([id]) => !l.hidden.includes(id)).map(([id, v]) => `${id}=${v}${describeScale(id, v)}`).join(',');
    const fields = [`${name(l.from)}>${name(l.to)}`, scales];
    if (l.stage) fields.push(`stage=${l.stage}`);
    const mem = recentItems(l.memories, memoryLimit), ten = recentItems(l.tensions, tensionLimit);
    if (mem) fields.push(`mem=${mem}`);
    if (ten) fields.push(`ten=${ten}`);
    if (factors) {
      const grow = l.factors.slice(0, 6).map(f => `${f.direction === 'down' ? '-' : '+'}${f.scaleId}: ${clip(f.text, 140)}`).join(' | ');
      if (grow) fields.push(`grow[${grow}]`);
      if (l.goal) fields.push(`endpoint=${clip(l.goal, 400)}`);
    }
    return fields.filter(Boolean).join(';');
  });
  const rules = [];
  for (const t of rel.triangles) {
    if (t.resolved) continue;
    if ([t.centerId, t.firstId, t.secondId].filter(id => present.has(id)).length < 2) continue;
    const base = `triangle center=${name(t.centerId)}; others=${name(t.firstId)},${name(t.secondId)}`;
    rules.push(t.goal ? `${base}; far goal of this pair: ${clip(t.goal, 400)} (a direction only, not an assignment for this reply: no rushing, no skipped stages, no forcing)` : `${base}; grouping only, do not invent love or rivalry`);
  }
  // общие записи: закреплённые и самые сильные и свежие (порядок в списке = порядок событий), по сюжету
  const pool = rel.shared.filter(r => !r.disabled && r.who.length >= 2 && r.who.every(id => present.has(id)));
  const score = (r, i) => (r.pinned ? 100 : 0) + r.intensity + 4 * (pool.length > 1 ? i / (pool.length - 1) : 1);
  const top = new Set(pool.map((r, i) => ({ r, s: score(r, i) })).sort((a, b) => b.s - a.s).slice(0, sharedLimit).map(x => x.r));
  const shared = pool.filter(r => top.has(r))
    .map(r => `shared-${r.kind === 'tension' ? 'tension' : 'memory'}[${r.who.map(name).join(',')}]=${clip(r.text, 240)}`);
  const habits = rel.headcanons.filter(h => h.enabled && h.pair.split('|').every(id => present.has(id)))
    .slice(-headcanonLimit).map(h => `headcanon[${h.pair.split('|').map(name).join(' & ')}]: ${clip(h.text, 240)}`);
  // хедканоны получают свою долю (до 30%): они короткие и держат характер пары, их нельзя вытеснять числами
  const total = Math.max(0, maxChars);
  const hc = fit(habits, Math.floor(total * 0.3));
  const budget = total - hc.used;
  const r = fit(rules, budget);
  const l = fit(lines, Math.floor((budget - r.used) * 0.8));
  const s = fit(shared, budget - r.used - l.used);
  const rest = fit(lines.filter(x => !l.kept.includes(x)), budget - r.used - l.used - s.used);
  return [...r.kept, ...lines.filter(x => l.kept.includes(x) || rest.kept.includes(x)), ...hc.kept, ...s.kept];
}

export const lineKey = (from, to) => `${from}>${to}`;
