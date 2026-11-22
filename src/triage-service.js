/**
 * Служба «Разбор лорбука»: следит за лорбуками, привязанными к чату, и когда в них появляются записи, которые ещё
 * не разбирали (новый лорбук или новые записи), показывает плашку. Сам разбор делает окно: записи делятся на людей
 * (становятся анкетами), места (привязываются к «Карте» ссылкой на запись) и остальное (остаётся в лорбуке).
 * Лорбуки не меняются. Что уже видели, помнится в метаданных чата.
 */
import { report } from './guard.js';
import { generate, auxReady, parseJsonObject } from './llm.js';
import { triageCandidates, buildTriageRequest, parseTriage, buildPlan, freshOf, seenUids, BATCH } from './core/triage.js';

const META = 'sceneJournalTriage';
const MIN_FRESH = 2;                                   // меньше двух новых записей не беспокоим
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function startTriage(deps) {
  const { settings, shared } = deps;
  const ctx = () => globalThis.SillyTavern.getContext();
  const listeners = new Set();
  const snoozed = new Set();                           // «Позже»: до перезагрузки страницы
  let pending = [];                                    // [{ book, fresh, total }]
  let busy = false, checking = false, again = false;
  let timer = 0;

  const meta = () => { const c = ctx(); return c.chatId && c.chatMetadata ? c.chatMetadata : null; };
  const store = () => { const m = meta(); if (!m) return { books: {} }; if (!m[META] || typeof m[META] !== 'object') m[META] = { books: {} }; if (!m[META].books) m[META].books = {}; return m[META]; };
  const saveMeta = () => { const c = ctx(); if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced(); else c.saveMetadata?.(); };
  const notify = () => { for (const fn of [...listeners]) { try { fn(get()); } catch (e) { report('подписчик разбора лорбука', e); } } };
  const get = () => ({ pending: pending.filter(p => !snoozed.has(p.book)), all: pending, busy });

  /** Записи, которые уже стали анкетами или привязаны к местам: их не разбираем второй раз. */
  function handled(book) {
    const sheetUids = new Set();
    try { for (const c of shared.cards?.get().cards ?? []) if (c.source?.book === book) for (const u of c.source.uids ?? []) sheetUids.add(String(u)); } catch { /* карточек ещё нет */ }
    const linkedTitles = new Set((Array.isArray(settings.placeLinks) ? settings.placeLinks : []).map(l => norm(l?.entry)));
    return { sheetUids, linkedTitles };
  }
  async function candidatesOf(book) {
    const entries = await shared.cards.loadEntries(book);
    return triageCandidates(entries, handled(book));
  }

  /** Перепроверяет привязанные лорбуки: какие из них стоит предложить разобрать. */
  async function check() {
    if (checking) { again = true; return get(); }
    checking = true;
    try {
      const info = shared.scene?.get();
      const st = meta() && info?.hasChat && settings.enabled ? store() : null;
      const books = st ? ((await shared.cards?.boundBooks?.()) ?? []) : [];
      const next = [];
      for (const book of books) {
        const rec = st.books[book];
        if (rec?.state === 'mute') continue;
        let cand;
        try { cand = await candidatesOf(book); } catch { continue; }
        const fresh = freshOf(cand, rec?.seen);
        if (fresh.length >= MIN_FRESH) next.push({ book, fresh: fresh.length, total: cand.length, isNew: !rec });
      }
      const same = JSON.stringify(next) === JSON.stringify(pending);
      pending = next;
      if (!same) notify();
    } catch (error) { report('проверка лорбуков', error); }
    finally { checking = false; if (again) { again = false; check(); } }
    return get();
  }
  const schedule = (ms = 900) => { clearTimeout(timer); timer = setTimeout(() => { check(); }, ms); };

  /** Разбор: пачками отправляет записи вспомогательной модели; без неё работает быстрая оценка по признакам. */
  async function scan(book, onProgress = () => {}) {
    if (busy) throw new Error('Разбор уже идёт.');
    busy = true; notify();
    try {
      const rec = store().books[book];
      const cand = freshOf(await candidatesOf(book), rec?.seen);
      const verdicts = {};
      let modelUsed = false, failed = 0;
      if (auxReady(settings.aux)) {
        const batches = [];
        for (let i = 0; i < cand.length; i += BATCH) batches.push(cand.slice(i, i + BATCH));
        for (let i = 0; i < batches.length; i++) {
          onProgress(i, batches.length);
          try {
            const raw = await generate(ctx(), settings.aux, buildTriageRequest(batches[i]), { maxTokens: Math.max(settings.aux.maxTokens ?? 4096, 4000) });
            Object.assign(verdicts, parseTriage(parseJsonObject(raw), batches[i]));
            modelUsed = true;
          } catch (error) { failed += 1; report('разбор лорбука моделью', error); }
        }
        onProgress(batches.length, batches.length);
      }
      return { book, plan: buildPlan(cand, verdicts), modelUsed, failed, total: cand.length };
    } finally { busy = false; notify(); }
  }

  /** Применяет план: люди становятся анкетами, места привязываются ссылкой на запись (текст остаётся в лорбуке). */
  async function apply(book, plan) {
    const people = plan.filter(p => p.kind === 'person' && p.name);
    const places = plan.filter(p => p.kind === 'place' && p.name);
    let cards = { created: 0, updated: 0 };
    if (people.length) cards = await shared.cards.importEntries(book, people.map(p => ({ uid: p.uid, name: p.name, tier: 'minor' })));
    // места: сначала без родителя или с родителем вне выбранных, потом вложенные
    const s = shared.scene;
    const nodes = () => s.get().placeNodes ?? [];
    const idByTitle = new Map();
    const made = [];
    let left = [...places], guard = 0;
    while (left.length && guard++ < 5) {
      const rest = [];
      for (const it of left) {
        const parentIt = it.parentTitle ? places.find(x => x.title === it.parentTitle) : null;
        if (parentIt && !idByTitle.has(parentIt.title)) { rest.push(it); continue; }
        const parentId = parentIt ? idByTitle.get(parentIt.title) : '';
        let node = nodes().find(n => n.kind !== 'folder' && norm(n.name) === norm(it.name));
        let id = node?.id;
        if (!id) { id = s.addPlace({ name: it.name, parentId, scope: 'chat' }); if (id) made.push(id); }
        if (!id) continue;
        idByTitle.set(it.title, id);
        s.addPlaceLink(id, { entry: it.title, book });
      }
      if (rest.length === left.length) { for (const it of rest) { let id = s.addPlace({ name: it.name, parentId: '', scope: 'chat' }); if (!id) id = nodes().find(n => norm(n.name) === norm(it.name))?.id; if (id) { idByTitle.set(it.title, id); if (!made.includes(id)) made.push(id); s.addPlaceLink(id, { entry: it.title, book }); } } break; }
      left = rest;
    }
    await finish(book, 'seen');
    return { cards, places: idByTitle.size, placesNew: made.length };
  }

  /** Запоминает, что эти записи уже видели («seen») или что про лорбук больше не спрашивать («mute»). */
  async function finish(book, state) {
    const st = store();
    let cand = [];
    try { cand = await candidatesOf(book); } catch { /* книга не открылась: запоминаем без списка */ }
    const old = st.books[book]?.seen ?? [];
    st.books[book] = { state, seen: [...new Set([...old, ...seenUids(cand)])], at: Date.now() };
    saveMeta();
    snoozed.delete(book);
    await check();
  }
  const dismiss = book => finish(book, 'seen');       // «Оставить в лорбуке»: записи считаются просмотренными
  const mute = book => finish(book, 'mute');
  const snooze = book => { snoozed.add(book); notify(); };

  const c0 = ctx();
  const hooks = [];
  const on = (name, fn) => { const type = c0.eventTypes?.[name]; if (!type) return; c0.eventSource.on(type, fn); hooks.push(() => c0.eventSource.removeListener(type, fn)); };
  on('CHAT_CHANGED', () => { snoozed.clear(); pending = []; schedule(1800); });
  on('WORLDINFO_UPDATED', () => schedule(1500));
  schedule(2500);

  shared.triage = { get, check, scan, apply, dismiss, mute, snooze, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  return () => {
    clearTimeout(timer);
    for (const off of hooks) { try { off(); } catch { /* уже снято */ } }
    listeners.clear();
    delete shared.triage;
  };
}
