/**
 * Служба анкет: библиотека карточек (общая), набор карточек чата (свой в каждом), чтение лорбуков, подсчёт токенов,
 * фото, блок для рассказчика по правилам «когда слать» и вырезание заменённых записей лорбука.
 * Окна читают shared.cards.get() и вызывают действия.
 */
import { report } from './guard.js';
import { generate, auxReady } from './llm.js';
import { wikiOf, splitSections } from './core/wiki.js';
import { buildSectionRequest, parseSectionReply, buildHeadRequest, parseHeadReply, planBlocks, headHash, sectionHash, titleHash, RU_LIMITS } from './core/translate.js';
import { storyText } from './core/story.js';
import {
  normalizeLibrary, ctxKeys, cardsFromBook, cardFromWholeBook, sameCharacter, mentionedIn, selectSections, buildCardsBlock, sheetEntryTest, estimateTokens, matchPerson, cardNames, KIND_IDS, WHEN_IDS, kindOfTitle, KINDS,
} from './core/cards.js';

const PROMPT_KEY = 'sceneJournal-cards';
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;

export function startCards(deps) {
  const { settings, shared, save } = deps;
  const ctx = () => globalThis.SillyTavern.getContext();
  const scene = () => shared.scene;
  const listeners = new Set();
  const tokenCache = new Map();           // текст → токены (настоящий счётчик Таверны, пока не посчитан: оценка)
  let lastPicked = [];
  let lastBlock = { text: '', used: 0, dropped: [], kept: [] };
  let note = '';

  // Анкеты у каждого чата свои: хранятся в метаданных чата. Общая библиотека settings.cards осталась только как старый запас:
  // при первом открытии чата из неё берутся те карточки, что были подключены к этому чату раньше.
  const LIB_KEY = 'sceneJournalCards';
  const chatMeta = () => { const c = ctx(); return c.chatId && c.chatMetadata ? c.chatMetadata : null; };
  const saveMeta = () => { const c = ctx(); if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced(); else c.saveMetadata?.(); };
  const library = () => {
    const meta = chatMeta();
    if (!meta) return normalizeLibrary(settings.cards);
    if (!meta[LIB_KEY]) {
      const old = normalizeLibrary(settings.cards);
      const ids = new Set(scene()?.get()?.state?.cards?.ids ?? []);
      meta[LIB_KEY] = { cards: old.cards.filter(c => ids.has(c.id)) };
      saveMeta();
    }
    return normalizeLibrary(meta[LIB_KEY]);
  };
  const putLibrary = lib => { const meta = chatMeta(); if (meta) { meta[LIB_KEY] = lib; saveMeta(); } else { settings.cards = lib; save(); } };
  /** Карточка из лорбука, который к этому чату и персонажу не привязан, не используется: не уходит рассказчику и не вырезает записи лорбука. */
  const idle = card => settings.cardsOnlyBound !== false && Boolean(card.source?.book) && !boundNow.includes(card.source.book);
  const activeLibrary = () => { const lib = library(); return { ...lib, cards: lib.cards.filter(c => !idle(c)) }; };
  const attachedIds = () => (chatMeta() ? activeLibrary().cards.map(c => c.id) : []);
  const newId = () => `k${Math.random().toString(36).slice(2, 9)}`;
  const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  // ---------- токены ----------
  const tokensOf = text => tokenCache.get(text) ?? estimateTokens(text);
  let counting = false;
  /** Считает настоящие токены для всех разделов, которых ещё нет в кэше; по готовности обновляет окна. */
  async function countAll() {
    if (counting) return;
    counting = true;
    try {
      const count = ctx().getTokenCountAsync;
      if (typeof count !== 'function') return;
      let changed = false;
      for (const card of library().cards) for (const s of card.sections) {
        if (!s.text || tokenCache.has(s.text)) continue;
        try { tokenCache.set(s.text, await count(s.text)); changed = true; } catch { tokenCache.set(s.text, estimateTokens(s.text)); }
      }
      if (changed) notify();
    } finally { counting = false; }
  }

  // ---------- что уходит рассказчику ----------
  function recentText() {
    const chat = ctx().chat ?? [];
    return chat.slice(-2).map(m => storyText(m.mes)).join('\n').slice(-3000);
  }
  function compute() {
    const info = scene()?.get();
    if (!info?.hasChat) return { info: null, picked: [] };
    const attached = attachedIds();
    const picked = selectSections(activeLibrary(), attached, {
      people: info.cast.map(p => ({ id: p.id, name: p.name, persona: p.persona, present: p.present && !info.knowledge.deaths[p.id] })),
      mode: info.fate.mode, stage: Boolean(info.fate.heat), tension: info.tension?.level ?? 0,
      recentText: recentText(), entered: info.state.cards.entered, chatLength: ctx().chat?.length ?? 0,
    });
    return { info, picked };
  }
  /** Кто вышел на сцену, а кто ушёл: от этого зависит правило «при выходе на сцену». */
  function trackEntrances(info) {
    if (!info) return;
    const lib = activeLibrary();
    const people = info.cast.map(p => ({ id: p.id, name: p.name, persona: p.persona, present: p.present && !info.knowledge.deaths[p.id] }));
    const here = new Set();
    for (const id of attachedIds()) {
      const card = lib.cards.find(c => c.id === id);
      const person = card ? matchPerson(card, people) : null;
      if (person && person.present && !person.persona) here.add(person.id);
    }
    const entered = info.state.cards.entered;
    const add = [...here].filter(id => entered[id] === undefined);
    const remove = Object.keys(entered).filter(id => !here.has(id));
    if (add.length || remove.length) scene().updateEntered({ add, remove, at: ctx().chat?.length ?? 0 });
  }
  function refreshPrompt() {
    try {
      const { info, picked } = compute();
      lastPicked = picked;
      const on = settings.enabled && settings.sendCards !== false && info;
      lastBlock = on ? buildCardsBlock(picked, { maxChars: settings.cardsBudget }) : { text: '', used: 0, dropped: [], kept: [] };
      ctx().setExtensionPrompt(PROMPT_KEY, lastBlock.text, IN_CHAT, settings.depth, false, ROLE_SYSTEM);
      trackEntrances(info);
    } catch (error) { report('блок анкет', error); }
  }

  const get = () => {
    const info = scene()?.get();
    const lib = library();
    const attached = info?.hasChat ? attachedIds() : [];
    const people = info?.hasChat ? info.cast.map(p => ({ id: p.id, name: p.name, persona: p.persona, present: p.present })) : [];
    const cards = lib.cards.map(c => ({ ...c, idle: idle(c), tokens: c.sections.reduce((n, s) => n + (s.text ? tokensOf(s.text) : 0), 0), sectionTokens: Object.fromEntries(c.sections.map(s => [s.id, tokensOf(s.text)])), person: matchPerson(c, people) }));
    const sentIds = new Set(lastBlock.kept.map(p => p.card.id));
    const sent = lastBlock.kept.map(p => ({ id: p.card.id, name: p.card.name, sections: p.sections.map(s => ({ id: s.section.id, title: s.section.title, why: s.why, tokens: tokensOf(s.section.text) })) }));
    const sentTokens = sent.reduce((n, p) => n + p.sections.reduce((m, s) => m + s.tokens, 0), 0);
    const translation = tr ? { id: tr.id, done: tr.done, total: tr.total, title: tr.title } : null;
    return { hasChat: Boolean(info?.hasChat), cards, attached, sentIds, sent, sentTokens, block: lastBlock.text, dropped: lastBlock.dropped, note, enabled: settings.sendCards !== false, translation, canTranslate: Boolean(settings.enabled && auxReady(settings.aux)) };
  };
  function notify() { for (const fn of [...listeners]) { try { fn(get()); } catch (e) { report('подписчик анкет', e); } } }
  const changed = () => { refreshPrompt(); countAll(); notify(); };

  // ---------- библиотека ----------
  const mutateLib = fn => { const lib = library(); const out = fn(lib); putLibrary(normalizeLibrary(lib)); changed(); return out; };
  const addCard = (name, tier = 'main') => {
    const text = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text || library().cards.some(c => sameName(c.name, text))) return '';
    const id = newId();
    mutateLib(lib => { lib.cards.push({ id, name: text, tier, aliases: [], image: '', sections: [{ id: 's1', kind: 'basic', title: tier === 'minor' ? 'Описание' : KINDS.basic, text: '' }] }); });
    return id;
  };
  const removeCard = id => { mutateLib(lib => { lib.cards = lib.cards.filter(c => c.id !== id); }); };
  /** Объединяет дубль в основную карточку: разделы (одинаковые пропускаются), псевдонимы, фото; имя берётся более полное. В этом чате дубль заменяется основной. */
  const mergeCards = (keepId, dropId) => {
    if (keepId === dropId) return false;
    let ok = false;
    mutateLib(lib => {
      const keep = lib.cards.find(c => c.id === keepId), drop = lib.cards.find(c => c.id === dropId);
      if (!keep || !drop) return;
      const words = n => String(n).trim().split(/\s+/).length;
      const [fullName, shortName] = words(drop.name) > words(keep.name) ? [drop.name, keep.name] : [keep.name, drop.name];
      keep.name = fullName;
      keep.aliases = [...new Set([...(keep.aliases ?? []), ...(drop.aliases ?? []), ...(sameName(shortName, fullName) ? [] : [shortName])].filter(a => !sameName(a, fullName)))];
      for (const s of drop.sections ?? []) {
        const twin = keep.sections.find(x => sameName(x.title, s.title));
        if (twin && String(twin.text).trim() === String(s.text).trim()) continue;
        let sid = s.id, n = 1;
        while (keep.sections.some(x => x.id === sid)) sid = `${s.id}m${n++}`;
        keep.sections.push({ ...s, id: sid, title: twin ? `${s.title} (из «${drop.name}»)` : s.title });
      }
      if (!keep.image && drop.image) keep.image = drop.image;
      if (drop.tier === 'main') keep.tier = 'main';
      lib.cards = lib.cards.filter(c => c.id !== dropId);
      ok = true;
    });
    return ok;
  };
  const updateCard = (id, patch) => mutateLib(lib => {
    const c = lib.cards.find(x => x.id === id);
    if (!c) return;
    if (patch.name != null) { const n = String(patch.name).replace(/\s+/g, ' ').trim().slice(0, 80); if (n) c.name = n; }
    if (patch.aliases != null) c.aliases = String(patch.aliases).split(/[,;\n]/).map(a => a.trim()).filter(Boolean);
    if (patch.image != null) c.image = patch.image;
    if (patch.wiki != null) c.wiki = { ...(c.wiki ?? {}), ...patch.wiki };   // вступление, подпись и факты статьи (нормализуются при сохранении)
    if (patch.tier === 'main' || patch.tier === 'minor') c.tier = patch.tier;
  });
  const setSection = (id, sectionId, patch) => mutateLib(lib => {
    const s = lib.cards.find(c => c.id === id)?.sections.find(x => x.id === sectionId);
    if (!s) return;
    if (patch.title != null) s.title = String(patch.title).slice(0, 80);
    if (patch.text != null) s.text = String(patch.text);
    if (patch.kind != null && KIND_IDS.includes(patch.kind)) s.kind = patch.kind;
    if (patch.when != null) { if (patch.when === '') delete s.when; else if (WHEN_IDS.includes(patch.when)) s.when = patch.when; }
    if (patch.off != null) { if (patch.off) s.off = true; else delete s.off; }
    if (patch.ctx != null) s.ctx = ctxKeys(String(patch.ctx).split(/\n/));
    if (patch.keys != null) {
      // ключи с новой строки; если среди них нет регулярок /…/, можно и через запятую
      const raw = String(patch.keys);
      s.keys = (/(^|\n)\s*\//.test(raw) ? raw.split(/\n/) : raw.split(/[,;\n]/)).map(k => k.trim()).filter(Boolean).slice(0, 16);
    }
  });
  const addSection = (id, kind = 'other') => {
    let made = '';
    mutateLib(lib => { const c = lib.cards.find(x => x.id === id); if (c && c.sections.length < 24) { made = `s${Date.now().toString(36)}`; c.sections.push({ id: made, kind, title: KINDS[kind] ?? 'Раздел', text: '' }); } });
    return made;
  };
  const removeSection = (id, sectionId) => mutateLib(lib => { const c = lib.cards.find(x => x.id === id); if (c) c.sections = c.sections.filter(s => s.id !== sectionId); });

  // ---------- русская версия анкеты (вспомогательная модель переводит блоками; каждый готовый блок сразу попадает в card.ru) ----------
  let tr = null;                          // { id, done, total, title, stop }: идущий перевод (в памяти)
  const mutateRu = (id, fn) => mutateLib(lib => { const c = lib.cards.find(x => x.id === id); if (!c) return; c.ru = c.ru ?? { head: null, sections: {} }; c.ru.sections = c.ru.sections ?? {}; fn(c.ru, c); });
  const planFor = (card, opts) => {
    const parts = splitSections(card.sections);
    return { wiki: wikiOf(card), parts, blocks: planBlocks(card, { wiki: wikiOf(card), article: parts.article, intimate: parts.intimate, withIntimate: opts.withIntimate || Boolean(opts.only), force: opts.force || Boolean(opts.only) }) };
  };
  /** Сколько блоков перевести и сколько из них с вашими правками перевода: окно спрашивает подтверждение перед затиранием. */
  const translatePlan = (id, opts = {}) => {
    const card = library().cards.find(c => c.id === id);
    if (!card) return { blocks: [], edited: 0 };
    let blocks = planFor(card, opts).blocks;
    if (opts.only) blocks = blocks.filter(b => b.kind === opts.only.kind && (b.kind === 'head' || b.id === opts.only.id));
    return { blocks, edited: blocks.filter(b => b.edited).length };
  };
  /**
   * Переводит анкету по блокам: шапка, затем разделы. opts: { force, withIntimate, only: { kind, id } }.
   * Ошибка связи останавливает перевод (готовые блоки остаются); блок, который модель вернула не по форме, пропускается.
   */
  async function translateCard(id, opts = {}) {
    if (tr) throw new Error('Перевод уже идёт.');
    if (!settings.enabled || !auxReady(settings.aux)) throw new Error('Подключите вспомогательную модель: Настройки → Основные.');
    const first = library().cards.find(c => c.id === id);
    if (!first) return { done: 0, failed: 0 };
    const blocks = translatePlan(id, opts).blocks;
    tr = { id, done: 0, total: blocks.length, title: '', stop: false };
    let done = 0, failed = 0, fatal = '';
    notify();
    try {
      for (const b of blocks) {
        if (tr.stop) break;
        const card = library().cards.find(c => c.id === id);
        if (!card) break;
        tr.title = b.title; notify();
        const options = { maxTokens: Math.min(32000, Math.max(Number(settings.aux?.maxTokens) || 4096, 8000)) };
        try {
          if (b.kind === 'head') {
            const w = wikiOf(card);
            const arts = splitSections(card.sections).article;
            const src = { lead: w.lead, tagline: w.tagline, facts: w.facts, titles: arts.map(s => ({ id: s.id, title: s.title })) };
            if (!src.lead && !src.tagline && !src.facts.length && !src.titles.length) { tr.done += 1; continue; }
            const got = parseHeadReply(await generate(ctx(), settings.aux, buildHeadRequest(src), options), src.facts.length, src.titles.length);
            if (!got) { failed += 1; } else {
              const hash = headHash(w);
              mutateRu(id, ru => {
                ru.head = { lead: got.lead, tagline: got.tagline, facts: got.facts, h: hash };
                ru.titles = ru.titles ?? {};
                arts.forEach((s, i) => { if (got.titles[i]) ru.titles[s.id] = { t: got.titles[i], h: titleHash(s) }; });
              });
              done += 1;
            }
          } else {
            const s = card.sections.find(x => x.id === b.id);
            if (!s || !String(s.text ?? '').trim()) { tr.done += 1; continue; }
            const got = parseSectionReply(await generate(ctx(), settings.aux, buildSectionRequest({ title: s.title, text: s.text }), options), s.title);
            if (!got) { failed += 1; } else {
              const hash = sectionHash(s);
              mutateRu(id, ru => { ru.sections[s.id] = { title: got.title, text: got.text, h: hash }; });
              done += 1;
            }
          }
        } catch (error) { fatal = String(error?.message ?? error); break; }
        tr.done += 1; notify();
      }
    } finally { tr = null; notify(); }
    if (fatal) { const e = new Error(fatal); e.done = done; throw e; }
    return { done, failed };
  }
  const stopTranslation = () => { if (tr) { tr.stop = true; } };
  /** Правка перевода руками: шапка { lead, tagline, facts: [значения] } или раздел { title, text }. Правленый блок помечается и не затирается без подтверждения. */
  const setRu = (id, target, patch) => mutateRu(id, (ru, card) => {
    if (target.kind === 'head') {
      const h = ru.head ?? { lead: '', tagline: '', facts: [], h: headHash(wikiOf(card)) };
      if (patch.lead != null) h.lead = String(patch.lead).slice(0, RU_LIMITS.lead);
      if (patch.tagline != null) h.tagline = String(patch.tagline).slice(0, RU_LIMITS.tagline);
      if (Array.isArray(patch.facts)) h.facts = patch.facts.map(v => String(v ?? '').slice(0, RU_LIMITS.fact));
      h.edited = true; ru.head = h;
    } else {
      const s = card.sections.find(x => x.id === target.id);
      if (!s) return;
      const e = ru.sections[s.id] ?? { title: s.title, text: '', h: sectionHash(s) };
      if (patch.title != null) e.title = String(patch.title).slice(0, RU_LIMITS.title);
      if (patch.text != null) e.text = String(patch.text).slice(0, RU_LIMITS.text);
      e.edited = true; ru.sections[s.id] = e;
    }
  });
  const clearRu = id => mutateLib(lib => { const c = lib.cards.find(x => x.id === id); if (c) delete c.ru; });

  // ---------- лорбуки ----------
  // Расширение имеет право читать только те лорбуки, которые привязаны к этому чату, к его персонажу или выбраны глобально
  // (настройка «cardsOnlyBound», по умолчанию включена). Остальные книги из папки миров не просматриваются и не импортируются.
  let boundNow = [];
  async function refreshBound() {
    try {
      const c = ctx();
      const out = new Set();
      const add = n => { if (typeof n === 'string' && n.trim()) out.add(n.trim()); };
      add(c.chatMetadata?.world_info);
      const ch = c.characters?.[c.characterId];
      add(ch?.data?.extensions?.world);
      try {
        const wi = await import('/scripts/world-info.js');
        for (const n of wi.selected_world_info ?? []) add(n);
        const file = String(ch?.avatar ?? '').replace(/\.[^/.]+$/, '');
        for (const n of wi.world_info?.charLore?.find(e => e.name === file)?.extraBooks ?? []) add(n);
      } catch { /* без модуля мира остаются книга чата и основная книга персонажа */ }
      // лорбук персоны Таверны: только если в чат вошла именно та персона, к которой привязан этот чат
      const personaBook = c.powerUserSettings?.persona_description_lorebook;
      if (personaBook) {
        let ok = true;
        if (settings.personaBookStrict !== false) {
          const info = scene()?.get();
          const bound = info?.hasChat ? info.cast.find(p => p.persona) : null;
          if (bound) {
            const low = s => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
            const names = [bound.name, ...(info.relations.people.find(x => x.id === bound.id)?.aliases ?? [])].map(low);
            ok = names.includes(low(c.name1));
          }
        }
        if (ok) add(personaBook);
      }
      boundNow = [...out];
    } catch { boundNow = []; }
    return boundNow;
  }
  const allBookNames = () => { try { return ctx().getWorldInfoNames?.() ?? []; } catch { return []; } };
  const onlyBound = () => settings.cardsOnlyBound !== false;
  /** Лорбуки, которые можно читать: привязанные к чату и персонажу (или все, если запрет снят в настройках). */
  const bookNames = () => (onlyBound() ? allBookNames().filter(n => boundNow.includes(n)) : allBookNames());
  async function loadBook(name, single = false) {
    if (onlyBound()) {
      await refreshBound();
      if (!boundNow.includes(name)) throw new Error(`Лорбук «${name}» не привязан к этому чату и персонажу, расширение его не читает. Разрешить можно в «Настройках».`);
    }
    const data = await ctx().loadWorldInfo(name);
    if (!data?.entries) throw new Error(`Лорбук «${name}» не открылся.`);
    return cardsFromBook(Object.values(data.entries), name, { single });
  }
  /** Что нашлось в лорбуке: [{ name, sections, exists }] — ничего не меняет. */
  async function previewBook(name) {
    const found = await loadBook(name, true);
    const lib = library();
    return found.map(c => ({ name: c.name, sections: c.sections.length, chars: c.sections.reduce((n, s) => n + s.text.length, 0), exists: lib.cards.some(x => sameCharacter(x.name, c.name)), single: c.sections.length === 1 && c.sections[0].title === 'Описание' }));
  }
  /** Вливает найденные карточки в библиотеку: новые добавляются, у существующих обновляются тексты одноимённых разделов. */
  const mergeFound = (lib, found) => {
    let created = 0, updated = 0;
    for (const c of found) {
      const have = lib.cards.find(x => sameCharacter(x.name, c.name));
      if (!have) { lib.cards.push({ id: newId(), name: c.name, tier: c.tier ?? 'main', aliases: [...(c.aliases ?? [])], image: '', source: c.source, sections: c.sections.map((s, i) => ({ id: `s${i + 1}`, ...s })) }); created += 1; continue; }
      for (const s of c.sections) {
        const mine = have.sections.find(x => sameName(x.title, s.title));
        // одноимённый раздел обновляется только из того же лорбука; из другого лорбука он не перезаписывается (первый источник главнее)
        if (mine) { if (!have.source?.book || have.source.book === c.source.book) { mine.text = s.text; mine.keys = [...new Set([...(mine.keys ?? []), ...(s.keys ?? [])])].slice(0, 16); mine.ctx = [...new Set([...(mine.ctx ?? []), ...(s.ctx ?? [])])].slice(0, 8); } }
        else if (have.sections.length < 24) have.sections.push({ id: `s${Date.now().toString(36)}${have.sections.length}`, ...s });
      }
      if (!have.source) have.source = c.source;
      if (c.tier === 'main') have.tier = 'main';
      for (const al of [c.name, ...(c.aliases ?? [])]) if (!sameName(al, have.name) && !have.aliases.some(x => sameName(x, al)) && have.aliases.length < 12) have.aliases.push(al);
      updated += 1;
    }
    return { created, updated };
  };
  /**
   * Переносит карточки из лорбука в библиотеку. names: какие брать (пусто = все). Существующая карточка обновляется:
   * разделы с тем же названием получают новый текст, свои правила, псевдонимы и фото остаются, новые разделы добавляются.
   */
  async function importBook(name, names = []) {
    const found = (await loadBook(name, true)).filter(c => !names.length || names.some(n => sameName(n, c.name)));
    let result = { created: 0, updated: 0 };
    mutateLib(lib => { result = mergeFound(lib, found); });
    note = `Из «${name}»: новых карточек ${result.created}, обновлено ${result.updated}.`;
    notify();
    return result;
  }
  /** Записи лорбука как есть (с той же проверкой «привязан ли лорбук к чату»). */
  async function loadEntries(name) {
    if (onlyBound()) {
      await refreshBound();
      if (!boundNow.includes(name)) throw new Error(`Лорбук «${name}» не привязан к этому чату и персонажу, расширение его не читает. Разрешить можно в «Настройках».`);
    }
    const data = await ctx().loadWorldInfo(name);
    if (!data?.entries) throw new Error(`Лорбук «${name}» не открылся.`);
    return Object.values(data.entries);
  }
  /** Лорбук целиком об одном персонаже: все записи становятся разделами одной карточки. */
  async function importBookAsOne(name, cardName = '') {
    const card = cardFromWholeBook(await loadEntries(name), name, cardName || name);
    if (!card.sections.length) throw new Error('В лорбуке нет записей с текстом.');
    card.source.whole = true;
    let result = { created: 0, updated: 0 };
    mutateLib(lib => { result = mergeFound(lib, [card]); const have = lib.cards.find(x => sameCharacter(x.name, card.name)); if (have?.source?.book === name) have.source.whole = true; });
    note = `Из «${name}»: одна карточка «${card.name}», разделов ${card.sections.length}${card.skipped ? ` (ещё ${card.skipped} записей не влезло)` : ''}.`;
    notify();
    return { ...result, sections: card.sections.length, skipped: card.skipped };
  }
  /** Обновляет все карточки чата из их лорбуков: тексты, ключи и контекст. Новых не создаёт; книги, которые к чату не привязаны, пропускает. */
  async function reloadAll(onProgress = () => {}) {
    const books = [...new Set(library().cards.map(c => c.source?.book).filter(Boolean))];
    let updated = 0;
    const skipped = [];
    for (let i = 0; i < books.length; i++) {
      onProgress(i + 1, books.length, books[i]);
      let found;
      try {
        // карточки, собранные «весь лорбук = один персонаж», обновляются так же, а не по названиям записей
        const wholes = library().cards.filter(c => c.source?.book === books[i] && c.source.whole);
        found = wholes.length ? [] : await loadBook(books[i], true);
        for (const w of wholes) found.push(cardFromWholeBook(await loadEntries(books[i]), books[i], w.name));
      } catch { skipped.push(books[i]); continue; }
      const mine = library().cards;
      found = found.filter(c => mine.some(x => sameCharacter(x.name, c.name)));
      let result = { updated: 0 };
      mutateLib(lib => { result = mergeFound(lib, found); });
      updated += result.updated;
    }
    note = `Обновлено карточек: ${updated}${skipped.length ? `; пропущено книг (не привязаны): ${skipped.length}` : ''}.`;
    notify();
    return { updated, skipped, books: books.length };
  }
  /** Одной кнопкой: просматривает ВСЕ лорбуки Таверны и собирает карточки из всех записей вида «[ Имя ] - Раздел». */
  async function importAll(onProgress = () => {}) {
    // сначала лорбуки, в названии которых «Персонаж» (там анкеты целиком), потом остальные: что нашли раньше, то главнее
    const names = [...bookNames()].sort((a, b) => Number(/персонаж|persona/i.test(b)) - Number(/персонаж|persona/i.test(a)));
    const all = [];
    const withCards = [];
    for (let i = 0; i < names.length; i++) {
      onProgress(i + 1, names.length, names[i]);
      try {
        const found = await loadBook(names[i]);
        if (found.length) { all.push(...found); withCards.push(`${names[i]} (${found.length})`); }
      } catch { /* книга не открылась: идём дальше */ }
    }
    let result = { created: 0, updated: 0 };
    mutateLib(lib => { result = mergeFound(lib, all); });
    note = `Просмотрено лорбуков: ${names.length}. Новых карточек: ${result.created}, обновлено: ${result.updated}.`;
    notify();
    return { ...result, books: names.length, withCards };
  }

  /** Второстепенные: одиночные записи «Имя (Русское имя)» в лорбуках, в названии которых NPC. Ничего не меняет. */
  async function previewMinor(all = false) {
    const lib = library();
    const out = [];
    for (const book of bookNames()) {
      if (!all && !/npc|нпс|второстеп/i.test(book)) continue;
      let found = [];
      try { found = (await loadBook(book, true)).filter(c => c.tier === 'minor'); } catch { continue; }
      for (const c of found) out.push({ name: c.name, aliases: c.aliases, book, chars: c.sections.reduce((n, s) => n + s.text.length, 0), exists: lib.cards.some(x => sameCharacter(x.name, c.name)), key: `${book}|${c.name}` });
    }
    return out;
  }
  /** Переносит выбранных второстепенных (ключи из previewMinor); одноимённых, уже имеющихся, не трогает. */
  async function importMinor(keys) {
    const want = new Set(keys);
    let created = 0;
    for (const book of [...new Set(keys.map(k => k.split('|')[0]))]) {
      const found = (await loadBook(book, true)).filter(c => c.tier === 'minor' && want.has(`${book}|${c.name}`));
      mutateLib(lib => { for (const c of found) if (!lib.cards.some(x => sameCharacter(x.name, c.name))) { lib.cards.push({ id: newId(), name: c.name, tier: 'minor', aliases: [...(c.aliases ?? [])], image: '', source: c.source, sections: c.sections.map((s, i) => ({ id: `s${i + 1}`, ...s })) }); created += 1; } });
    }
    note = `Второстепенных добавлено: ${created}.`;
    notify();
    return { created };
  }

  // ---------- фото ----------
  /** Уменьшает картинку, сохраняет через Таверну в её папку изображений и прикрепляет к карточке. */
  /** Загружает картинку (сжимает до 640 точек) в папку Таверны и возвращает путь. Нужна и «Карте» для картинок мест. */
  async function uploadImage(file, folder, name) {
    if (!file) throw new Error('Файл не выбран.');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
    const response = await fetch('/api/images/upload', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ image: b64, format: 'jpeg', ch_name: folder, filename: `${name}-${Date.now().toString(36)}` }) });
    if (!response.ok) throw new Error(`Не удалось сохранить картинку: HTTP ${response.status}`);
    const { path } = await response.json();
    return `/${String(path ?? '').replace(/^\/+/, '')}`;
  }
  async function setImage(id, file) {
    const card = library().cards.find(c => c.id === id);
    if (!card || !file) return false;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
    const response = await fetch('/api/images/upload', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ image: b64, format: 'jpeg', ch_name: 'SceneJournalCards', filename: `${id}-${Date.now().toString(36)}` }) });
    if (!response.ok) throw new Error(`Не удалось сохранить фото: HTTP ${response.status}`);
    const { path } = await response.json();
    const clean = `/${String(path ?? '').replace(/^\/+/, '')}`;
    updateCard(id, { image: clean });
    return true;
  }

  // ---------- вырезание заменённых записей лорбука ----------
  const undo = [];
  const on = (name, fn) => { const c = ctx(); const type = c.eventTypes?.[name]; if (!type) return; c.eventSource.on(type, fn); undo.push(() => c.eventSource.removeListener(type, fn)); };
  on('WORLDINFO_ENTRIES_LOADED', lists => {
    try {
      if (!settings.enabled || settings.sendCards === false) return;
      const info = scene()?.get();
      if (!info?.hasChat) return;
      const test = sheetEntryTest(activeLibrary(), attachedIds());
      if (!test) return;
      for (const list of Object.values(lists ?? {})) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) list.splice(i, 1);
      }
    } catch (error) { report('вырезание записей лорбука', error); }       // при ошибке ничего не вырезаем: лорбук работает как обычно
  });
  on('MESSAGE_RECEIVED', index => {
    refreshPrompt();
  });
  on('MESSAGE_SENT', () => refreshPrompt());
  on('CHAT_CHANGED', () => { refreshBound().then(() => changed()); });
  let lastPersonaName = '';
  const unsubscribeScene = scene()?.subscribe(() => {
    const name = String(ctx().name1 ?? '');
    if (name !== lastPersonaName) { lastPersonaName = name; refreshBound().then(() => { refreshPrompt(); notify(); }); return; }   // сменилась персона: пересчитать, какие лорбуки можно читать
    refreshPrompt(); notify();
  });
  refreshBound().then(() => { refreshPrompt(); notify(); });
  changed();

  const api = {
    /** Лорбуки, привязанные к этому чату и персонажу (для других служб: секреты и т.п.). null: ограничение снято в настройках, можно любые. */
    uploadImage,
    boundBooks: async () => (onlyBound() ? [...(await refreshBound())] : null),
    get, bookNames, previewBook, importBook, importBookAsOne, importAll, reloadAll, previewMinor, importMinor, addCard, removeCard, mergeCards, updateCard, setSection, addSection, removeSection, setImage,
    translateCard, translatePlan, stopTranslation, setRu, clearRu,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  shared.cards = api;
  return () => {
    unsubscribeScene?.();
    for (const fn of undo.reverse()) { try { fn(); } catch (e) { report('откат анкет', e); } }
    try { ctx().setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, settings.depth, false, ROLE_SYSTEM); } catch { /* уже закрыто */ }
    listeners.clear();
    delete shared.cards;
  };
}
