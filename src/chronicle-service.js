/**
 * Служба Архивариуса: после ответа рассказчика (сама или по кнопке) запускает малые задачи на вспомогательной модели
 * и копит предложения. Ничего не меняет в чате сама: запись происходит по кнопке «Записать» в окне «Архивариус».
 * Окна читают shared.chronicle.get() и вызывают действия.
 */
import { report } from './guard.js';
import { generate, auxReady, parseJsonObject, testConnection as testLink, listProfiles, fetchModels, getRequestLog } from './llm.js';
import { pickTasks, buildJournalRequest, buildRelationsRequest, parseJournal, parseRelations, buildSceneRequest, parseScene, sceneRoster, newNameCandidates, planRequests, mergeRequests, buildItemsRequest, parseItems, buildTracesRequest, parseTraces, buildPlaceRequest, parsePlace, buildKnowledgeRequest, parseKnowledge, eyeMentioned, findWatcher, eyeFallbackLine } from './core/chronicle.js';
import { condLeft } from './core/body.js';
import { relationLines } from './core/relations.js';
import { storyText } from './core/story.js';
import { FEATURES } from './core/features.js';

const TASK_RU = { journal: 'журнал', relations: 'отношения', scene: 'кто в кадре', items: 'вещи', body: 'приметы и раны', place: 'место', know: 'знания' };

