/**
 * Русская версия анкеты: запросы к вспомогательной модели и разбор её ответов. Только чистая логика.
 * Перевод хранится в card.ru и нужен для чтения; рассказчику по-прежнему уходит английский оригинал.
 * card.ru = { head: { lead, tagline, facts: [значения], h, edited }, sections: { [id]: { title, text, h, edited } } }
 * h: отпечаток оригинала, по нему видно, что перевод устарел.
 */
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clipText = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);

export const RU_LIMITS = Object.freeze({ text: 24000, title: 120, lead: 1500, tagline: 200, fact: 320 });

/** Короткий отпечаток текста (djb2): достаточно, чтобы заметить правку оригинала. */
export function hashText(value) {
  const s = String(value ?? '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const RULES = `You are a translator for fan-fiction roleplay character profiles. Translate the text from English into natural, fluent Russian.
Rules:
- Keep the structure exactly: the same lines, the same Markdown (lines like "- **Label:** value" stay in that form). Translate both the label and the value.
- Proper names: if the source gives a Russian form in parentheses, use it; otherwise transliterate (Arvenn -> Арвенн). Do not add the Latin original.
- Keep quotation marks, numbers and units. Do not explain, comment, summarize, censor or add anything.
- If a part is already in Russian, leave it as is.`;

const stripFence = raw => String(raw ?? '').trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();

/** Запрос на перевод одного раздела. Ответ: заголовок, строка «---», текст. */
export function buildSectionRequest(section) {
  const user = `Translate this profile section.\nReply in exactly this form: first line is the translated section title, then a line with three dashes (---), then the translated text.\n\nTITLE: ${section.title}\n---\n${section.text}`;
  return [{ role: 'system', content: RULES }, { role: 'user', content: user }];
}
export function parseSectionReply(raw, fallbackTitle = '') {
  let s = stripFence(raw);
  if (!s) return null;
  const cut = s.search(/\n-{3,}[ \t]*\n/);
  let title = fallbackTitle, text = s;
  if (cut > -1) {
    title = s.slice(0, cut).replace(/^\s*(TITLE|ЗАГОЛОВОК)\s*[:：]\s*/i, '').trim() || fallbackTitle;
    text = s.slice(cut).replace(/^\s*\n-{3,}[ \t]*\n/, '');
  }
  text = clipText(text, RU_LIMITS.text);
  return text ? { title: clip(title, RU_LIMITS.title), text } : null;
}

/** Запрос на перевод шапки: вступление, подпись под именем и значения таблицы (подписи таблицы уже русские). */
export function buildHeadRequest({ lead = '', tagline = '', facts = [], titles = [] }) {
  const parts = [];
  if (lead) parts.push(`[lead]\n${lead}`);
  if (tagline) parts.push(`[tagline]\n${tagline}`);
  facts.forEach((f, i) => parts.push(`[fact ${i + 1}] (${f.k})\n${f.v}`));
  titles.forEach((t, i) => parts.push(`[title ${i + 1}]\n${t.title}`));
  const user = `Translate every block below. Reply with the same block markers ([lead], [tagline], [fact N], [title N]) each on its own line, followed by the translated text. Do not translate the marker, and do not repeat the label in round brackets after [fact N].\n\n${parts.join('\n\n')}`;
  return [{ role: 'system', content: RULES }, { role: 'user', content: user }];
}
export function parseHeadReply(raw, factCount = 0, titleCount = 0) {
  const s = stripFence(raw);
  if (!s) return null;
  const out = { lead: '', tagline: '', facts: Array.from({ length: factCount }, () => ''), titles: Array.from({ length: titleCount }, () => '') };
  const re = /^\[(lead|tagline|fact\s+(\d+)|title\s+(\d+))\][^\n]*\n/gim;
  const marks = [...s.matchAll(re)];
  if (!marks.length) return null;
  marks.forEach((m, i) => {
    const body = s.slice(m.index + m[0].length, marks[i + 1]?.index ?? s.length).trim();
    const key = m[1].toLowerCase();
    if (key === 'lead') out.lead = clip(body, RU_LIMITS.lead);
    else if (key === 'tagline') out.tagline = clip(body, RU_LIMITS.tagline);
    else if (m[3]) { const n = Number(m[3]) - 1; if (n >= 0 && n < titleCount) out.titles[n] = clip(body, RU_LIMITS.title); }
    else { const n = Number(m[2]) - 1; if (n >= 0 && n < factCount) out.facts[n] = clip(body, RU_LIMITS.fact); }
  });
  return out;
}

/** Сохранённый перевод → безопасный вид. */
export function normalizeRu(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { head: null, sections: {}, titles: {} };
  const h = raw.head;
  if (h && typeof h === 'object') {
    out.head = {
      lead: clip(h.lead, RU_LIMITS.lead), tagline: clip(h.tagline, RU_LIMITS.tagline),
      facts: (Array.isArray(h.facts) ? h.facts : []).slice(0, 16).map(v => clip(v, RU_LIMITS.fact)),
      h: clip(h.h, 16), ...(h.edited ? { edited: true } : {}),
    };
  }
  for (const [id, s] of Object.entries(raw.sections && typeof raw.sections === 'object' ? raw.sections : {}).slice(0, 40)) {
    const text = clipText(s?.text, RU_LIMITS.text);
    if (!text) continue;
    out.sections[clip(id, 40)] = { title: clip(s.title, RU_LIMITS.title), text, h: clip(s.h, 16), ...(s.edited ? { edited: true } : {}) };
  }
  for (const [id, v] of Object.entries(raw.titles && typeof raw.titles === 'object' ? raw.titles : {}).slice(0, 40)) {
    const t = clip(v?.t, RU_LIMITS.title);
    if (t) out.titles[clip(id, 40)] = { t, h: clip(v?.h, 16) };
  }
  return out.head || Object.keys(out.sections).length || Object.keys(out.titles).length ? out : null;
}

/** Отпечаток шапки: вступление, подпись и таблица, как их показывает статья. */
export const headHash = w => hashText(JSON.stringify([w.lead, w.tagline, (w.facts ?? []).map(f => [f.k, f.v])]));

/** Состояние блока: 'none' (нет перевода), 'fresh', 'stale' (оригинал изменился после перевода). */
export function blockState(entry, sourceHash) {
  if (!entry) return 'none';
  return entry.h === sourceHash ? 'fresh' : 'stale';
}

/**
 * Что переводить: шапка и разделы статьи (интимные только по просьбе). Блоки: { kind: 'head' | 'section', id?, title, state, edited }.
 * force: true: переводить и свежие (кнопка «заново»).
 */
export function planBlocks(card, { wiki, article, intimate = [], withIntimate = false, force = false }) {
  const ru = card?.ru ?? null;
  const out = [];
  const head = ru?.head;
  // шапка = вступление, таблица и названия разделов: устарело, если у названия нет свежего перевода
  const titlesOk = article.every(s => ru?.titles?.[s.id]?.h === hashText(s.title));
  const headState = head && blockState(head, headHash(wiki)) === 'fresh' && !titlesOk ? 'stale' : blockState(head, headHash(wiki));
  if (force || headState !== 'fresh') out.push({ kind: 'head', title: 'Шапка', state: headState, edited: Boolean(head?.edited) });
  for (const s of [...article, ...(withIntimate ? intimate : [])]) {
    if (!String(s.text ?? '').trim()) continue;
    const e = ru?.sections?.[s.id];
    const st = blockState(e, hashText(`${s.title}\n${s.text}`));
    if (force || st !== 'fresh') out.push({ kind: 'section', id: s.id, title: s.title, state: st, edited: Boolean(e?.edited) });
  }
  return out;
}
export const titleHash = s => hashText(s.title);
export const sectionHash = s => hashText(`${s.title}\n${s.text}`);
