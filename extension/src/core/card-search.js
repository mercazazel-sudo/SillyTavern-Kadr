/**
 * Поиск по анкетам: имя, прозвища, а при необходимости и текст анкеты. Все слова запроса должны найтись (в любом порядке),
 * начало слова весит больше, чем середина, имя больше прозвища, прозвище больше текста. Латиница находит кириллицу и обратно
 * (по целым словам имени: «Raphael» найдёт «Рафаил»). Чистая логика, Таверны не знает.
 */
import { sameNameAcrossScripts } from './names.js';

export const normSearch = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
const words = s => (s ? s.split(' ') : []);
const TEXT_CAP = 4000;

/** Вес одного слова запроса в одной строке (имя или прозвище): 0 = нет. */
function inName(token, text) {
  if (!text) return 0;
  if (text === token) return 4;
  const ws = words(text);
  if (ws.some(w => w === token)) return 3.4;
  if (ws.some(w => w.startsWith(token))) return 3;
  if (text.includes(token)) return 2;
  if (token.length >= 3 && sameNameAcrossScripts(token, text)) return 2.6;
  return 0;
}

/**
 * cards: [{ id, name, aliases[], tier, sections[{ title, text }] }]. Возвращает до limit найденных, лучшие первыми:
 * [{ card, score, where }], where: 'имя' | 'прозвище' | 'текст анкеты'.
 * inText = false ищет только по именам.
 */
export function searchCards(cards, query, { limit = 12, inText = true } = {}) {
  const tokens = words(normSearch(query));
  if (!tokens.length) return [];
  const out = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const name = normSearch(card?.name);
    const aliases = (card?.aliases ?? []).map(normSearch).filter(Boolean);
    let text = null;
    let score = 0, where = '', ok = true;
    for (const token of tokens) {
      let best = inName(token, name), at = best ? 'имя' : '';
      for (const a of aliases) { const v = inName(token, a) * 0.9; if (v > best) { best = v; at = 'прозвище'; } }
      if (!best && inText) {
        if (text === null) text = normSearch((card?.sections ?? []).map(s => `${s.title ?? ''} ${s.text ?? ''}`).join(' ')).slice(0, TEXT_CAP);
        if (text.includes(token)) { best = 0.8; at = 'текст анкеты'; }
      }
      if (!best) { ok = false; break; }
      score += best;
      if (!where || (at === 'имя') || (at === 'прозвище' && where === 'текст анкеты')) where = at;
    }
    if (!ok) continue;
    if (name === normSearch(query)) score += 3;
    if ((card?.tier ?? 'main') === 'main') score += 0.2;
    out.push({ card, score, where });
  }
  out.sort((a, b) => b.score - a.score || String(a.card.name).localeCompare(String(b.card.name), 'ru'));
  return out.slice(0, Math.max(1, limit));
}
