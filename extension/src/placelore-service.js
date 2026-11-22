/**
 * Служба «записи лорбука у мест». Читает тексты записей, которые привязаны к местам (settings.placeLinks), и:
 *   1. отдаёт их сервису сцены, чтобы блок рассказчику получал привязанные записи текущего места (core/places.js: placeLoreLines);
 *   2. убирает из того, что отправляет сама Таверна, записи, которые мы шлём сами или которые выключены, чтобы они не пришли дважды
 *      (тот же приём, что у анкет: событие WORLDINFO_ENTRIES_LOADED).
 * Читаются только лорбуки, привязанные к этому чату и персонажу (как у анкет и секретов). Если текста записи нет, её у Таверны не отнимаем.
 */
import { report } from './guard.js';
import { normalizeLinks, loreStripped, loreEnabled } from './core/places.js';

const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function startPlaceLore(deps) {
  const { settings, shared } = deps;
  const ctx = () => globalThis.SillyTavern.getContext();
  const scene = () => shared.scene;
  const cache = new Map();        // «книга|запись» -> текст
  const anyBook = new Map();      // запись -> текст из первой найденной книги (когда у привязки книга не указана)
  let state = { at: 0, books: 0, found: 0, wanted: 0, error: '' };
  let busy = false, again = false;

  const textOf = (book, entry) => cache.get(`${book}|${norm(entry)}`) ?? anyBook.get(norm(entry)) ?? '';

  /** Перечитывает тексты привязанных записей из доступных лорбуков. */
  async function refresh() {
    if (busy) { again = true; return state; }
    busy = true;
    try {
      const links = normalizeLinks(settings.placeLinks);
      cache.clear(); anyBook.clear();
      if (!links.length || !scene()?.get().hasChat) { state = { at: Date.now(), books: 0, found: 0, wanted: links.length, error: '' }; return state; }
      const bound = shared.cards?.boundBooks ? await shared.cards.boundBooks() : [];
      const everything = ctx().getWorldInfoNames?.() ?? [];
      const names = bound === null ? everything : everything.filter(n => bound.includes(n));
      const want = new Set(links.map(l => norm(l.entry)));
      let found = 0;
      for (const name of names) {
        try {
          const data = await ctx().loadWorldInfo(name);
          for (const e of Object.values(data?.entries ?? {})) {
            const key = norm(e?.comment);
            if (!want.has(key) || e.disable || !String(e.content ?? '').trim()) continue;      // выключенную в самом лорбуке не берём: как в лорбуке
            const text = String(e.content).trim();
            if (!cache.has(`${name}|${key}`)) { cache.set(`${name}|${key}`, text); found += 1; }
            if (!anyBook.has(key)) anyBook.set(key, text);
          }
        } catch { /* книга не открылась, остальные читаем дальше */ }
      }
      state = { at: Date.now(), books: names.length, found, wanted: links.length, error: '' };
    } catch (error) {
      state = { ...state, error: String(error?.message ?? error) };
      report('чтение записей лорбука для мест', error);
    } finally {
      busy = false;
      scene()?.refreshPrompt?.();
      if (again) { again = false; refresh(); }
    }
    return state;
  }

  /** Все записи привязанных к чату лорбуков (для выбора записи к месту): [{ book, uid, entry, keys, text, disabled, secret }]. */
  async function entries() {
    const bound = shared.cards?.boundBooks ? await shared.cards.boundBooks() : [];
    const everything = ctx().getWorldInfoNames?.() ?? [];
    const names = bound === null ? everything : everything.filter(n => bound.includes(n));
    const out = [];
    for (const name of names) {
      try {
        const data = await ctx().loadWorldInfo(name);
        for (const e of Object.values(data?.entries ?? {})) {
          const entry = String(e?.comment ?? '').trim() || String(e?.key?.[0] ?? '').trim();
          if (!entry) continue;
          out.push({ book: name, uid: e.uid, entry, keys: [...(e.key ?? [])], text: String(e.content ?? ''), disabled: Boolean(e.disable), secret: /^\s*\[\s*(?:секрет|secret)/i.test(entry) });
        }
      } catch { /* книга не открылась, остальные читаем дальше */ }
    }
    return out;
  }

  // ---------- вырезание у Таверны ----------
  const undo = [];
  const on = (name, fn) => { const c = ctx(); const type = c.eventTypes?.[name]; if (!type) return; c.eventSource.on(type, fn); undo.push(() => c.eventSource.removeListener(type, fn)); };
  on('WORLDINFO_ENTRIES_LOADED', lists => {
    try {
      if (!settings.enabled) return;
      if (settings.sendPlaces === false) return;
      const links = normalizeLinks(settings.placeLinks);
      if (!links.length) return;
      const info = scene()?.get();
      if (!info?.hasChat) return;
      const map = info.state.map, nodes = info.placeNodes;
      for (const list of Object.values(lists ?? {})) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
          const item = list[i], key = norm(item?.comment);
          const link = links.find(l => norm(l.entry) === key && (!l.book || !item.world || l.book === item.world));
          if (!link || !loreStripped(link, map, nodes)) continue;
          const userOff = !loreEnabled(link, map) || link.when === 'never';
          if (userOff || textOf(link.book, link.entry)) list.splice(i, 1);      // шлём сами; если текста нет, Таверне не мешаем
        }
      }
    } catch (error) { report('вырезание привязанных записей лорбука', error); }       // при ошибке ничего не вырезаем
  });
  on('CHAT_CHANGED', () => { refresh(); });
  let sig = JSON.stringify(settings.placeLinks ?? []);
  const unsubscribe = scene()?.subscribe(() => {
    const now = JSON.stringify(settings.placeLinks ?? []);
    if (now !== sig) { sig = now; refresh(); }                                          // после импорта мест
  });
  refresh();

  shared.placeLore = { textOf, refresh, entries, state: () => state };
  return () => {
    unsubscribe?.();
    for (const fn of undo.reverse()) { try { fn(); } catch (e) { report('откат записей лорбука у мест', e); } }
    delete shared.placeLore;
  };
}
