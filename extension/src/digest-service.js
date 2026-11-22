/**
 * Служба сжатия контекста. Раз в несколько сообщений Архивариус сворачивает старые, уже разобранные сообщения в сводку «что было»;
 * последние keep сообщений остаются в запросе как есть, а всё, что вошло в сводку, из запроса к основной модели выпадает
 * (в самом чате ничего не меняется). Сводка уходит рассказчику отдельным блоком.
 * Вырезание делает перехватчик запроса sceneJournalIntercept, который Таверна вызывает перед сборкой промпта (manifest: generate_interceptor).
 */
import { report } from './guard.js';
import { generate, auxReady, parseJsonObject } from './llm.js';
import { storyText } from './core/story.js';
import { cleanDigestSettings, pickBatch, cutCount, buildSummaryRequest, buildCondenseRequest, wordCount, parseSummary, summaryBlock, rewindSnapshots } from './core/digest.js';

const KEY = 'sceneJournalDigest';
const PROMPT_KEY = 'sj_digest';
const IN_CHAT = 1;       // extension_prompt_types.IN_CHAT
const ROLE_SYSTEM = 0;   // extension_prompt_roles.SYSTEM
const MESSAGE_CHARS = 4000;

export function startDigest(deps) {
  const { settings, shared } = deps;
  const ctx = () => globalThis.SillyTavern.getContext();
  const listeners = new Set();
  let busy = false, note = '', error = '', timer = 0, chatKey = '';
  let lastCut = { n: 0, chars: 0, at: 0, why: '' };

  const cfg = () => cleanDigestSettings(settings.digest);
  const store = () => {
    const c = ctx();
    if (!c.chatMetadata || !c.chatId) return null;
    const d = c.chatMetadata[KEY];
    return d && typeof d === 'object' ? d : (c.chatMetadata[KEY] = { text: '', upto: -1, snaps: [] });
  };
  const save = () => { try { const c = ctx(); if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced(); else c.saveMetadata?.(); } catch { /* запишется позже */ } };
  const ready = () => settings.enabled && cfg().enabled && auxReady(settings.aux);
  const get = () => {
    const d = store();
    return { enabled: cfg().enabled, ready: ready(), busy, note, error, text: d?.text ?? '', canUndo: Boolean(d?.before), words: wordCount(d?.text), upto: d?.upto ?? -1, covered: Math.max(0, (d?.upto ?? -1) + 1), cfg: cfg(), lastCut: { ...lastCut } };
  };
  const notify = () => { for (const fn of [...listeners]) { try { fn(get()); } catch (e) { report('подписчик сжатия', e); } } };

  /** Блок со сводкой для рассказчика: на глубине keep, то есть сразу перед самым старым из оставленных сообщений. */
  function applyPrompt() {
    try {
      const c = ctx();
      const d = store();
      const text = d && cfg().enabled && settings.enabled ? summaryBlock(d.text) : '';
      c.setExtensionPrompt(PROMPT_KEY, text, IN_CHAT, cfg().keep, false, ROLE_SYSTEM);
    } catch (e) { report('блок сводки', e); }
  }

  // ---------- пометка «скрыто» (глазик в чате) у сжатых сообщений ----------
  const runsToRanges = idx => { const out = []; for (const i of [...idx].sort((a, b) => a - b)) { const last = out[out.length - 1]; if (last && i === last[1] + 1) last[1] = i; else out.push([i, i]); } return out; };
  const slash = async (a, b, unhide) => { const c = ctx(); if (typeof c.executeSlashCommands !== 'function') return false; await c.executeSlashCommands(`/${unhide ? 'unhide' : 'hide'} ${a === b ? a : `${a}-${b}`}`); return true; };
  let syncing = false, syncAgain = false;
  /**
   * Приводит флаг «скрыто» в чате в соответствие со сводкой: всё до границы скрыто, что за ней видно. Запоминает только то, что скрыли мы
   * (d.hidden), чтобы не снять то, что пользователь скрыл сам. Таверна не кладёт скрытые сообщения в запрос, поэтому это и есть сама вырезка.
   */
  async function syncHidden() {
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const d = store(); if (!d) return;
      const chat = ctx().chat ?? [];
      const want = cfg().markHidden && cfg().enabled && settings.enabled && d.upto >= 0 && Boolean(d.text);
      const had = new Set(Array.isArray(d.hidden) ? d.hidden : []);
      const toShow = [...had].filter(i => !want || i > d.upto);
      const toHide = want ? chat.map((_, i) => i).filter(i => i <= d.upto && !chat[i]?.is_system) : [];
      for (const [a, b] of runsToRanges(toShow.filter(i => chat[i]?.is_system))) await slash(a, b, true);
      for (const [a, b] of runsToRanges(toHide)) await slash(a, b, false);
      d.hidden = [...[...had].filter(i => !toShow.includes(i) && chat[i]), ...toHide];
      if (toShow.length || toHide.length) save();
    } catch (e) { report('скрытие сжатых сообщений', e); }
    finally { syncing = false; if (syncAgain) { syncAgain = false; syncHidden(); } }
  }

  const runsOf = () => ctx().chatMetadata?.sceneJournalRuns ?? [];

  /** Один проход: если набралась пачка разобранных сообщений, дописать сводку. force: сжать всё, что можно, не ожидая пачки. */
  async function run({ force = false } = {}) {
    if (busy || !ready()) return false;
    const c = ctx();
    const d = store();
    if (!d || !shared.scene?.get().hasChat) return false;
    if (shared.chronicle?.get().busy) return false;                       // сначала Архивариус разберёт ответ: сводка не должна обгонять журнал
    const o = cfg();
    const chat = c.chat ?? [];
    const idx = pickBatch({ chat, upto: d.upto, keep: o.keep, batch: force ? 1 : o.batch, runs: runsOf() });
    if (!idx) { if (force) { note = 'Сжимать пока нечего: старые сообщения уже в сводке или ещё не разобраны.'; notify(); } return false; }
    const key = `${c.chatId}`;
    const last = idx[idx.length - 1];
    const sendText = idx.map(i => ({ name: chat[i].name, isUser: Boolean(chat[i].is_user), text: storyText(chat[i].mes).slice(0, MESSAGE_CHARS) })).filter(m => m.text);
    busy = true; error = ''; note = `Сжимаю сообщения до № ${last + 1}…`; notify();
    try {
      const info = shared.scene?.get();
      const dateLabel = info ? `${info.date.name}, ${info.date.year} ${info.date.era}` : '';
      const raw = await generate(c, settings.aux, buildSummaryRequest({ prev: d.text, messages: sendText, dateLabel, words: o.words }), { maxTokens: Math.max(settings.aux.maxTokens ?? 4096, 3000) });
      const text = parseSummary(parseJsonObject(raw));
      if (!text) throw new Error('модель вернула пустую сводку');
      if (`${ctx().chatId}` !== key || String(ctx().chat?.[last]?.send_date) !== String(chat[last]?.send_date)) { note = 'Чат изменился во время сжатия, результат отброшен.'; busy = false; notify(); return false; }
      d.snaps = [...(Array.isArray(d.snaps) ? d.snaps : []), { upto: d.upto, text: d.text }].slice(-6);
      d.text = text; d.upto = last; d.at = Date.now();
      save(); applyPrompt(); syncHidden();
      note = `Сводка обновлена: сообщения до № ${last + 1} (${sendText.length} шт.), ${text.length} знаков.`;
    } catch (e) { error = `Сжатие не вышло: ${e?.message ?? e}`; note = ''; }
    busy = false; notify();
    return !error;
  }

  /** Глубокое сжатие готовой сводки (кнопка «Сжать контекст»): давнее остаётся ключевыми моментами. Прежний текст запоминается для отмены. */
  async function condense() {
    if (busy || !ready()) { if (!ready()) { error = 'Нужна вспомогательная модель Архивариуса и включённое сжатие.'; notify(); } return false; }
    const d = store();
    if (!d?.text) { note = 'Сжимать нечего: сводки ещё нет.'; notify(); return false; }
    const before = d.text, key = `${ctx().chatId}`;
    const target = Math.max(80, Math.round(wordCount(before) * 0.5));
    busy = true; error = ''; note = 'Сжимаю сводку до ключевых моментов…'; notify();
    try {
      const raw = await generate(ctx(), settings.aux, buildCondenseRequest({ text: before, words: target }), { maxTokens: Math.max(settings.aux.maxTokens ?? 4096, 3000) });
      const text = parseSummary(parseJsonObject(raw));
      if (!text) throw new Error('модель вернула пустую сводку');
      if (`${ctx().chatId}` !== key || store()?.text !== before) { note = 'Сводка изменилась во время сжатия, результат отброшен.'; busy = false; notify(); return false; }
      d.before = before; d.text = text; d.at = Date.now();
      save(); applyPrompt();
      note = `Сводка сжата: было ${wordCount(before)} слов, стало ${wordCount(text)}.`;
    } catch (e) { error = `Сжатие не вышло: ${e?.message ?? e}`; note = ''; }
    busy = false; notify();
    return !error;
  }
  /** Вернуть сводку, какой она была до последнего глубокого сжатия. */
  function undoCondense() { const d = store(); if (!d?.before) return false; d.text = d.before; delete d.before; save(); applyPrompt(); note = 'Сжатие отменено: сводка вернулась.'; notify(); return true; }

  const kick = (ms = 1200) => { clearTimeout(timer); timer = setTimeout(() => { run().catch(e => report('сжатие контекста', e)); }, ms); };

  /** Пользователь правит сводку руками: текст меняется, граница остаётся. */
  function setText(text) { const d = store(); if (!d) return; d.text = String(text ?? '').slice(0, 8000); save(); applyPrompt(); notify(); }
  /** Граница сводки руками: «сводка покрывает сообщения до № n» (нумерация как в чате Таверны, с 1). Вручную написанную сводку так привязывают к чату. */
  function setUpto(n) {
    const d = store(); if (!d) return false;
    const last = (ctx().chat ?? []).length;
    const v = Math.min(Math.max(Math.round(Number(n) || 0), 0), last);
    d.upto = v - 1; d.snaps = []; save(); applyPrompt(); syncHidden(); note = v ? `Граница сводки: сообщения до № ${v}.` : 'Граница сводки снята.'; notify(); return true;
  }
  /** Сбросить сводку: все сообщения снова идут в запрос целиком, пока не накопится новая пачка. */
  function reset() { const d = store(); if (!d) return; d.text = ''; d.upto = -1; d.snaps = []; save(); applyPrompt(); syncHidden(); note = 'Сводка сброшена: в запрос идёт весь чат.'; notify(); kick(2500); }
  function setOption(patch) { settings.digest = { ...cfg(), ...patch }; deps.save?.(); applyPrompt(); syncHidden(); notify(); kick(800); }

  /**
   * Перехватчик Таверны: coreChat это копия сообщений для запроса, её можно резать на месте.
   * Выпадают только сообщения, уже вошедшие в сводку; последние keep остаются всегда.
   */
  globalThis.sceneJournalIntercept = async (coreChat, _contextSize, _abort, type) => {
    try {
      if (!settings.enabled || !cfg().enabled || type === 'quiet') { lastCut = { n: 0, chars: 0, at: Date.now(), why: 'сжатие выключено' }; return; }
      const d = store();
      if (!d?.text || d.upto < 0) { lastCut = { n: 0, chars: 0, at: Date.now(), why: 'сводки ещё нет' }; return; }
      const n = cutCount({ coreChat, chat: ctx().chat ?? [], upto: d.upto, keep: cfg().keep });
      if (!n) { lastCut = { n: 0, chars: 0, at: Date.now(), why: 'ничего не вырезано (запрос не совпал с чатом или всё в пределах последних)' }; return; }
      const gone = coreChat.splice(0, n);
      lastCut = { n, chars: gone.reduce((s, m) => s + String(m.mes ?? '').length, 0), at: Date.now(), why: '' };
      notify();
    } catch (e) { report('вырезание старых сообщений', e); }
  };

  // ---------- события ----------
  const undo = [];
  const on = (name, fn) => { const c = ctx(); const type = c.eventTypes?.[name]; if (!type) return; c.eventSource.on(type, fn); undo.push(() => c.eventSource.removeListener(type, fn)); };
  on('MESSAGE_RECEIVED', () => kick(2500));
  on('CHAT_CHANGED', () => {
    chatKey = ctx().chatId ? `${ctx().chatId}` : '';
    applyPrompt(); note = ''; error = ''; notify(); kick(3000); setTimeout(() => syncHidden(), 1500);
  });
  // правка, свайп или удаление сообщения внутри уже сжатого куска: возвращаемся к сводке, которая его ещё не включала
  const rewind = from => {
    try {
      const d = store(); const back = rewindSnapshots(d, Number(from));
      if (!back) return;
      Object.assign(d, back); save(); applyPrompt(); syncHidden(); note = 'Сообщение внутри сводки изменилось: сводка откатилась назад и соберётся заново.'; notify(); kick(3000);
    } catch (e) { report('откат сводки', e); }
  };
  on('MESSAGE_EDITED', i => rewind(i));
  on('MESSAGE_SWIPED', i => rewind(i));
  on('MESSAGE_DELETED', length => rewind(Number(length) || 0));
  // когда Архивариус закончил ответ, пора проверить, не набралась ли пачка
  const unsub = shared.chronicle?.subscribe?.(state => { if (!state.busy) kick(1500); });
  chatKey = ctx().chatId ? `${ctx().chatId}` : '';
  applyPrompt();

  const api = { get, run, setUpto, condense, undoCondense, reset, setText, setOption, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  shared.digest = api;
  return () => {
    clearTimeout(timer);
    for (const fn of undo.reverse()) { try { fn(); } catch (e) { report('откат сжатия', e); } }
    try { unsub?.(); } catch { /* уже снято */ }
    try { ctx().setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, 0, false, ROLE_SYSTEM); } catch { /* уже закрыто */ }
    delete globalThis.sceneJournalIntercept;
    listeners.clear();
    delete shared.digest;
  };
}