export function startChronicle(deps) {
  const { settings, shared } = deps;
  const ctx = () => globalThis.SillyTavern.getContext();
  const listeners = new Set();
  let proposals = [];
  let busy = false;
  let note = '';
  let error = '';
  let chatKey = '';
  let queued = null;
  let serial = 0;
  let requestsMade = 0;
  const runs = new Map();                 // номер ответа → итог последнего запуска (в памяти, до перезагрузки)

  /** Короткий отпечаток текста: по нему видно, изменился ли ответ с тех пор, как его разобрал Архивариус. */
  const textHash = s => { let h = 5381; const t = String(s ?? ''); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return h; };

  /** История запусков живёт в чате (последние 40): по ней видно, что случилось с ответом, даже после перезагрузки страницы. */
  function trace(index, patch) {
    try {
      const c = ctx();
      if (!c.chatMetadata || !c.chatId) return;
      const list = Array.isArray(c.chatMetadata.sceneJournalRuns) ? c.chatMetadata.sceneJournalRuns : (c.chatMetadata.sceneJournalRuns = []);
      let row = list.find(r => r.index === index);
      if (!row) { row = { index }; list.push(row); }
      Object.assign(row, patch, { at: new Date().toISOString() });
      while (list.length > 40) list.shift();
      if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced(); else c.saveMetadata?.();
    } catch { /* история не должна ломать работу */ }
  }

  const scene = () => shared.scene;
  const ready = () => settings.enabled && auxReady(settings.aux);
  const get = () => ({ ready: ready(), auto: Boolean(settings.chronicle?.auto), busy, note, error, proposals: [...proposals], profiles: listProfiles(ctx()), requests: getRequestLog() });
  const notify = () => { for (const fn of [...listeners]) { try { fn(get()); } catch (e) { report('подписчик Архивариуса', e); } } };
  const currentKey = () => { const c = ctx(); return c.chatId ? `${c.chatId}` : ''; };

  /** Последний ответ рассказчика: индекс сообщения. */
  function lastReplyIndex() {
    const chat = ctx().chat ?? [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user && !chat[i].is_system && String(chat[i].mes ?? '').trim()) return i;
    return -1;
  }
  const userTextBefore = index => {
    const chat = ctx().chat ?? [];
    for (let i = index - 1; i >= 0; i--) if (chat[i].is_user) return String(chat[i].mes ?? '');
    return '';
  };

  /**
   * Удалённый свидетель (Око → Вестор): нужен ли журнал наблюдений для этого ответа. Устройство считается рядом, если оно названо
   * в тексте ответа или в кадре есть присутствующий с таким именем. Возвращает { device, watcherName } или null.
   */
  function eyeWatch(info, reply) {
    const cfg = settings.eye;
    if (!cfg?.enabled || !cfg.watcher) return null;
    const devices = cfg.devices ?? [];
    const inFrame = info.cast.some(p => p.present && eyeMentioned(p.name, devices));      // Око отмечено в составе: оно точно рядом
    const near = inFrame || eyeMentioned(reply, devices);
    return near ? { device: 'Scrying Eye', watcherName: cfg.watcher, sure: inFrame } : null;
  }

  /** Готовит запрос задачи: сообщения и разбор ответа модели (parse получает объект задачи). */
  function prepare(task, info, reply, userText) {
    const dateLabel = `${info.date.name}, ${info.date.year} ${info.date.era}${info.date.storyDay != null ? `, story day ${info.date.storyDay}` : ''}`;
    let messages, parse;
    if (task === 'journal') { messages = buildJournalRequest({ quests: info.quests, reply, userText, dateLabel }); parse = d => parseJournal(d, info.quests); }
    else if (task === 'know') {
      const people = info.people.filter(p => !info.knowledge.deaths[p.id]).map(p => ({ id: p.id, name: p.name, persona: p.persona, present: p.present, aliases: p.aliases ?? [] }));
      const watch = eyeWatch(info, reply);
      messages = buildKnowledgeRequest({ people: people.filter(p => p.present || p.persona), events: info.knowledge.events, reply, userText, dateLabel, watch });
      parse = d => parseKnowledge(d, { people, knowledge: info.knowledge, watch });
    } else if (task === 'place') {
      messages = buildPlaceRequest({ nodes: info.placeNodes, current: info.map.current, reply, userText });
      parse = d => parsePlace(d, { nodes: info.placeNodes, current: info.map.current, over: info.map.over });
    } else if (task === 'body') {
      const people = info.people.filter(p => p.present).map(p => ({ id: p.id, name: p.name, persona: p.persona, aliases: p.aliases ?? [] }));
      const bodies = {};
      for (const p of people) { const b = info.bodies[p.id]; bodies[p.id] = { wounds: (b?.wounds ?? []).map(w => w.t), conds: (b?.conds ?? []).map(c => ({ id: c.id, t: c.t, left: condLeft(info.state.calendar, c, info.today) })), mood: b?.mood ?? null, arousal: b?.arousal ?? 0 }; }
      messages = buildTracesRequest({ people, bodies, reply, userText, dateLabel, items: info.inventory });
      parse = d => parseTraces(d, { people, bodies, items: info.inventory });
    } else if (task === 'items') {
      const people = info.people.map(p => ({ id: p.id, name: p.name, persona: p.persona, present: p.present, aliases: p.aliases ?? [] }));
      messages = buildItemsRequest({ people, items: info.inventory, reply, userText });
      parse = d => parseItems(d, { people, items: info.inventory });
    } else if (task === 'scene') {
      const roster = sceneRoster(info.cast, info.relations, info.knowledge);
      const candidates = newNameCandidates(reply, roster, info.relations.seen);
      messages = buildSceneRequest({ roster, reply, userText, candidates });
      parse = d => { const got = parseScene(d, roster, reply); got.candidates = candidates; return got; };
    } else {
      const present = info.cast.filter(p => p.present);
      const lines = relationLines(info.relations, info.cast, { maxChars: 1800, memoryLimit: 0, tensionLimit: 0, sharedLimit: 0, factors: false });
      messages = buildRelationsRequest({ present, lines, reply, userText, dateLabel });
      parse = d => parseRelations(d, { cast: info.people.filter(p => info.cast.some(c => c.id === p.id)), lines: info.relations.lines, shared: info.relations.shared });
    }
    return { task, name: task, messages, parse };
  }

  /** Один запрос на несколько задач (или на одну). Возвращает { задача: результат }. Пустой или оборванный ответ: один повтор. */
  async function askGroup(group, info, reply, userText) {
    const prepared = group.map(task => prepare(task, info, reply, userText));
    const merged = mergeRequests(prepared);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await generate(ctx(), settings.aux, merged.messages, merged.keyed ? { maxTokens: Math.max(settings.aux.maxTokens ?? 4096, 6000) } : undefined);
        const data = parseJsonObject(raw);
        const out = {};
        for (const p of prepared) {
          const sub = merged.keyed ? data?.[p.task] : data;
          out[p.task] = sub && typeof sub === 'object' ? p.parse(sub) : [];
        }
        return out;
      } catch (e) { lastError = e; }
    }
    throw lastError;
  }

  /** Разбор ответа под номером index. force: пропустить фильтры (кнопка). */

  /** Что сделали Кулисы с ответом номер index: число операций и их виды (только чтение, если Кулисы есть). */
  function kulisyAt(index) {
    try {
      const ops = globalThis.Kulisy?.getState?.()?.operations ?? ctx().chatMetadata?.['kulisy.v1']?.operations;
      if (!Array.isArray(ops)) return null;
      const mine = ops.filter(o => (o.meta?.messageIndex ?? o.messageIndex) === index);
      const types = {};
      for (const o of mine) types[o.type] = (types[o.type] ?? 0) + 1;
      return { n: mine.length, types };
    } catch { return null; }
  }
  /** Последние n ответов рассказчика: что сделал наш Архивариус (по журналу изменений), что сделали Кулисы, итог запуска. */
  function history(n = 12) {
    const chat = ctx().chat ?? [];
    const log = scene()?.get().relations?.log ?? [];
    const rows = [];
    for (let i = chat.length - 1; i >= 0 && rows.length < n; i--) {
      if (chat[i].is_user || chat[i].is_system) continue;
      const ours = {};
      for (const e of log.filter(x => x.at === i)) ours[e.kind] = (ours[e.kind] ?? 0) + 1;
      rows.push({ index: i, ours, kulisy: kulisyAt(i), run: runs.get(i) ?? null });
    }
    return rows;
  }

  async function run(index = lastReplyIndex(), { force = false } = {}) {
    if (!ready()) { error = 'Вспомогательная модель не настроена (окно «Настройки», блок «Архивариус»).'; trace(index, { state: 'не запущен', why: 'модель не настроена или расширение выключено' }); notify(); return false; }
    if (busy) { queued = { index, force }; trace(index, { state: 'в очереди', why: 'служба занята прошлым запросом' }); return false; }
    const s = scene();
    const pm = s?.get().personaMismatch;
    if (pm) { note = `Пауза: в Таверне персона «${pm.tavern}», а в чате привязана «${pm.bound}». Выберите в строке сцены (⚠).`; trace(index, { state: 'пауза', why: 'персона Таверны не совпадает с привязанной к чату' }); notify(); return false; }
    const message = ctx().chat?.[index];
    if (!s?.get().hasChat || !message || message.is_user) { note = 'Нет ответа рассказчика для разбора.'; notify(); return false; }
    const cfg = settings.chronicle ?? {};
    const auto = { rel: cfg.autoApplyRelations !== false, scene: cfg.autoApplyScene !== false, items: cfg.autoApplyItems !== false, body: cfg.autoApplyBody !== false, journal: cfg.autoApplyJournal !== false, place: cfg.autoApplyPlace !== false, know: cfg.autoApplyKnow !== false };
    // повторный разбор того же ответа (кнопка, перегенерация): прежние автоматические правки от него сначала снимаются,
    // чтобы изменения не удваивались и состав сцены считался от состояния до этого ответа
    if (cfg.relations && auto.rel) s.revertAt(index, 'rel');
    if (cfg.relations && auto.rel) s.revertAt(index, 'moment');
    if (cfg.journal && auto.journal) s.revertAt(index, 'quest');
    if (cfg.scene && auto.scene) s.revertAt(index, 'cast');
    if (cfg.items && auto.items) s.revertAt(index, 'item');
    if (cfg.body && auto.body) s.revertAt(index, 'body');
    if (cfg.place && auto.place) s.revertAt(index, 'place');
    if (cfg.know && auto.know) s.revertAt(index, 'know');
    let info = s.get();
    const key = currentKey();
    const raw = String(message.mes ?? '');
    const text = storyText(raw);                       // без блока <rp_preflight>: он даёт ложные срабатывания
    const tasks = pickTasks(text, { quests: info.quests, cast: info.cast, relations: info.relations, knowledge: info.knowledge }, cfg, force);
    // Око в комнате: знания разбираются всегда, чтобы журнал наблюдений вёлся сам; наблюдатель заводится среди людей, если его ещё нет
    const watch = FEATURES.secrets && FEATURES.eye && cfg.know ? eyeWatch(info, text) : null;
    if (watch) {
      if (!tasks.includes('know')) tasks.push('know');
      if (!findWatcher(info.people, watch.watcherName)) { s.addPerson(watch.watcherName); info = s.get(); }
    }
    if (!tasks.length) { note = `Ответ ${index + 1}: фильтры не нашли, что записывать.`; error = ''; trace(index, { state: 'пусто', why: 'фильтры не нашли, что записывать' }); notify(); return true; }
    busy = true; error = ''; note = `Разбираю ответ ${index + 1}: ${tasks.map(t => TASK_RU[t]).join(', ')}…`; notify();
    trace(index, { state: 'идёт', h: textHash(raw), tasks: tasks.map(t => TASK_RU[t]), eye: watch ? (watch.sure ? 'в кадре' : 'упомянуто') : '' });
    const started = Date.now();
    const fresh = [];
    const failures = [];
    let applied = 0;
    const plan = planRequests(tasks, cfg.requestMode ?? 'grouped');
    requestsMade = 0;
    for (const group of plan) {
      let results = {};
      try { results = await askGroup(group, info, text, userTextBefore(index)); requestsMade += 1; }
      catch (e) { failures.push(`${group.map(t => TASK_RU[t]).join('+')}: ${e?.message ?? e}`); }
      for (const task of group) {
        const got = results[task];
        if (!got) continue;
        if (task === 'scene' && auto.scene) {
          // состав сцены применяется сразу: следующие задачи уже видят, кто рядом
          for (const p of got) {
            if (p.kind === 'newperson') { const pid = s.applyNewPerson({ ...p, at: index }); if (pid) { applied += 1; if (settings.chronicle.newToCards) shared.cards?.addFromPerson({ id: pid, name: p.name, aliases: p.aliases }); } }
            else if (s.applyCastChange({ personId: p.personId, present: p.kind === 'arrive', at: index, label: p.label })) applied += 1;
          }
          const named = new Set(got.filter(p => p.kind === 'newperson').map(p => p.name.toLowerCase()));
          const rest = (got.candidates ?? []).filter(w => !named.has(w.toLowerCase()));
          if (rest.length) s.bumpSeen(rest);                      // проверенные слова, не ставшие героями, больше не тревожат
          info = s.get();
        } else fresh.push(...got);
      }
      if (currentKey() !== key || String(ctx().chat?.[index]?.mes ?? '') !== raw) { busy = false; note = 'Ответ изменился во время разбора, результат отброшен.'; trace(index, { state: 'отброшен', why: 'ответ изменился во время разбора' }); notify(); return false; }
    }
    const left = [];
    const ranTasks = tasks.slice();
    let eyeDone = fresh.some(p => p.kind === 'know' && p.watch);        // модель сама вернула наблюдение Ока
    for (const p of fresh) {
      try {
        if (p.kind === 'rel' && auto.rel) { if (s.applyRelChange({ ...p, at: index })) applied += 1; }
        else if (p.kind === 'moment' && auto.rel) { if (s.applyMoment({ ...p, at: index })) applied += 1; }
        else if ((p.kind === 'entry' || p.kind === 'lead') && auto.journal) { if (s.applyJournalChange({ ...p, at: index })) applied += 1; }
        else if (p.kind === 'know' && auto.know) { if (s.applyKnowledgeChange({ ...p, at: index })) applied += 1; }
        else if (p.kind === 'place' && auto.place) { if (s.applyPlaceChange({ ...p, at: index })) applied += 1; }
        else if (p.kind === 'body' && auto.body) { if (s.applyBodyChange({ ...p, at: index })) applied += 1; }
        else if (p.kind === 'item' && auto.items) { if (s.applyItemChange({ ...p, at: index })) applied += 1; }
        else left.push(p);
      } catch (e) { report('автоприменение', e); left.push(p); }
    }
    // Око отмечено в кадре, а модель наблюдения не вернула (или запрос не удался): записываем сказанное игроком, чтобы запись не потерялась
    let eyeNote = '';
    if (watch?.sure && cfg.know && auto.know) {
      if (eyeDone) eyeNote = ' · Око: записано';
      else {
        try {
          const who = findWatcher(s.get().people, watch.watcherName);
          const persona = s.get().cast.find(p => p.persona)?.name ?? '';
          const line = eyeFallbackLine(userTextBefore(index), persona);
          if (who && line && s.applyKnowledgeChange({ watch: { text: line, watcherId: who.id }, label: 'Око: запись по словам игрока (модель ничего не вернула)', at: index })) { applied += 1; eyeNote = ' · Око: запись по словам игрока (модель наблюдения не вернула)'; }
          else eyeNote = ' · Око: нечего записать';
        } catch (e) { report('запасная запись Ока', e); eyeNote = ' · Око: ошибка записи'; }
      }
    } else if (watch && !watch.sure) eyeNote = eyeDone ? ' · Око: записано' : ' · Око упомянуто, но модель не сочла его рядом';
    // новые предложения этого ответа заменяют старые от него же (свайп, повторный запуск)
    proposals = [...proposals.filter(p => p.at !== index), ...left.map(p => ({ ...p, id: `p${++serial}`, at: index }))];
    busy = false;
    runs.set(index, { tasks: ranTasks.map(t => TASK_RU[t]), requests: requestsMade, applied, pending: left.length, ms: Date.now() - started, error: failures.join('; '), at: Date.now() });
    error = failures.join('; ');
    trace(index, { state: failures.length ? 'с ошибкой' : 'готово', applied, pending: left.length, requests: requestsMade, ms: Date.now() - started, error: failures.join('; ').slice(0, 300), eye: eyeNote.replace(/^ · /, '') || undefined });
    note = `Ответ ${index + 1}: применено ${applied}, ждёт решения ${left.length} (${((Date.now() - started) / 1000).toFixed(1)} с)${eyeNote}`;
    notify();
    if (queued) { const next = queued; queued = null; run(next.index, { force: next.force }); }
    return true;
  }

  function apply(id) {
    const p = proposals.find(x => x.id === id);
    const s = scene();
    if (!p || !s) return false;
    let ok = false;
    try {
      if (p.kind === 'entry') ok = s.addEntry(p.questId, p.text);
      else if (p.kind === 'lead') { s.setLeadState(p.questId, p.leadId, p.state); if (p.note) s.setLeadNote(p.questId, p.leadId, p.note); ok = true; }
      else if (p.kind === 'quest') {
        const qid = s.addQuest({ title: p.title, goal: p.goal });
        if (qid) { p.leads.forEach(t => s.addLead(qid, t)); ok = true; }
      } else if (p.kind === 'moment') {
        ok = Boolean(s.applyMoment({ ...p, at: p.at }));
      } else if (p.kind === 'know') {
        ok = Boolean(s.applyKnowledgeChange({ ...p, at: p.at }));
      } else if (p.kind === 'place') {
        ok = Boolean(s.applyPlaceChange({ ...p, at: p.at }));
      } else if (p.kind === 'body') {
        ok = Boolean(s.applyBodyChange({ ...p, at: p.at }));
      } else if (p.kind === 'item') {
        ok = Boolean(s.applyItemChange({ ...p, at: p.at }));
      } else if (p.kind === 'newperson') {
        ok = Boolean(s.applyNewPerson({ ...p, at: p.at }));
      } else if (p.kind === 'arrive' || p.kind === 'leave') {
        ok = Boolean(s.applyCastChange({ personId: p.personId, present: p.kind === 'arrive', at: p.at, label: p.label }));
      } else if (p.kind === 'rel') {
        const lid = s.addLine(p.fromId, p.toId);
        if (lid) {
          const line = s.get().relations.lines.find(l => l.id === lid);
          s.setScale(lid, p.scale, (line?.scales?.[p.scale] ?? 0) + p.delta);
          if (p.memory) s.addRecord(lid, 'memories', p.memory, 3);
          ok = true;
        }
      }
    } catch (e) { report('применение предложения Архивариуса', e); }
    if (ok) proposals = proposals.filter(x => x.id !== id);
    else error = 'Не вышло записать: квеста или человека уже нет.';
    notify();
    return ok;
  }
  const dismiss = id => { proposals = proposals.filter(x => x.id !== id); notify(); };
  const applyAll = () => { for (const p of [...proposals]) apply(p.id); };
  const clear = () => { proposals = []; note = ''; error = ''; notify(); };

  const setAux = patch => { settings.aux = { ...settings.aux, ...patch }; deps.save(); notify(); };
  const setChronicle = patch => { settings.chronicle = { ...settings.chronicle, ...patch }; deps.save(); notify(); };
  const test = async () => { try { return await testLink(ctx(), settings.aux); } catch (e) { return { ok: false, text: String(e?.message ?? e), ms: 0 }; } };
  const models = () => fetchModels(ctx(), settings.aux.url, settings.aux.key);
  /** Берёт настройки подключения из Кулис по нажатию пользователя; ключ нигде не показывается. */
  const copyFromKulisy = () => {
    const aux = ctx().extensionSettings?.kulisy?.aux;
    if (!aux || !['profile', 'custom'].includes(aux.mode)) return false;
    setAux({ mode: aux.mode, profileId: aux.profileId ?? '', url: aux.url ?? '', key: aux.key ?? '', model: aux.model ?? '', maxTokens: Math.min(Number(aux.maxTokens) || 4096, 32000), fallbackToMain: Boolean(aux.fallbackToMain) });
    return true;
  };

  // ---------- события Таверны ----------
  const undo = [];
  const on = (name, fn) => {
    const c = ctx();
    const type = c.eventTypes?.[name];
    if (!type) return;
    c.eventSource.on(type, fn);
    undo.push(() => c.eventSource.removeListener(type, fn));
  };
  on('MESSAGE_RECEIVED', index => {
    try {
      const message = ctx().chat?.[index];
      if (!message || message.is_user || message.is_system) return;
      if (!ready() || !settings.chronicle?.auto) { trace(index, { state: 'пропущен', why: !ready() ? 'модель не настроена или расширение выключено' : 'автозапуск выключен' }); return; }
      run(index);
    } catch (e) { report('автозапуск Архивариуса', e); }
  });
  // свайп или правка ответа снимает то, что из него вышло; удаление ответов снимает всё, что от них зависело
  const rollback = fn => { try { if (scene()?.get().hasChat) fn(); } catch (e) { report('откат автоматических правок', e); } };
  // Другие расширения (Guided Generations и подобные) после генерации сами шлют «свайп» и «правка» по тому же ответу, не меняя текст.
  // Откат нужен, только если текст ответа действительно стал другим, чем тот, который разбирал Архивариус.
  const guardedRollback = (kind, rawIndex) => {
    const index = Number(rawIndex);
    if (!Number.isInteger(index)) return;
    const row = (ctx().chatMetadata?.sceneJournalRuns ?? []).find(r => r.index === index);
    const now = textHash(String(ctx().chat?.[index]?.mes ?? ''));
    if (row && row.h !== undefined && row.h === now) { trace(index, { signal: `${kind}: текст не менялся, откат не нужен` }); return; }
    trace(index, { rollback: `${kind}: текст ответа изменился` });
    rollback(() => scene().revertAt(index));
  };
  on('MESSAGE_SWIPED', index => guardedRollback('свайп', index));
  on('MESSAGE_EDITED', index => guardedRollback('правка', index));
  on('MESSAGE_DELETED', length => { const from = Number(length) || (ctx().chat?.length ?? 0); trace(from, { rollback: `удаление сообщений с № ${from}` }); rollback(() => scene().revertFrom(from)); });
  on('CHAT_CHANGED', () => {
    if (currentKey() !== chatKey) { chatKey = currentKey(); proposals = []; note = ''; error = ''; queued = null; notify(); }
  });
  chatKey = currentKey();

  const api = { get, history, run, apply, dismiss, applyAll, clear, setAux, setChronicle, test, models, copyFromKulisy, lastReplyIndex, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  shared.chronicle = api;
  return () => {
    for (const fn of undo.reverse()) { try { fn(); } catch (e) { report('откат Архивариуса', e); } }
    listeners.clear();
    delete shared.chronicle;
  };
}
