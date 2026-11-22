/**
 * «Запросы и ошибки» для вкладки «Данные» в настройках: куда расширение посылает запросы, чем они кончились и какие
 * запросы к моделям вообще уходили с этой страницы (основной пост, фоновые от других расширений, наш Архивариус).
 * Так видно, чьи запросы получили «Too Many Requests». Основную модель мы трогаем только запасным путём.
 */
import { esc } from './dom.js';
import { blockStats } from '../core/scene-text.js';

const clock = at => new Date(at).toLocaleTimeString('ru-RU');
const bad = text => `<span style="color:#d98a4a">${text}</span>`;

/** Запросы нашего Архивариуса (вспомогательная модель) и вывод, мы ли виноваты. */
function ownHtml(ch) {
  const log = ch?.requests ?? [];
  const recent = log.filter(r => r.at >= Date.now() - 10 * 60 * 1000);
  const main = recent.filter(r => r.main).length, limits = recent.filter(r => r.limit).length;
  const last = log.at(-1);
  const ago = last ? `последний был в ${clock(last.at)}` : 'их ещё не было';
  const verdict = !recent.length ? `За последние 10 минут расширение не отправляло запросов (${ago}): плашка «Too Many Requests» в это время к нему не относится.`
    : main ? `Основной модели расширение за 10 минут коснулось ${main} раз (запасной путь): это могло добавить нагрузки.`
      : `Основную модель расширение не трогало: все ${recent.length} запросов за 10 минут ушли на вспомогательную${limits ? `, из них с лимитом: ${limits}` : ''}.`;
  const lines = log.slice(-8).reverse().map(r => `<tr><td>${clock(r.at)}</td><td>${esc(r.where)}</td><td>${r.ok ? 'ок' : r.limit ? bad('лимит (429)') : bad('ошибка')}</td><td>${(r.ms / 1000).toFixed(1)} с</td></tr>`).join('');
  return `<div class="sj-sub" style="margin-bottom:6px">${esc(verdict)}</div>
    ${lines ? `<table class="sj-hist"><thead><tr><th>Время</th><th>Куда</th><th>Итог</th><th>Длилось</th></tr></thead><tbody>${lines}</tbody></table>` : ''}`;
}

/** Все запросы к моделям, ушедшие с этой страницы. */
function watchHtml(shared) {
  const all = shared.watch?.get() ?? [];
  if (!all.length) return '<div class="sj-sub" style="margin-top:10px">С момента загрузки страницы запросов к моделям ещё не было.</div>';
  const limited = all.filter(r => r.status === 429);
  const byKind = {};
  for (const r of limited) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const verdict = limited.length ? `«Too Many Requests» (429) получили: ${Object.entries(byKind).map(([k, n]) => `${k} ×${n}`).join(', ')}.` : 'Запросов с ошибкой 429 пока не было.';
  const state = r => (r.status === 429 ? bad('429 слишком много запросов') : r.status === 0 ? 'ждёт ответа…' : r.status >= 400 || r.status < 0 ? bad(`ошибка ${r.status}`) : 'ок');
  const lines = all.slice(-14).reverse().map(r => `<tr><td>${clock(r.at)}</td><td>${esc(r.kind)}</td><td>${esc(r.host)}${r.model ? `, ${esc(r.model)}` : ''}</td><td>≈${r.tokens} ток.</td><td>${state(r)}</td><td>${(r.ms / 1000).toFixed(1)} с</td></tr>`).join('');
  return `<div class="sj-lbl" style="margin-top:14px">Все запросы к моделям с этой страницы</div>
    <div class="sj-sub" style="margin-bottom:6px">${esc(verdict)} «Основной пост» это самый большой запрос; «фоновый» это запросы Кулис и других расширений; «наш Архивариус» уходит на вспомогательный адрес.</div>
    <table class="sj-hist"><thead><tr><th>Время</th><th>Чей</th><th>Куда</th><th>Размер</th><th>Итог</th><th>Длилось</th></tr></thead><tbody>${lines}</tbody></table>`;
}

/** Что расширение изменило само по ходу игры (с кнопкой «отменить»): отношения, раны, вещи, место, знания. */
export function changesHtml(info) {
  const entries = [...(info.relations?.log ?? [])].reverse().slice(0, 12);
  if (!entries.length) return '<div class="sj-lbl">Что изменилось само</div><div class="sj-sub">Пока ничего: Архивариус ещё ничего не записывал.</div>';
  return `<div class="sj-tell"><div class="sj-lbl">Что изменилось само · ${entries.length}</div><ul class="sj-rl">${entries.map(e => `<li><span class="t"><small>ответ ${e.at + 1}</small> ${esc(e.label || '—')}</span><button class="sj-st" data-undo="${esc(e.id)}" title="Вернуть как было">отменить</button></li>`).join('')}</ul></div>`;
}

/**
 * Что уйдёт рассказчику с ближайшим ответом: весь блок сцены целиком с весом в токенах и разбивкой «из чего это»,
 * а ниже строки только о тех, кто в кадре (состав, раны, вещи).
 */
export function sentHtml(info, settings, shared) {
  const block = String(info.block ?? '');
  const tokens = Math.ceil(block.length / 3.2);
  const sentNow = settings.enabled && settings.sendBlock && info.initialized;
  const cards = shared?.cards?.get();
  const rows = blockStats(block).map(r => `${esc(r.label)} ${Math.round(r.chars / 3)}`).join(' · ');
  const scene = block.split('\n').filter(l => l.startsWith('present:') || l.startsWith('body[') || l.startsWith('inventory['));
  // метка лежит внутри блока: оболочка окна превратит его в раскрывающийся (здесь, на вкладке «Данные», он открыт по умолчанию)
  return `<div class="sj-tell" data-open="1"><div class="sj-lbl">${sentNow ? 'Уйдёт рассказчику' : 'Не отправляется'} · около ${tokens} токенов</div>
      <pre style="max-height:360px;overflow:auto">${esc(block)}</pre>
      <div class="sj-sub" style="margin-top:6px">Из чего это (токены, примерно): ${rows}${cards && cards.sentTokens ? ` · анкеты (отдельный блок) ${cards.sentTokens}` : ''}</div>
      ${info.initialized ? '' : '<div class="sj-sub">Состояние в этом чате ещё не создано: блок начнёт отправляться после первого действия или ответа.</div>'}</div>
    <div class="sj-tell" data-open="1"><div class="sj-lbl">Только те, кто в кадре</div>
      <pre>${esc(scene.join('\n') || '(пока ничего: никто не отмечен в кадре или у всех всё в порядке)')}</pre></div>`;
}

/** Блок целиком: последняя ошибка Архивариуса, его запросы, общая таблица. */
export function diagnosticsHtml(shared) {
  const ch = shared.chronicle?.get();
  const error = ch?.error ? `<div class="sj-sub" style="color:#d98a4a;margin-bottom:8px"><b>Последняя ошибка Архивариуса:</b> ${esc(ch.error)}</div>` : '<div class="sj-sub" style="margin-bottom:8px">Ошибок Архивариуса нет.</div>';
  // свёрнуто по умолчанию (оболочка окна делает из .sj-tell раскрывающийся блок); при ошибке Архивариуса открыто
  return `<div class="sj-tell"${ch?.error ? ' data-open="1"' : ''}><div class="sj-lbl">Запросы и ошибки${ch?.error ? ' · есть ошибка' : ''}</div>${error}${ownHtml(ch)}${watchHtml(shared)}</div>`;
}
