/**
 * Строка сцены: тонкая скруглённая полоса над рамкой поля ввода, на том же месте в #form_sheld,
 * где Таверна показывает плашки сцены (прямой потомок #form_sheld перед #send_form). Клик открывает окно «Обстановка».
 */
import { report } from '../guard.js';
import { esc, waitFor } from './dom.js';
import { heatPending, modesOf } from '../core/fate.js';
import { D20_SVG } from './d20-icon.js';
import { themeFor } from './theme.js';
import { rollCheckWithDice } from './dice-roll.js';
import { personaPhoto as personaPhotoByName } from './photo.js';
import { formatTime, partOfDay } from '../core/clock.js';
import { KINDS, describeWeather } from '../core/weather.js';
import { FEATURES } from '../core/features.js';
import { createShade, partIcon, shortDate } from './shade.js';
import { onMobileChange } from './mobile.js';

export async function startStrip(deps) {
  const { settings, shared } = deps;
  const send = await waitFor('#send_form');
  const host = send?.parentElement;
  if (!send || !host) { report('строка', new Error('#send_form не найден')); return null; }

  const strip = document.createElement('div');
  strip.id = 'sj-strip';
  strip.setAttribute('role', 'button');
  strip.tabIndex = 0;
  strip.setAttribute('aria-label', 'Открыть окно «Обстановка»');
  host.insertBefore(strip, send);   // сразу над рамкой поля ввода, под плашками других расширений

  const shade = createShade({ strip, shared, settings });
  const stopMobile = onMobileChange(on => { if (on) strip.dataset.mobile = '1'; else { delete strip.dataset.mobile; shade.close(); } });
  let lastHtml = '';
  function render(info = shared.scene?.get()) {
    const visible = settings.enabled && settings.strip && info?.hasChat;
    strip.hidden = !visible;
    if (!visible) return;
    const { time, date, state } = info;
    const part = partOfDay(time.minutes);
    const place = state.place ? state.place.split('›').map(s => s.trim()).filter(Boolean) : [];
    const here = place.length ? place[place.length - 1] : '';
    const holiday = date.holidays.length ? `<span class="sj-hol" title="${esc(date.holidays.map(h => h.ru).join('; '))}">◆</span>` : '';
    // счётчик дней истории: Д1, Д2, Д3…
    const dayBadge = date.storyDay != null && settings.dayCounter ? `<span class="sj-dayn" title="День истории ${date.storyDay}">Д${date.storyDay}</span>` : '';
    const t = info.tension;
    const tension = t ? `<span class="sj-ten" style="--tc:${esc(t.color)}" title="Напряжение: ${esc(t.ru)}"><i aria-hidden="true"></i><span>${esc(t.ru)}</span></span>` : '';
    const pending = Boolean(info.letter);
    const envelope = `<span class="sj-env${pending ? ' sj-pending' : ''}" role="button" tabindex="0" data-env="1" title="${pending ? 'Секретное письмо ждёт следующего ответа' : 'Секретное письмо рассказчику'}" aria-label="Секретное письмо${pending ? ', ждёт следующего ответа' : ''}">✉${pending ? '<i class="sj-envdot"></i>' : ''}</span>`;
    const w = info.weather;
    const weather = w ? `<span class="sj-vs"></span><span class="sj-wxs" title="${esc(describeWeather(w))}"><span aria-hidden="true">${(KINDS[w.kind] ?? KINDS.clear).icon}</span> ${Number.isFinite(w.tempC) ? (w.tempC > 0 ? '+' : '') + w.tempC + '°' : esc((KINDS[w.kind] ?? KINDS.clear).ru)}</span>` : '';
    const tq = (info.quests ?? []).find(q => q.tracked);
    const trk = tq ? `<span class="sj-vs"></span><span class="sj-trk" title="Квест: ${esc(tq.title)}">◆ ${esc(tq.title)}</span>` : '';
    const cp = shared.chronicle?.get();
    const chron = cp && cp.ready ? `<span class="sj-chr${cp.proposals.length ? ' has' : ''}${cp.busy ? ' busy' : ''}" role="button" tabindex="0" data-chr="1" title="${cp.busy ? 'Архивариус разбирает ответ…' : cp.proposals.length ? 'Предложений Архивариуса: ' + cp.proposals.length : 'Архивариус'}" aria-label="Архивариус">✍${cp.proposals.length ? `<b>${cp.proposals.length}</b>` : ''}</span>` : '';
    const fmMode = info.fate?.mode ? (info.fate.mode === 'intimacy' ? { icon: '💕', ru: 'Интим' } : modesOf(info.fate.set).find(m => m.id === info.fate.mode)) : null;
    const fm = fmMode ? `${fmMode.icon} ${fmMode.ru}` : '';
    const fatePending = Boolean(info.fate && ((info.fate.event && !info.fate.event.sent) || heatPending(info.fate.heat)));
    const mode = fm || fatePending ? `<span class="sj-md${fatePending ? ' pend' : ''}" role="button" tabindex="0" data-fate="1" title="d20 жизни${fatePending ? ': подсказка ждёт следующего ответа' : ''}">${fm ? `<span class="sj-mi">${esc(fmMode.icon)}</span><span class="sj-mw"> ${esc(fmMode.ru)}</span>` : D20_SVG}${fatePending && fm ? ' •' : ''}</span>` : '';
    const diceBtn = FEATURES.fate && !mode ? `<span class="sj-md sj-md0" role="button" tabindex="0" data-fate="1" title="d20 жизни">${D20_SVG}</span>` : '';
    const triP = shared.triage?.get().pending[0];
    const trg = triP ? `<span class="sj-trg" role="button" tabindex="0" data-trg="1" title="Лорбук «${esc(triP.book)}»: новые записи (${triP.fresh}). Разобрать по людям и местам" aria-label="Разобрать лорбук">📖</span>` : '';
    const pmis = info.personaMismatch ? `<span class="sj-pw" role="button" tabindex="0" data-pw="1" title="В Таверне персона «${esc(info.personaMismatch.tavern)}», а в чате привязана «${esc(info.personaMismatch.bound)}». Нажмите, чтобы выбрать.">⚠ персона</span>` : '';
    // фото персоны из Таверны: выбранная персона в списке персон, иначе аватар последнего её сообщения
    const personaPhoto = () => {
      try {
        const id = document.querySelector('#user_avatar_block .avatar-container.selected')?.getAttribute('data-avatar-id');
        if (id) return `/thumbnail?type=persona&file=${encodeURIComponent(id)}`;
        const last = [...document.querySelectorAll('#chat .mes[is_user="true"] .avatar img')].pop();
        return last?.getAttribute('src') || '';
      } catch { return ''; }
    };
    // круглые аватарки тех, кто в кадре: фото из анкеты, а если его нет, кружок с буквой
    const cardsData = shared.cards?.get();
    const photoOf = new Map((cardsData?.cards ?? []).filter(c => c.person && c.image).map(c => [c.person.id, c.image]));
    const goneIds = info.knowledge?.deaths ?? {};
    const inScene = [...(info.cast ?? []).filter(p => p.present && !goneIds[p.id]).sort((a, b) => Number(a.persona) - Number(b.persona)), ...(info.cast ?? []).filter(p => goneIds[p.id])];   // умершие в конце, серые
    const shown = inScene.slice(0, 7);
    const avatars = shown.length ? `<span class="sj-avs" role="group" aria-label="В кадре">${shown.map(p => {
      const img = photoOf.get(p.id) || (p.persona ? (personaPhotoByName(p.name) || personaPhoto()) : '');
      return `<span class="sj-av${p.persona ? ' me' : ''}${goneIds[p.id] ? ' dead' : ''}" role="button" tabindex="0" data-av="${esc(p.id)}" title="${esc(p.name)}${p.persona ? ' (вы)' : ''}${goneIds[p.id] ? ' (умер)' : ''}">${img ? `<img src="${esc(img)}" alt="">` : `<b>${esc(String(p.name).trim().charAt(0).toUpperCase())}</b>`}</span>`;
    }).join('')}${inScene.length > shown.length ? `<span class="sj-av more" title="${esc(inScene.slice(7).map(p => p.name).join(', '))}">+${inScene.length - 7}</span>` : ''}</span>` : '';
    const restPending = Boolean(info.fate?.event && info.fate.event.kind === 'nudge' && !info.fate.event.sent && info.fate.event.label === 'Привал');
    const camp = `<span class="sj-camp${restPending ? ' on' : ''}" role="button" tabindex="0" data-camp="1" aria-label="Привал" title="${restPending ? 'Привал предложен: уйдёт рассказчику с ближайшим ответом' : 'Привал: рассказчик намекнёт, что компаньоны сами предлагают передохнуть (один раз). Персону не принуждают.'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 21l14.400-3.800M4.800 17.400l14.400 3.800" stroke="#7a5a44" stroke-width="2.200" stroke-linecap="round" fill="none"/><path d="M12 2.2c.8 3.300-1.800 4.800-3 6.900C8 10.600 7 12 7 14.200c0 2.900 2.200 5 5 5s5-2.100 5-5c0-2.600-1.500-4.200-2.600-5.800-.4 1.100-1 1.800-1.800 2.200.4-3.200-.1-6.200-.6-8.400z" fill="#f5a23c"/><path d="M12 8.800c.4 2.100-2.500 3.500-2.500 5.700 0 1.700 1.100 2.900 2.500 2.900s2.500-1.200 2.500-2.900c0-1.800-1.400-2.700-2.500-5.700z" fill="#fcd55e"/><path d="M12 12.800c.3 1-1.100 1.800-1.100 2.900 0 .8.5 1.300 1.100 1.300s1.100-.5 1.100-1.300c0-1-.8-1.500-1.100-2.900z" fill="#fff3d4"/></svg></span>`;
    const intimate = info.fate?.mode === 'intimacy' || Boolean(info.fate?.heat);
    const chk = intimate ? null : info.fate?.check;               // в интимной сцене d20 не показывается
    const OUT = { dodge: ['уворот', 'ok'], 'crit-dodge': ['идеальный уворот', 'ok'], hit: ['ранен', 'bad'], 'crit-hit': ['тяжело ранен', 'bad'], success: ['удалось', 'ok'], 'crit-success': ['блестяще', 'ok'], fail: ['не удалось', 'bad'], 'crit-fail': ['провал', 'bad'] };
    const dice = chk && !chk.roll ? `<span class="sj-dice" role="button" tabindex="0" data-dice="1" title="${chk.kind === 'skill' ? `Бросить d20: меньше ${chk.dc} значит не вышло, не меньше значит удалось. ${esc(chk.label)}` : `Бросить d20: меньше ${chk.dc} значит ранят, не меньше значит увернулись; 1 это тяжёлая рана. ${esc(chk.label)}`}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M12 7.2l4.6 8H7.4z"/><path d="M12 2.5v4.7M20.2 7.25L12 7.2M3.8 7.25L12 7.2M20.2 7.25l-3.6 7.95M3.8 7.25l3.6 7.95M20.2 16.75l-3.6-1.55M3.8 16.75l3.6-1.55M12 21.5l4.6-6.3M12 21.5l-4.6-6.3"/></svg><b>${chk.dc}</b>${chk.mode === 'advantage' ? '<i title="преимущество">▲</i>' : chk.mode === 'disadvantage' ? '<i title="помеха">▼</i>' : ''}<span>бросить куб</span></span>`
      : chk?.roll ? `<span class="sj-dres ${OUT[chk.roll.outcome][1]}" title="${esc(chk.label)}: сложность ${chk.dc}, выпало ${chk.roll.roll}${chk.roll.dice.length > 1 ? ` (${chk.roll.dice.join(', ')})` : ''}">${D20_SVG} ${chk.roll.roll} · ${OUT[chk.roll.outcome][0]}</span>` : '';
    const html = `<span class="sj-t">${formatTime(time.minutes)}</span><span class="sj-pe" title="${part}">${partIcon(part)}</span><span class="sj-ds">${esc(shortDate(date.name))}</span><span class="sj-part" data-p="${part}">${part}</span>
      <span class="sj-vs"></span><span class="sj-d">${dayBadge}${esc(date.name)}<span class="sj-sub"> · ${date.year} ${esc(date.era)}</span>${holiday}</span>${weather}
      <span class="sj-vs"></span><span class="sj-place${here ? '' : ' sj-none'}">${here ? esc(here) : 'место не задано'}</span>${avatars}
      ${trg}${pmis}${dice}${trk}${mode}${diceBtn}${tension}${chron}${envelope}${camp}
      <span class="sj-open" aria-hidden="true">▾</span>`;
    strip.dataset.world = state.calendar;
    strip.dataset.cal = themeFor(state.calendar);
    if (html !== lastHtml) { strip.innerHTML = html; lastHtml = html; }
  }

  // клик по конверту открывает секретное письмо, по остальной строке окно «Обстановка»
  const choosePersona = () => {
    const m = shared.scene?.get().personaMismatch;
    if (!m) return;
    if (window.confirm(`В Таверне сейчас персона «${m.tavern}», а в этом чате привязана «${m.bound}».\n\nОК: переключить чат на «${m.tavern}».\nОтмена: оставить «${m.bound}» (предупреждение для «${m.tavern}» больше не покажется).`)) shared.scene.switchPersona(); else shared.scene.keepPersona();
  };
  const open = event => { if (event?.target?.closest?.('[data-trg]')) return shared.ui?.openTriage?.(); const dz = event?.target?.closest?.('[data-dice]'); if (dz) { if (!rollCheckWithDice({ scene: shared.scene, fromEl: dz })) shared.scene?.rollCheck(); return; } const av = event?.target?.closest?.('[data-av]'); if (av) return shared.ui?.openState?.(av.dataset.av); if (event?.target?.closest?.('[data-camp]')) { shared.scene?.pressNudge('rest'); return; } if (event?.target?.closest?.('[data-pw]')) return choosePersona(); if (event?.target?.closest?.('[data-env]')) shared.ui?.openLetter?.(); else if (event?.target?.closest?.('[data-chr]')) shared.ui?.openChronicle?.(); else if (event?.target?.closest?.('[data-fate]')) shared.ui?.openFate?.(); else if (strip.dataset.mobile) shade.toggle(); else shared.ui?.openScene?.(); };
  const onKey = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } };
  strip.addEventListener('click', open);
  strip.addEventListener('keydown', onKey);
  const unsubscribe = shared.scene?.subscribe(render);
  const unsubscribeChron = shared.chronicle?.subscribe(() => render());
  const unsubscribeCards = shared.cards?.subscribe(() => render());
  const unsubscribeTriage = shared.triage?.subscribe(() => render());
  render();

  return () => {
    unsubscribe?.();
    unsubscribeChron?.();
    unsubscribeCards?.();
    unsubscribeTriage?.();
    strip.removeEventListener('click', open);
    strip.removeEventListener('keydown', onKey);
    stopMobile();
    shade.destroy();
    strip.remove();
  };
}
