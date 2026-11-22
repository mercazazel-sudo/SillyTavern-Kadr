import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDigestSettings, pickBatch, cutCount, buildSummaryRequest, parseSummary, summaryBlock, rewindSnapshots } from '../src/core/digest.js';

const mk = n => Array.from({ length: n }, (_, i) => ({ name: i % 2 ? 'Нарратор' : 'Игрок', is_user: i % 2 === 0, mes: `сообщение ${i}`, send_date: `d${i}` }));

test('настройки сжатия приводятся к допустимым', () => {
  assert.deepEqual(cleanDigestSettings(undefined), { enabled: true, keep: 6, batch: 6, words: 350, markHidden: true });
  assert.deepEqual(cleanDigestSettings({ enabled: false, keep: 1, batch: 99, words: 'x' }), { enabled: false, markHidden: true, keep: 2, batch: 30, words: 350 });
});

test('пачка для сжатия: после уже сжатого, без последних keep, не дальше неразобранного ответа', () => {
  const chat = mk(20);
  assert.deepEqual(pickBatch({ chat, upto: -1, keep: 6, batch: 6 }), Array.from({ length: 14 }, (_, i) => i));
  assert.deepEqual(pickBatch({ chat, upto: 9, keep: 6, batch: 4 }), [10, 11, 12, 13]);
  assert.equal(pickBatch({ chat, upto: 9, keep: 6, batch: 5 }), null);                           // пачка ещё не набралась
  const runs = [{ index: 5, state: 'идёт' }];
  assert.deepEqual(pickBatch({ chat, upto: -1, keep: 6, batch: 3, runs }), [0, 1, 2, 3, 4]);   // на ответе 5 остановились
  assert.equal(pickBatch({ chat, upto: -1, keep: 6, batch: 6, runs }), null);
  assert.ok(pickBatch({ chat, upto: -1, keep: 6, batch: 6, runs: [{ index: 5, state: 'готово' }, { index: 7, state: 'пусто' }] }));
});

test('системные сообщения не считаются', () => {
  const chat = mk(12); chat[3].is_system = true; chat[4].is_system = true;
  const got = pickBatch({ chat, upto: -1, keep: 6, batch: 2 });
  assert.ok(!got.includes(3) && !got.includes(4));
  assert.equal(got.length, 4);
});

test('вырезание из запроса: только то, что в сводке, последние keep остаются, несовпадение даёт ноль', () => {
  const chat = mk(12);
  const core = chat.map(m => ({ ...m }));
  assert.equal(cutCount({ coreChat: core, chat, upto: 5, keep: 6 }), 6);
  assert.equal(cutCount({ coreChat: core, chat, upto: 99, keep: 6 }), 6);                        // последние 6 остаются в любом случае
  assert.equal(cutCount({ coreChat: core, chat, upto: -1, keep: 6 }), 0);
  assert.equal(cutCount({ coreChat: core.slice(1), chat, upto: 5, keep: 6 }), 0);              // длины не сходятся
  assert.equal(cutCount({ coreChat: core.slice(0, -1), chat, upto: 5, keep: 6 }), 5);          // свайп: последнее сообщение отброшено
  const bad = core.map(m => ({ ...m })); bad[2].send_date = 'иначе';
  assert.equal(cutCount({ coreChat: bad, chat, upto: 5, keep: 6 }), 0);                         // даты не сошлись: не режем
});

test('запрос и разбор сводки', () => {
  const req = buildSummaryRequest({ prev: 'Было.', messages: [{ name: 'Лилит', isUser: true, text: 'Привет' }], dateLabel: '22 Элесиас', words: 200 });
  assert.equal(req[0].role, 'system'); assert.match(req[0].content, /200 words/); assert.match(req[1].content, /PREVIOUS SUMMARY:\nБыло\./); assert.match(req[1].content, /\[Лилит\]: Привет/);
  assert.equal(parseSummary({ summary: '  Текст.\n\n\n\nЕщё.  ' }), 'Текст.\n\nЕщё.');
  assert.equal(parseSummary({}), '');
  assert.ok(parseSummary({ summary: 'слово '.repeat(2000) }, { maxChars: 100 }).length <= 100);
  assert.equal(summaryBlock(''), ''); assert.match(summaryBlock('Факт.'), /Story so far[\s\S]*Факт\./);
});

test('откат сводки к снимку, который ещё не включал изменённое сообщение', () => {
  const d = { text: 'C', upto: 30, snaps: [{ upto: -1, text: '' }, { upto: 10, text: 'A' }, { upto: 20, text: 'B' }] };
  assert.deepEqual(rewindSnapshots(d, 15), { upto: 10, text: 'A', snaps: [{ upto: -1, text: '' }, { upto: 10, text: 'A' }] });
  assert.deepEqual(rewindSnapshots(d, 5), { upto: -1, text: '', snaps: [{ upto: -1, text: '' }] });
  assert.equal(rewindSnapshots(d, 31), null);
  assert.deepEqual(rewindSnapshots({ text: 'X', upto: 9, snaps: [] }, 3), { upto: -1, text: '', snaps: [] });
});
