/**
 * Журнал квестов в духе Baldur's Gate: квест с целью, зацепками (у каждой своя судьба) и лентой записей с игровой датой.
 * Чистая логика, Таверны не знает. Даты записей хранятся как { year, doy } мира, время суток необязательно.
 */
export const STATUSES = Object.freeze(['active', 'paused', 'done', 'failed', 'dropped']);
export const STATUS_RU = Object.freeze({ active: 'идёт', paused: 'отложен', done: 'выполнен', failed: 'провален', dropped: 'брошен' });
export const isOpenStatus = status => status === 'active' || status === 'paused';

export const LEAD_STATES = Object.freeze(['open', 'work', 'done', 'dead']);
export const LEAD_RU = Object.freeze({ open: 'открыта', work: 'в работе', done: 'отработана', dead: 'тупик' });
export const NEXT_LEAD = Object.freeze({ open: 'work', work: 'done', done: 'dead', dead: 'open' });

export const LIMITS = Object.freeze({ quests: 60, leads: 30, entries: 200, title: 120, goal: 400, text: 400, note: 300, who: 8, name: 60, place: 120 });

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (value, fallback) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);
const cleanDate = raw => {
  const year = int(raw?.year, NaN), doy = int(raw?.doy, NaN);
  return Number.isFinite(year) && Number.isFinite(doy) && doy >= 1 ? { year, doy } : null;
};
const cleanId = value => clip(value, 24);

/** Приводит квесты из данных чата к рабочему виду. Отметка «отслеживается» остаётся только у одного (первого). */
export function normalizeQuests(raw) {
  const out = [];
  const seen = new Set();
  let tracked = false;
  for (const q of Array.isArray(raw) ? raw : []) {
    const id = cleanId(q?.id), title = clip(q?.title, LIMITS.title);
    if (!id || !title || seen.has(id) || out.length >= LIMITS.quests) continue;
    seen.add(id);
    const status = STATUSES.includes(q.status) ? q.status : 'active';
    const leadIds = new Set();
    const leads = (Array.isArray(q.leads) ? q.leads : []).map(l => {
      const lid = cleanId(l?.id), text = clip(l?.t, LIMITS.text);
      if (!lid || !text || leadIds.has(lid)) return null;
      leadIds.add(lid);
      return { id: lid, t: text, state: LEAD_STATES.includes(l.state) ? l.state : 'open', note: clip(l?.note, LIMITS.note) };
    }).filter(Boolean).slice(0, LIMITS.leads);
    const entryIds = new Set();
    const entries = (Array.isArray(q.entries) ? q.entries : []).map(e => {
      const eid = cleanId(e?.id), text = clip(e?.t, LIMITS.text);
      if (!eid || !text || entryIds.has(eid)) return null;
      entryIds.add(eid);
      const minutes = int(e?.minutes, NaN);
      return { id: eid, date: cleanDate(e?.date), minutes: Number.isFinite(minutes) && minutes >= 0 && minutes < 1440 ? minutes : null, t: text };
    }).filter(Boolean).slice(-LIMITS.entries);
    const isTracked = q.tracked === true && !tracked && isOpenStatus(status);
    if (isTracked) tracked = true;
    out.push({
      id, title, status, tracked: isTracked, unseen: q.unseen === true,
      place: clip(q.place, LIMITS.place), goal: clip(q.goal, LIMITS.goal),
      who: (Array.isArray(q.who) ? q.who : []).map(w => clip(w, LIMITS.name)).filter(Boolean).slice(0, LIMITS.who),
      leads, entries,
    });
  }
  return out;
}

/** Записи от новых к старым: по дате и времени, записи без даты считаются самыми старыми, при равенстве позже добавленная новее. */
export function sortedEntries(quest) {
  const key = (e, order) => [e.date ? e.date.year : -Infinity, e.date ? e.date.doy : -Infinity, e.minutes ?? -1, order];
  return quest.entries
    .map((e, order) => ({ e, k: key(e, order) }))
    .sort((a, b) => { for (let i = 0; i < 4; i++) { if (a.k[i] !== b.k[i]) return b.k[i] > a.k[i] ? 1 : -1; } return 0; })
    .map(x => x.e);
}
export const lastEntry = quest => sortedEntries(quest)[0] ?? null;

/** Сводка по зацепкам: сколько открытых (открыта или в работе). */
export const openLeads = quest => quest.leads.filter(l => l.state === 'open' || l.state === 'work');

// ---------- для рассказчика ----------
export const QUEST_RULE = 'quests are threads the story may pick up, not tasks handed to the player: never write the player\'s actions, choices or knowledge; let open leads surface through events, people and places when it fits, do not rush them or announce them as tasks, and never mark anything as done yourself';

/** Строки об идущих квестах: отслеживаемый первым, не больше max. */
export function questLines(quests, { max = 6 } = {}) {
  const active = quests.filter(q => q.status === 'active').sort((a, b) => Number(b.tracked) - Number(a.tracked)).slice(0, max);
  return active.map(q => {
    const parts = [`quest[${q.title}]${q.tracked ? ' (main)' : ''}${q.goal ? `: ${q.goal}` : ''}`];
    if (q.who.length) parts.push(`involves: ${q.who.join(', ')}`);
    const last = lastEntry(q);
    if (last) parts.push(`latest: ${clip(last.t, 160)}`);
    const open = openLeads(q).map(l => (l.state === 'work' ? `${l.t} (in progress)` : l.t));
    if (open.length) parts.push(`open leads: ${open.join('; ')}`);
    const closed = q.leads.filter(l => l.state === 'dead' || l.state === 'done').map(l => `${l.t}${l.note ? ` (${l.note})` : l.state === 'dead' ? ' (dead end)' : ' (done)'}`);
    if (closed.length) parts.push(`closed leads: ${closed.join('; ')}`);
    return parts.join(' | ');
  });
}
