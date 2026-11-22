import test from 'node:test';
import assert from 'node:assert/strict';
import { startDigest } from '../extension/src/digest-service.js';

function setup({ n = 20, runs = [], reply = '{"summary":"Они встретились. Лилит согласилась помочь."}' } = {}) {
  const chat = Array.from({ length: n }, (_, i) => ({ name: i % 2 ? 'Нарратор' : 'Лилит', is_user: i % 2 === 0, mes: `сообщение ${i}`, send_date: `d${i}` }));
  const prompts = {}; const handlers = {}; const requests = [];
  const context = {
    chat, chatId: 'c1', chatMetadata: { sceneJournalRuns: runs },
    eventTypes: { MESSAGE_RECEIVED: 'mr', CHAT_CHANGED: 'cc', MESSAGE_EDITED: 'me', MESSAGE_SWIPED: 'ms', MESSAGE_DELETED: 'md' },
    eventSource: { on: (t, f) => { (handlers[t] ??= []).push(f); }, removeListener() {} },
    setExtensionPrompt: (k, text, pos, depth) => { prompts[k] = { text, depth }; },
    saveMetadataDebounced() {},
    executeSlashCommands: async cmd => { const m = /^\/(hide|unhide) (\d+)(?:-(\d+))?$/.exec(cmd); if (!m) return; for (let i = Number(m[2]); i <= Number(m[3] ?? m[2]); i++) chat[i].is_system = m[1] === 'hide'; },
    ConnectionManagerRequestService: { sendRequest: async (_id, messages) => { requests.push(messages); return { content: reply }; } },
  };
  globalThis.SillyTavern = { getContext: () => context };
  const settings = { enabled: true, aux: { mode: 'profile', profileId: 'p', maxTokens: 4096, minGapMs: 0 }, digest: { enabled: true, keep: 6, batch: 6, words: 350 } };
  const shared = { scene: { get: () => ({ hasChat: true, date: { name: '22 Элесиас', year: 1492, era: 'ЛД' } }) }, chronicle: { get: () => ({ busy: false }), subscribe: () => () => {} } };
  const stop = startDigest({ settings, shared, save() {} });
  return { context, settings, shared, prompts, requests, stop, chat };
}

test('сжатие: пачка разобранных сообщений превращается в сводку, блок встаёт на глубину keep, запрос урезается', async () => {
  const s = setup();
  s.settings.digest.markHidden = false;                                       // здесь проверяем именно вырезание из запроса, без флага «скрыто»
  const ok = await s.shared.digest.run();
  assert.equal(ok, true);
  const g = s.shared.digest.get();
  assert.equal(g.upto, 13);                                                  // 20 сообщений минус последние 6
  assert.match(g.text, /Лилит согласилась/);
  assert.equal(s.prompts.sj_digest.depth, 6);
  assert.match(s.prompts.sj_digest.text, /Story so far/);
  assert.equal(s.requests.length, 1);
  // перехватчик режет копию запроса
  const core = s.chat.map(m => ({ ...m }));
  await globalThis.sceneJournalIntercept(core, 8000, () => {}, 'normal');
  assert.equal(core.length, 6);
  assert.equal(core[0].mes, 'сообщение 14');
  assert.equal(s.shared.digest.get().lastCut.n, 14);
  // тихие генерации (другие расширения) не режем
  const core2 = s.chat.map(m => ({ ...m }));
  await globalThis.sceneJournalIntercept(core2, 8000, () => {}, 'quiet');
  assert.equal(core2.length, 20);
  s.stop();
  assert.equal(globalThis.sceneJournalIntercept, undefined);
});

test('без сводки или при выключенном сжатии запрос не режется; неразобранный ответ тормозит сжатие', async () => {
  const s = setup();
  const core = s.chat.map(m => ({ ...m }));
  await globalThis.sceneJournalIntercept(core, 8000, () => {}, 'normal');
  assert.equal(core.length, 20);
  s.stop();
  const s2 = setup({ runs: [{ index: 1, state: 'идёт' }] });
  assert.equal(await s2.shared.digest.run(), false);                         // на ответе 1 Архивариус ещё не закончил: пачки нет
  assert.equal(s2.requests.length, 0);
  s2.stop();
});

test('откат при правке сообщения внутри сводки и сброс', async () => {
  const s = setup();
  await s.shared.digest.run();
  const edited = s.context.chatMetadata.sceneJournalDigest;
  assert.equal(edited.upto, 13);
  // MESSAGE_EDITED приходит с номером сообщения
  s.shared.digest.reset();
  assert.equal(s.shared.digest.get().upto, -1);
  assert.equal(s.prompts.sj_digest.text, '');
  s.stop();
});

test('глубокое сжатие сводки с отменой', async () => {
  const s = setup({ reply: '{"summary":"Они встретились и договорились. Потом был бой, Лилит ранена, но победила. Дальше путь на север."}' });
  await s.shared.digest.run();
  s.context.chatMetadata.sceneJournalDigest.text = 'слово '.repeat(200).trim();
  const before = s.shared.digest.get().words;
  assert.equal(before, 200);
  assert.equal(await s.shared.digest.condense(), true);
  const g = s.shared.digest.get();
  assert.ok(g.words < before && g.canUndo);
  assert.match(s.requests.at(-1)[0].content, /at most 100 words/);
  assert.equal(s.shared.digest.undoCondense(), true);
  assert.equal(s.shared.digest.get().words, 200);
  s.stop();
});

const settle = () => new Promise(r => setTimeout(r, 20));
test('сжатые сообщения получают флаг «скрыто»; своё скрытое не трогается; сброс возвращает только наше', async () => {
  const s = setup();
  s.chat[3].is_system = true;                                                  // пользователь скрыл сам
  await s.shared.digest.run(); await settle();
  assert.equal(s.chat.slice(0, 14).every(m => m.is_system), true);
  assert.equal(s.chat.slice(14).some(m => m.is_system), false);               // последние 6 видны
  assert.equal(s.context.chatMetadata.sceneJournalDigest.hidden.includes(3), false);
  s.shared.digest.setUpto(6); await settle();                                  // граница сдвинута назад: 0-5 скрыты, остальные вернулись
  assert.equal(s.chat.slice(0, 6).every(m => m.is_system), true);
  assert.equal(s.chat.slice(6).some((m, i) => m.is_system && i + 6 !== 3), false);
  assert.equal(s.chat[3].is_system, true);
  s.shared.digest.setOption({ markHidden: false }); await settle();
  assert.equal(s.chat.filter((m, i) => m.is_system && i !== 3).length, 0);     // выключили: наше снято, скрытое пользователем осталось
  assert.equal(s.chat[3].is_system, true);
  s.stop();
});
