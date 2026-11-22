/**
 * Сжатие контекста: старые сообщения, которые Архивариус уже разобрал, сворачиваются в короткую сводку «что было», а из запроса
 * к основной модели выпадают. Сам чат при этом не меняется: сообщения остаются на месте, вырезаются только копии в запросе.
 * Здесь чистая логика без обращений к Таверне: какие сообщения пора сжать, сколько вырезать из запроса, тексты запросов к модели.
 */
export const DIGEST_DEFAULTS = Object.freeze({ enabled: true, keep: 6, batch: 6, words: 350, markHidden: true });
export const DIGEST_LIMITS = Object.freeze({ keep: [2, 30], batch: [2, 30], words: [100, 1200] });
const OK_STATES = new Set(['готово', 'пусто']);

const clamp = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };
/** Настройки сжатия с допустимыми значениями. */
export function cleanDigestSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const L = DIGEST_LIMITS, D = DIGEST_DEFAULTS;
  return { enabled: r.enabled !== false, markHidden: r.markHidden !== false, keep: clamp(r.keep, ...L.keep, D.keep), batch: clamp(r.batch, ...L.batch, D.batch), words: clamp(r.words, ...L.words, D.words) };
}

/** Номера сообщений чата, которые уходят в запрос (без служебных). */
export const promptIndexes = chat => { const out = []; (chat ?? []).forEach((m, i) => { if (m && !m.is_system) out.push(i); }); return out; };

/**
 * Какие сообщения пора свернуть в сводку. Берутся сообщения после уже сжатых (index > upto), кроме последних keep;
 * идут подряд, пока не встретится ответ, который Архивариус ещё не разобрал (по записям его запусков runs: [{ index, state }]).
 * Ответ без записи считается разобранным раньше (запись о нём уже стёрлась из истории или расширения не было).
 * Возвращает номера сообщений или null, если их меньше batch.
 */
export function pickBatch({ chat, upto = -1, keep = 6, batch = 6, runs = [] }) {
  const all = promptIndexes(chat);
  const kept = new Set(all.slice(Math.max(0, all.length - keep)));
  const byIndex = new Map((runs ?? []).map(r => [r.index, r]));
  const out = [];
  for (const i of all) {
    if (i <= upto || kept.has(i)) continue;
    const m = chat[i];
    if (!m.is_user) {
      const row = byIndex.get(i);
      if (row && !OK_STATES.has(row.state)) break;                 // этот ответ ещё не разобран: дальше не идём, чтобы сводка не обогнала журнал
    }
    out.push(i);
  }
  return out.length >= batch ? out : null;
}

/**
 * Сколько первых сообщений вырезать из запроса. coreChat: сообщения запроса (копии), chat: настоящий чат.
 * Вырезаются только те, что уже вошли в сводку (index <= upto) и не входят в последние keep. Если запрос не совпадает с чатом
 * (другое число сообщений, другие даты), не режем ничего: лучше лишние токены, чем потерянный текст.
 */
export function cutCount({ coreChat, chat, upto = -1, keep = 6 }) {
  const all = promptIndexes(chat);
  if (upto < 0 || !Array.isArray(coreChat) || coreChat.length < 1) return 0;
  if (coreChat.length !== all.length && coreChat.length !== all.length - 1) return 0;     // на один меньше при свайпе: последнее сообщение отброшено
  const limit = coreChat.length - Math.max(1, keep);
  let n = 0;
  while (n < limit && all[n] <= upto) {
    const a = coreChat[n], b = chat[all[n]];
    if (!a || !b || a.send_date !== b.send_date || a.is_user !== b.is_user || (a.name ?? '') !== (b.name ?? '')) return 0;
    n += 1;
  }
  return n;
}

/** Запрос к вспомогательной модели: прежняя сводка и новые сообщения → обновлённая сводка. */
export function buildSummaryRequest({ prev = '', messages = [], dateLabel = '', words = 350 }) {
  const system = `You keep a running summary of a roleplay story so the narrator can continue without re-reading old messages.
Merge the PREVIOUS SUMMARY with the NEW MESSAGES into one updated summary.
Keep: what happened and in what order, decisions, promises and debts, discoveries, who learned what, changes of place and time, injuries and lost or gained items, unresolved threads, emotional turning points, and concrete facts (names, places, objects, numbers).
Drop: style, atmosphere, repeated description, filler, exact wording of dialogue (keep a line only if it is a promise, a threat or a key reveal).
Write plain neutral prose in the past tense, in short paragraphs, at most ${words} words in total. Use names exactly as they appear in the story. Do not invent anything. Do not address the reader.
If the previous summary is long, compress its oldest parts harder than the newest.
Return JSON only: {"summary": "the whole updated summary"}`;
  const body = messages.map(m => `[${m.name || (m.isUser ? 'Player' : 'Narrator')}]: ${m.text}`).join('\n\n');
  const user = `${dateLabel ? `Current date in the story: ${dateLabel}\n\n` : ''}PREVIOUS SUMMARY:\n${prev.trim() || '(none yet)'}\n\nNEW MESSAGES (oldest first):\n${body}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** Запрос на глубокое сжатие готовой сводки: давнее остаётся ключевыми моментами, недавнее почти целиком. */
export function buildCondenseRequest({ text = '', words = 200 }) {
  const system = `You condense a running summary of a roleplay story.
Rewrite the summary to at most ${words} words. The oldest events shrink to key moments only: turning points, promises and debts, deaths, discoveries, lasting changes, who now knows or owns what. Routine events and details that no longer matter are dropped. The most recent events stay almost as they are.
Keep names exactly as written. Do not invent anything and do not add commentary. Write plain neutral prose in the past tense, in short paragraphs.
Return JSON only: {"summary": "the condensed summary"}`;
  return [{ role: 'system', content: system }, { role: 'user', content: `SUMMARY:
${String(text).trim()}` }];
}

/** Слов в тексте (для целевой длины сжатия). */
export const wordCount = text => (String(text ?? '').match(/\S+/g) ?? []).length;

/** Разбор ответа модели: текст сводки или пустая строка. */
export function parseSummary(data, { maxChars = 6000 } = {}) {
  const s = typeof data?.summary === 'string' ? data.summary : Array.isArray(data?.summary) ? data.summary.join('\n') : '';
  const text = s.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > maxChars ? text.slice(0, maxChars).replace(/\s+\S*$/, '') : text;
}

/** Блок для рассказчика. Пустая сводка: пустая строка. */
export function summaryBlock(text) {
  const t = String(text ?? '').trim();
  return t ? `[Story so far: a summary of earlier messages that are no longer shown. It is established fact; do not repeat it, continue from the latest messages.]\n${t}` : '';
}

/** Снимки сводки для отката: после правки или удаления старых сообщений возвращаемся к сводке, которая их ещё не включала. */
export function rewindSnapshots(digest, fromIndex) {
  const snaps = Array.isArray(digest?.snaps) ? digest.snaps : [];
  if (!(digest?.upto >= fromIndex)) return null;                   // сводка до этого сообщения не дошла, откатывать нечего
  const back = [...snaps].reverse().find(s => s.upto < fromIndex);
  return back ? { upto: back.upto, text: back.text, snaps: snaps.filter(s => s.upto < fromIndex) } : { upto: -1, text: '', snaps: [] };
}
