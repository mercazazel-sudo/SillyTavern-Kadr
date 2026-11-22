/**
 * Окно «Состояние»: кто в кадре и как они себя чувствуют. Сверху ряд круглых аватарок с кольцом настроения, под ним узкая
 * полоса (имя, настроение, пульс, «В кадре»). Слева фигура: одежда по слотам, оружие парными окнами; справа две вкладки:
 * «Раны и рюкзак» и «Сундук» (комплекты одежды Парадная, Походная, Лагерная и вещи, которых нет на человеке).
 * Всё хранится в данных чата; давность ран считается по календарю мира.
 */
import { esc } from './dom.js';
import { photoFor } from './photo.js';
import { createShell, loadStylesheetOnce } from './shell.js';
import { KINDS as WEATHER_KINDS, describeWeather } from '../core/weather.js';
import { dossier } from '../core/secrets.js';
import { FEATURES } from '../core/features.js';
import { sameNameAcrossScripts } from '../core/names.js';
import { searchCards } from '../core/card-search.js';
import { TIERS, SEVERITY, ZONES, ZONE_IDS, woundAge, healLeft, condLeft, MOODS, MOOD_LEVEL_RU, moodOf, AROUSAL_RU, AROUSAL_COLOR, AROUSAL_MAX, cleanArousal } from '../core/body.js';
import { SLOTS, SLOT_IDS, equipment, wardrobeOf, backpackOf, slotRu, WEAPON_KINDS, weaponKindOf, OUTFITS, outfitState, CLOTHING_KINDS, clothingKindOf, clothingForSlot, CAMP_LOOKS, campLookOf } from '../core/gear.js';
import { weaponIcon } from './weapon-icons.js';
import { clothIcon, slotIcon } from './cloth-icons.js';
import { startPulse, miniPulsePath } from './pulse.js';

const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
const STYLE_HREF = new URL('../../assets/silhouette.css', import.meta.url).href;
const ICON = { head: '🎩', cloak: '🧣', body: '🥋', hands: '🧤', feet: '🥾', melee: '🗡', two: '⚔', ranged: '🏹' };
const TYPES = [
  ...SLOTS.map(s => ({ v: `gear:${s.id}`, ru: `Одежда: ${s.ru.toLowerCase()}` })),
  { v: 'weapon:melee:1', ru: 'Оружие ближнего боя, одноручное' }, { v: 'weapon:melee:2', ru: 'Оружие ближнего боя, двуручное' },
  { v: 'weapon:ranged:1', ru: 'Дальнее оружие, одноручное' }, { v: 'weapon:ranged:2', ru: 'Дальнее оружие, двуручное' },
];
/** 'gear:head' → { kind, slot } ; 'weapon:ranged:2' → { kind, range, hands } */
const parseType = v => { const [kind, a, b] = String(v).split(':'); return kind === 'weapon' ? { kind, range: a === 'ranged' ? 'ranged' : 'melee', hands: b === '2' ? 2 : 1 } : { kind: 'gear', slot: SLOT_IDS.includes(a) ? a : 'body' }; };
const typeOf = i => (i.kind === 'weapon' ? `weapon:${i.range ?? 'melee'}:${i.hands === 2 ? 2 : 1}` : `gear:${i.slot ?? 'body'}`);
// у оружия значок по виду (меч, кинжал, булава…), а если вид неизвестен, общий значок по дальности и рукам
const iconOf = i => (i.kind === 'weapon' ? (weaponIcon(weaponKindOf(i)) || (i.range === 'ranged' ? ICON.ranged : i.hands === 2 ? ICON.two : ICON.melee)) : (clothIcon(clothingKindOf(i), campLookOf(i)) || ICON[i.slot] || '🧥'));
const lookStrip = i => `<div class="sx-looks" role="group" aria-label="Облик лагерной одежды">${CAMP_LOOKS.map((ru, n) => `<button class="sx-lk${campLookOf(i) === n + 1 ? ' on' : ''}" data-lookset="${esc(i.id)}:${n + 1}" title="${n + 1}. ${esc(ru)}">${clothIcon('camp', n + 1)}</button>`).join('')}</div>`;
const lookOptions = sel => CAMP_LOOKS.map((ru, n) => `<option value="${n + 1}"${n + 1 === sel ? ' selected' : ''}>${n + 1}. ${esc(ru)}</option>`).join('');
const ckRu = i => CLOTHING_KINDS.find(k => k.id === clothingKindOf(i))?.ru ?? '';
const ckOptions = (slot, sel) => clothingForSlot(slot).map(k => `<option value="${k.id}"${k.id === sel ? ' selected' : ''}>${esc(k.ru)}${k.hint ? ' (' + esc(k.hint) + ')' : ''}</option>`).join('');
const wkRu = i => WEAPON_KINDS.find(k => k.id === weaponKindOf(i))?.ru ?? '';
const wkOptions = sel => WEAPON_KINDS.map(k => `<option value="${k.id}"${k.id === sel ? ' selected' : ''}>${esc(k.ru)}</option>`).join('');

export function startStateWindow(deps) {
  const { shared } = deps;
  const scene = () => shared.scene;
  let stopPulse = null;
  const shell = createShell({ id: 'sj-state', label: 'Состояние', width: 1010, onClose: () => { stopPulse?.(); stopPulse = null; } });
  const { win } = shell;
  let selected = '';
  let tab = 'state';          // правая карточка: state («Раны и рюкзак») или chest («Сундук»)
  let cv = 'sets';            // вид сундука: sets (комплекты), weapon, loot, all
  let wf = 'all';             // в виде «Все вещи»: all или id слота
  let setSel = 'travel';      // выбранный комплект
  let showWorn = false;       // в сундуке показывать и то, что надето
  let draftZone = 'chest';    // часть тела для новой раны (клик по силуэту подставляет её)
  let packOpen = false;       // рюкзак раскрыт
  let moreOpen = false;       // «Имена и двойники» раскрыты
  let findQuery = '';         // строка поиска по анкетам над составом
  let showAllCast = false;    // в ряду аватарок показывать и тех, кого нет в кадре

  // ---------- фигура: метки ран и зоны ----------
  function figure(body) {
    const marks = body.wounds.map((w, i) => {
      const z = ZONES[w.zone];
      const n = body.wounds.slice(0, i).filter(x => x.zone === w.zone).length;
      const x = z.x + n * 100, y = z.y + n * 84;
      return `<g class="mk"><title>${esc(w.t)}</title><circle cx="${x}" cy="${y}" r="62" fill="${SEVERITY[w.sev].color}"/><text x="${x}" y="${y}">${w.sev}</text></g>`;
    }).join('');
    const zones = ZONE_IDS.map(id => `<circle class="zn" data-zone="${id}" cx="${ZONES[id].x}" cy="${ZONES[id].y}" r="96"><title>${esc(ZONES[id].ru)}</title></circle>`).join('');
    return `<div class="sj-figwrap"><div class="f fl"></div><div class="f ln"></div><svg viewBox="0 0 1240 1754" role="img" aria-label="Фигура с отметками ран">${zones}${marks}</svg></div>`;
  }

  // ---------- экипировка: слоты вокруг фигуры и парные окна оружия ----------
  const SLOT_POS = { head: 'left:0;top:8%', body: 'left:0;top:42%', cloak: 'right:0;top:16%', hands: 'right:0;top:44%', feet: 'right:0;top:72%' };
  function slotHtml(id, item) {
    return `<button class="sx-slot ${item ? 'full' : 'empty'}" style="${SLOT_POS[id]}" data-slot="${id}" title="${item ? esc(item.name) : 'Выбрать вещь из сундука'}"><span class="bx">${item ? iconOf(item) : (slotIcon(id) || ICON[id])}${item?.cond ? `<span class="badge" title="${esc(item.cond)}">!</span>` : ''}</span><span>${slotRu(id)}</span><b>${item ? esc(item.name) : '—'}</b></button>`;
  }
  function pairHtml(range, pair) {
    const names = range === 'melee' ? ['Правая', 'Левая'] : ['Основной', 'Запасной'];
    const cell = (v, k) => {
      if (v === 'ghost') return `<div class="sx-w ghost"><span class="ic">${iconOf(pair[0])}</span><b>${names[k]}</b><span>рука занята</span></div>`;
      if (v) return `<button class="sx-w full" data-arm="${range}:${k}" title="${esc(v.name)}${v.cond ? ' · ' + esc(v.cond) : ''}"><span class="ic">${iconOf(v)}</span><b>${esc(v.name)}</b><span>${v.hands === 2 ? 'двуручное' : 'одноручное'}</span></button>`;
      return `<button class="sx-w free" data-arm="${range}:${k}" title="Выбрать оружие"><span class="ic">＋</span><b>${names[k]}</b><span>свободна</span></button>`;
    };
    return `<div class="sx-pair${pair[1] === 'ghost' ? ' two' : ''}">${cell(pair[0], 0)}${cell(pair[1], 1)}</div>`;
  }
  function equipHtml(info, person, body) {
    const e = equipment(info.inventory, person.id);
    return `<div class="st-card sx-fig"><div class="sx-doll">${figure(body)}${SLOT_IDS.map(id => slotHtml(id, e.slots[id])).join('')}</div>
      <div class="sx-arms"><div><h6>Ближний бой</h6>${pairHtml('melee', e.melee)}</div><div><h6>Дальний бой</h6>${pairHtml('ranged', e.ranged)}</div></div></div>`;
  }

  // ---------- полоса: имя, настроение, пульс ----------
  const bpmOf = (m, lvl) => Math.round(m.bpm * (m.id === 'calm' || m.id === 'sad' ? 1 : 0.9 + lvl * 0.07));
  // возбуждение разгоняет пульс и делает ритм чуть неровнее, поверх настроения
  const pulseMood = (m, ar) => (ar ? { ...m, bpm: m.bpm + ar * 10, irr: Math.max(m.irr, 0.04 * ar), jit: m.jit + ar * 0.01 } : m);
  /** Анкета человека: найденная по имени или прозвищу; у персоны (игрока) анкет нет. */
  const cardOfPerson = person => (person.persona ? null : (shared.cards?.get().cards ?? []).find(c => c.person?.id === person.id) ?? null);
  function stripHtml(person, body, dead) {
    const card = cardOfPerson(person);
    const cardBtn = person.persona || !shared.cards ? ''
      : card ? `<button class="sx-cardbtn on" data-act="opencard" data-card="${esc(card.id)}" title="Открыть анкету в окне «Анкеты»">Анкета ›</button>`
        : '<button class="sx-cardbtn" data-act="tocards" title="Анкеты нет: создать второстепенную анкету из этого героя и открыть её, чтобы заполнить описание">+ В анкеты</button>';
    const m = moodOf(body.mood?.id), lvl = body.mood?.lvl ?? 1, t = TIERS[body.tier], ar = cleanArousal(body.arousal);
    return `<div class="sx-strip" style="--mc:${m.color}">
      <div class="sx-nm"><h3>${esc(person.name)}${person.persona ? ' <i>· ты</i>' : ''}</h3><small>${dead ? 'умер' : person.present ? 'сейчас в кадре' : 'за кадром'} · ${esc(t.ru)}</small>${cardBtn}</div>
      <div class="sx-chipcol"><button class="sx-moodbtn" data-act="moodpop" title="Сменить настроение"><i></i>${esc(m.ru)}<em>${m.id === 'calm' ? '' : esc(MOOD_LEVEL_RU[lvl])} ▾</em></button>
        <button class="sx-arbtn${ar ? ' on' : ''}" data-act="arousalpop" title="Возбуждение: отдельная шкала рядом с настроением"><span class="pips">${[1, 2, 3, 4].map(n => `<i class="${n <= ar ? 'f' : ''}"></i>`).join('')}</span>Возбуждение<em>${ar ? esc(AROUSAL_RU[ar]) : 'нет'} ▾</em></button></div>
      <div class="sx-pulse"><div class="sx-scope"><canvas class="sj-ecg"${dead ? ' data-flat="1"' : ''} aria-label="${dead ? 'Пульса нет' : 'Пульс'}"></canvas></div><div class="sx-bpm${dead ? ' flat' : ''}"><b>${dead ? '0' : bpmOf(pulseMood(m, ar), lvl)}</b><small>уд/мин</small></div></div>
      <div class="sx-end"><label class="sj-chk sj-tgl"><input type="checkbox" role="switch" data-present="1" ${person.present ? 'checked' : ''}><i aria-hidden="true"></i><span>В кадре<small>рассказчик о нём знает</small></span></label>
        <button class="sx-trash" data-act="removeperson" title="Убрать из чата совсем: из состава, чувств и ран; вещи станут общими" aria-label="Убрать из чата">${TRASH}</button></div></div>`;
  }
  function arousalPopHtml(body) {
    const ar = cleanArousal(body.arousal);
    return `<h6>Возбуждение</h6><div class="sx-moods">${AROUSAL_RU.map((ru, n) => `<button class="sx-m" data-arousal="${n}" style="--c:${AROUSAL_COLOR}" aria-pressed="${n === ar}"><i></i>${esc(ru)}</button>`).join('')}</div>
      <div class="sx-note">Отдельная шкала: идёт вместе с любым настроением и разгоняет пульс. Рассказчик получает её одной строкой. Ведёт Архивариус (по тексту ответа) или вы вручную.</div>`;
  }
  function moodPopHtml(body) {
    const m = moodOf(body.mood?.id), lvl = body.mood?.lvl ?? 1;
    return `<h6>Настроение</h6><div class="sx-moods">${MOODS.map(x => `<button class="sx-m" data-mood="${x.id}" style="--c:${x.color}" aria-pressed="${x.id === m.id}"><i></i>${esc(x.ru)}</button>`).join('')}</div>
      <div class="sx-note">${esc(m.note)}</div>
      <label class="sx-lv"><span>Сила</span><input type="range" min="1" max="3" value="${lvl}" data-moodlvl aria-label="Сила настроения"><b>${MOOD_LEVEL_RU[lvl]}</b></label>`;
  }

  // ---------- раны и состояния ----------
  function woundsHtml(info, person, body) {
    const cal = info.state.calendar, today = info.today, t = TIERS[body.tier];
    const lines = body.wounds.map(w => {
      const age = woundAge(cal, w, today), left = healLeft(w, age), ready = left === 0;
      return `<div class="st-wl" style="--w:${SEVERITY[w.sev].color}"><span class="sev">${w.sev}</span>
        <span class="wt"><b>${esc(w.t)}</b><small>${SEVERITY[w.sev].ru} · ${age ? age + ' дн. назад' : 'сегодня'}${ready ? ' · можно снимать' : ` · заживёт через ~${left} дн.`}</small></span>
        <span class="xx2"></span><span class="pl"><span class="zn2">${esc(ZONES[w.zone].ru)}</span>
        <button class="bnd${w.bnd ? ' on' : ''}" data-bnd="${esc(w.id)}" title="${w.bnd ? 'Снять повязку' : 'Перевязать'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="M10.5 10.5l3 3"/></svg><span>${w.bnd ? 'перевязана' : 'не перевязана'}</span></button>
        ${ready ? `<button class="bnd on" data-heal="${esc(w.id)}" title="Рана зажила: убрать запись">зажила</button>` : ''}</span>
        <button class="xx" data-delw="${esc(w.id)}" title="Убрать рану" aria-label="Убрать рану">×</button></div>`;
    }).join('');
    const conds = body.conds.map(c => {
      const left = condLeft(cal, c, today);
      return `<span class="st-cd">${esc(c.t)}<em>${left === null ? 'без срока' : left > 0 ? 'ещё ' + left + ' дн.' : 'прошло?'}</em><button data-delc="${esc(c.id)}" aria-label="Убрать состояние">×</button></span>`;
    }).join('');
    return `<div class="st-card st-wcard"><h4>Раны и состояние <small class="st-tier" style="--tc:${t.color}">общий уровень: <b>${t.ru}</b>${TIERS.map((x, k) => `<button class="st-pip${k <= body.tier ? ' on' : ''}" data-tier="${k}" title="${x.ru}" aria-label="${x.ru}"></button>`).join('')}</small></h4>
      <div class="st-wlines">${lines || '<div class="sj-none">Ран нет.</div>'}</div>
      <div class="st-conds">${conds}</div>
      <details class="st-addrow"><summary>+ рана или состояние</summary>
        <div class="sj-add"><select id="sj-wzone" aria-label="Часть тела">${ZONE_IDS.map(id => `<option value="${id}"${id === draftZone ? ' selected' : ''}>${esc(ZONES[id].ru)}</option>`).join('')}</select>
          <select id="sj-wsev" aria-label="Тяжесть">${[1, 2, 3].map(n => `<option value="${n}"${n === 2 ? ' selected' : ''}>${SEVERITY[n].ru}</option>`).join('')}</select>
          <input id="sj-wtxt" placeholder="Что за рана…" aria-label="Что за рана"><button class="sj-btn sj-pri" data-act="addw">Добавить рану</button></div>
        <div class="sj-add"><input id="sj-ctxt" placeholder="Отравлен, лихорадка, голод…" aria-label="Состояние"><input id="sj-cdays" type="number" min="0" value="2" aria-label="Дней" title="На сколько дней (0 = без срока)" style="flex:0 0 74px"><button class="sj-btn" data-act="addc">Добавить состояние</button></div></details></div>`;
  }

  // ---------- рюкзак ----------
  function itemRow(i, info, self) {
    const others = info.people.filter(p => p.id !== self).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    return `<div class="sj-it"><span class="t"><b>${esc(i.name)}</b>${i.qty > 1 ? ` <span class="q">×${i.qty}</span>` : ''}${i.note ? `<small>${esc(i.note)}</small>` : ''}</span>
      <span class="r"><button class="sj-st" data-itq="${esc(i.id)}|-1" aria-label="Меньше">−</button><button class="sj-st" data-itq="${esc(i.id)}|1" aria-label="Больше">+</button>
        <select data-togear="${esc(i.id)}" aria-label="В гардероб" style="width:auto"><option value="">в гардероб…</option>${TYPES.map(t => `<option value="${t.v}">${esc(t.ru)}</option>`).join('')}</select>
        <select data-give="${esc(i.id)}" aria-label="Отдать" style="width:auto"><option value="">отдать…</option>${self ? '<option value="__party">в общие</option>' : ''}${others}</select><button class="sj-st" data-delitem="${esc(i.id)}" aria-label="Убрать">✕</button></span></div>`;
  }
  function packHtml(info, person) {
    const mine = backpackOf(info.inventory, person.id), party = backpackOf(info.inventory, '');
    return `<details class="st-card st-pack" data-pack ${packOpen ? 'open' : ''}><summary><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"/><path d="M6 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><path d="M4 13h16M10 13v2h4v-2"/></svg></span>
      <span class="pt"><b>Рюкзак</b><small>${mine.length} вещей${party.length ? ` · общих отряда: ${party.length}` : ''}</small></span><span class="pe">развернуть</span></summary>
      <div class="sj-itl">${mine.map(i => itemRow(i, info, person.id)).join('') || '<div class="sj-none">Ничего не записано.</div>'}</div>
      ${party.length ? `<div class="sj-lbl" style="margin:8px 18px 0">Общие вещи отряда</div><div class="sj-itl">${party.map(i => itemRow(i, info, '')).join('')}</div>` : ''}
      <div class="sj-add" style="margin:8px 18px 14px"><input id="sj-itname" placeholder="Что у него в карманах, в рюкзаке…" aria-label="Вещь"><input id="sj-itqty" type="number" min="1" value="1" aria-label="Количество" style="flex:0 0 64px"><input id="sj-itnote" placeholder="примечание" aria-label="Примечание" style="flex:0 0 130px"><button class="sj-btn" data-act="additem">Добавить</button></div></details>`;
  }

  // ---------- сундук: комплекты одежды и вещи, которых нет на человеке ----------
  const CHEST_VIEWS = [['sets', 'Комплекты'], ['weapon', 'Оружие'], ['loot', 'Трофеи'], ['all', 'Все вещи']];
  const inChestView = (i, view) => (view === 'weapon' ? i.kind === 'weapon' : view === 'loot' ? Boolean(i.loot) : true);
  function wardRow(i) {
    return `<div class="st-wi${i.worn ? ' worn' : ''}"><span class="ic">${iconOf(i)}</span>
      <span class="wn"><b>${esc(i.name)}</b><small>${i.kind === 'weapon' ? (wkRu(i) ? wkRu(i) + ', ' : '') + (i.range === 'ranged' ? 'дальнее' : 'ближнее') + (i.hands === 2 ? ', двуручное' : ', одноручное') : (ckRu(i) ? ckRu(i) + ', ' : '') + slotRu(i.slot)}${i.loot ? ' · ' + esc(i.loot) : ''}</small>
        <span class="tags">${i.loot ? '<span class="tg loot">трофей</span>' : '<span class="tg own">своё</span>'}${i.worn ? '<span class="tg on">надето</span>' : ''}</span>
        ${clothingKindOf(i) === 'camp' ? lookStrip(i) : ''}<input class="cnd" data-cond="${esc(i.id)}" value="${esc(i.cond ?? '')}" placeholder="состояние: промокла, порвана…" aria-label="Состояние вещи">
        <details class="st-type"><summary>изменить тип</summary><select data-geartype="${esc(i.id)}" aria-label="Тип вещи">${TYPES.map(t => `<option value="${t.v}"${t.v === typeOf(i) ? ' selected' : ''}>${esc(t.ru)}</option>`).join('')}</select>${i.kind === 'weapon' ? `<select data-wtype="${esc(i.id)}" aria-label="Вид оружия" style="margin-top:4px"><option value="">вид оружия: по названию</option>${wkOptions(i.wtype)}</select>` : (clothingForSlot(i.slot).length ? `<select data-ctype="${esc(i.id)}" aria-label="Вид одежды" style="margin-top:4px"><option value="">вид одежды: по названию</option>${ckOptions(i.slot, i.ctype)}</select>` : '')}${clothingKindOf(i) === 'camp' ? `<select data-look="${esc(i.id)}" aria-label="Облик лагерной одежды" style="margin-top:4px">${lookOptions(campLookOf(i))}</select>` : ''}</details></span>
      <span class="wb"><button class="st-wbtn${i.worn ? ' on' : ''}" data-wear="${esc(i.id)}">${i.worn ? 'Снять' : 'Надеть'}</button><button class="sj-st" data-tobag="${esc(i.id)}" title="Убрать из сундука в рюкзак">в рюкзак</button><button class="sj-st" data-delitem="${esc(i.id)}" aria-label="Убрать совсем">✕</button></span></div>`;
  }
  function outfitsHtml(info, person) {
    const gear = wardrobeOf(info.inventory, person.id).filter(i => i.kind === 'gear');
    const cards = OUTFITS.map(o => {
      const st = outfitState(info.inventory, info.outfits, person.id, o.id);
      const minis = SLOTS.map(sl => { const it = st.slots[sl.id]; return `<span class="mi${it ? ' in' : ''}${it?.worn ? ' on' : ''}" title="${esc(sl.ru)}${it ? ': ' + esc(it.name) : ': пусто'}">${it ? iconOf(it) : (slotIcon(sl.id) || ICON[sl.id])}</span>`; }).join('');
      const label = !st.total ? 'пока пуста' : st.full ? '<span class="stt full">надета сейчас</span>' : st.worn ? `<span class="stt part">частично ${st.worn} из ${st.total}</span>` : `${st.total} ${st.total === 1 ? 'вещь' : 'вещи'}`;
      const bodyItem = st.slots.body;
      return `<div class="sx-set${setSel === o.id ? ' sel' : ''}" data-setsel="${o.id}" role="button" tabindex="0"><div class="sh"><b>${esc(o.ru)}</b>${bodyItem ? `<span class="pv" title="${esc(bodyItem.name)}">${iconOf(bodyItem)}</span>` : ''}</div><div class="mini">${minis}</div><div class="ft">${label}<button class="sx-go" data-wearoutfit="${o.id}" ${!st.total || st.full ? 'disabled' : ''}>${st.full ? 'Надето' : 'Надеть'}</button></div></div>`;
    }).join('');
    const sel = info.outfits?.[person.id]?.[setSel] ?? {};
    const selRu = OUTFITS.find(o => o.id === setSel)?.ru ?? '';
    const tiles = gear.map(i => `<div class="sx-tile${sel[i.slot] === i.id ? ' inset' : ''}" role="button" tabindex="0" data-oset="${esc(i.id)}" title="${esc(i.name)}"><button class="sx-del" data-deltile="${esc(i.id)}" title="Удалить предмет" aria-label="Удалить предмет">✕</button><span class="ic">${iconOf(i)}</span><b>${esc(i.name)}</b><small>${slotRu(i.slot)}${i.worn ? ' · сейчас на нём' : ''}</small>${clothingKindOf(i) === 'camp' ? `<button class="sx-lookbtn" data-lookpop="${esc(i.id)}" title="Выбрать облик из десяти">облик ▾</button>` : ''}</div>`).join('');
    return `<div class="sx-sets">${cards}</div>
      <div class="sx-setedit"><h6>Вещи комплекта «${esc(selRu)}»<em>нажмите на вещь, чтобы добавить или убрать; в слоте одна вещь</em></h6>
        <div class="sx-tiles">${tiles || '<div class="sj-none">У него нет одежды: добавьте вещь ниже.</div>'}</div></div>
      <div class="sx-save"><span>Сохранить то, что надето сейчас, как</span><select id="sx-saveas" aria-label="Комплект">${OUTFITS.map(o => `<option value="${o.id}"${o.id === setSel ? ' selected' : ''}>${esc(o.ru)}</option>`).join('')}</select><button class="sx-go" data-act="saveoutfit">Сохранить</button></div>`;
  }
  function chestHtml(info, person) {
    const all = wardrobeOf(info.inventory, person.id);
    const onHim = all.filter(i => i.worn).length;
    const visible = all.filter(i => showWorn || !i.worn);
    const count = v => visible.filter(i => inChestView(i, v)).length;
    const chips = `<div class="sx-chips">${CHEST_VIEWS.map(([id, ru]) => `<button class="chip${cv === id ? ' on' : ''}" data-cv="${id}">${esc(ru)}${id === 'sets' ? '' : ' ' + count(id)}</button>`).join('')}${cv === 'sets' ? '' : `<label class="sj-chk sj-tgl sx-worn"><input type="checkbox" role="switch" data-showworn="1" ${showWorn ? 'checked' : ''}><i aria-hidden="true"></i><span>и то, что надето (${onHim})</span></label>`}</div>`;
    let body;
    if (cv === 'sets') body = outfitsHtml(info, person);
    else {
      const slotChips = cv === 'all' ? `<div class="st-wfilters">${[['all', 'Любой слот'], ...SLOTS.map(s => [s.id, s.ru])].map(([id, ru]) => `<button class="chip${wf === id ? ' on' : ''}" data-wf="${id}">${esc(ru)}</button>`).join('')}</div>` : '';
      const list = visible.filter(i => inChestView(i, cv) && (cv !== 'all' || wf === 'all' || (i.kind === 'gear' && i.slot === wf)));
      body = `${slotChips}<div class="st-wlist">${list.map(wardRow).join('') || '<div class="sj-none">Здесь пока пусто: всё надето или вещей такого вида нет.</div>'}</div>
        <div class="st-rule"><b>Как это работает.</b> Рассказчику уходит только то, что надето. Когда в тексте звучит «накинул плащ», Архивариус предлагает надеть вещь из сундука; если такой вещи у персонажа нет, он ничего не надевает. Трофеи, добытые по ходу истории, попадают сюда сами с пометкой «трофей».</div>`;
    }
    return `<div class="st-card"><h4>Сундук <small>вещи ${esc(person.name.split(' ')[0])}, которых нет на нём: в лагере или про запас</small></h4>${chips}${body}
      <div class="sj-add" style="margin-top:10px"><input id="sj-gname" placeholder="Положить вещь: название" aria-label="Название"><select id="sj-gtype" aria-label="Тип">${TYPES.map(t => `<option value="${t.v}">${esc(t.ru)}</option>`).join('')}</select><select id="sj-gwtype" aria-label="Вид оружия" title="Нужен только для оружия: от него зависит значок"><option value="">вид оружия…</option>${wkOptions('')}</select><select id="sj-gcty" aria-label="Вид одежды" title="Нужен только для одежды: от него зависит значок и слот"><option value="">вид одежды…</option>${CLOTHING_KINDS.map(k => `<option value="${k.id}">${esc(k.ru)} · ${esc(slotRu(k.slot).toLowerCase())}</option>`).join('')}</select><select id="sj-glook" aria-label="Облик лагерной одежды" title="Нужен только для лагерной одежды"><option value="">облик…</option>${lookOptions(0)}</select><button class="sj-btn sj-pri" data-act="addgear">Положить</button></div></div>`;
  }

  // ---------- всплывашки: выбор вещи для слота, оружие в руку, настроение ----------
  function closePop() { win.querySelector('#sx-pop')?.remove(); }
  function openPop(kind, anchor, arg) {
    closePop();
    const info = scene().get(), person = info.cast.find(p => p.id === selected);
    if (!person) return;
    const body = info.bodies[person.id] ?? { tier: 0, wounds: [], conds: [], mood: null };
    const all = wardrobeOf(info.inventory, person.id);
    let html = '';
    if (kind === 'looks') {
      const item = info.inventory.find(x => x.id === arg);
      if (!item) return;
      html = `<h6>Облик: ${esc(item.name)}</h6><div class="sx-lookgrid">${CAMP_LOOKS.map((ru, n) => `<button class="sx-lk${campLookOf(item) === n + 1 ? ' on' : ''}" data-lookset="${esc(item.id)}:${n + 1}" title="${n + 1}. ${esc(ru)}">${clothIcon('camp', n + 1)}</button>`).join('')}</div><div class="sx-note">Десять обликов, слева направо и сверху вниз; название видно при наведении.</div>`;
    } else if (kind === 'mood') html = moodPopHtml(body);
    else if (kind === 'arousal') html = arousalPopHtml(body);
    else if (kind === 'slot') {
      const list = all.filter(i => i.kind === 'gear' && i.slot === arg), worn = list.find(i => i.worn);
      html = `<h6>${esc(slotRu(arg))}</h6>${list.map(i => `<button class="sx-opt${i.worn ? ' on' : ''}" data-popwear="${esc(i.id)}"><span class="ic">${iconOf(i)}</span>${esc(i.name)}<small>${i.worn ? 'надето' : i.loot ? 'трофей' : ''}</small></button>`).join('') || '<div class="sx-note">В сундуке нет вещей на этот слот.</div>'}
        ${worn ? `<button class="sx-opt" data-popun="${esc(worn.id)}">Снять</button>` : ''}<button class="sx-opt dim" data-act="tochest" data-slot-filter="${esc(arg)}">Открыть сундук</button>`;
    } else {
      const [range, idx] = String(arg).split(':'), e = equipment(info.inventory, person.id), pair = range === 'ranged' ? e.ranged : e.melee;
      const list = all.filter(i => i.kind === 'weapon' && (i.range ?? 'melee') === range), cur = pair[Number(idx)];
      html = `<h6>${range === 'ranged' ? 'Дальний бой' : 'Ближний бой'}</h6>${list.map(i => `<button class="sx-opt${i.worn ? ' on' : ''}" data-popwear="${esc(i.id)}"><span class="ic">${iconOf(i)}</span>${esc(i.name)}<small>${i.worn ? 'в руке' : i.hands === 2 ? 'две руки' : 'одна рука'}</small></button>`).join('') || '<div class="sx-note">Нет оружия этого вида.</div>'}
        ${cur && cur !== 'ghost' ? `<button class="sx-opt" data-popun="${esc(cur.id)}">Убрать из руки</button>` : ''}<button class="sx-opt dim" data-act="tochest" data-view="weapon">Открыть сундук</button>`;
    }
    const el = document.createElement('div');
    el.className = 'sx-pop'; el.id = 'sx-pop'; el.innerHTML = html;
    win.append(el);
    // вниз от якоря, если хватает места, иначе вверх; по бокам не выходит за экран
    const a = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const pw = el.offsetWidth, ph = Math.min(el.offsetHeight, vh - 16), below = vh - a.bottom - 10, above = a.top - 10, up = below < ph && above > below;
    el.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
    el.style.left = `${Math.max(8, Math.min(vw - pw - 8, a.left + a.width / 2 - pw / 2))}px`;
    el.style.top = up ? `${Math.max(8, a.top - Math.min(ph, above) - 6)}px` : `${a.bottom + 6}px`;
  }

  function knowledgeHtml(info, person) {
    if (!FEATURES.secrets) return '';
    const d = dossier(info.knowledge, person.id);
    return `<div class="sj-know"><span class="k">знает <b>${d.knows.length}</b></span><span class="k warn">не знает <b>${d.doesNotKnow.length}</b></span><button class="sj-st" data-act="opensecrets">открыть «Тайны»</button></div>`;
  }

  /** Двойники: другая запись об этом же человеке под именем на другом алфавите; объединяются в один клик. */
  function twinsHtml(info, person) {
    const aliasesOf = id => info.relations.people.find(x => x.id === id)?.aliases ?? [];
    const names = id => [info.people.find(p => p.id === id)?.name ?? '', ...aliasesOf(id)];
    const twins = info.people.filter(o => o.id !== person.id && names(person.id).some(a => names(o.id).some(b => a && b && sameNameAcrossScripts(a, b))));
    return twins.map(o => `<div class="sj-sug"><span>Похоже, <b>${esc(o.name)}</b> это тот же человек, что и <b>${esc(person.name)}</b>${o.present ? '' : ' (не в кадре)'}.</span><button class="sj-btn sj-pri" data-act="mergesuggest" data-drop="${esc(o.id)}">Объединить</button></div>`).join('');
  }

  function addCastHtml() {
    const info0 = scene().get();
    const bind = info0?.tavernPersona && !info0.cast.some(p => p.persona) ? `<button class="sj-btn" data-act="bindpersona" title="Персона сама в чат не добавляется: привязать ту, за кого вы играете в Таверне">Привязать персону «${esc(info0.tavernPersona)}»</button>` : '';
    return `<div class="sj-add sx-findrow"><input id="sj-cfind" value="${esc(findQuery)}" placeholder="Поиск по анкетам: имя, прозвище, текст" autocomplete="off" aria-label="Поиск по анкетам"><button class="sj-btn" data-act="addcast" title="Добавить участника с любым именем, даже если анкеты нет">+ своё имя</button>${bind}</div>`;
  }

  /** Результаты поиска по анкетам: куда нажать, чтобы добавить в состав или перейти к уже добавленному. */
  function findHtml() {
    const q = findQuery.trim();
    if (!q) return '';
    const cards = (shared.cards?.get()?.cards ?? []).filter(c => !c.idle);
    const hits = searchCards(cards, q, { limit: 12 });
    if (!hits.length) return `<div class="sx-finds"><span class="sj-sub">Ничего не нашлось среди анкет. «+ своё имя» добавит участника без анкеты.</span></div>`;
    return `<div class="sx-finds">${hits.map(({ card, where }) => `<button class="sx-hit${card.person ? ' in' : ''}" data-pick="${esc(card.id)}" title="${card.person ? 'Уже в составе: перейти к нему' : 'Добавить в состав'}"><b>${esc(card.name)}</b><small>${(card.tier ?? 'main') === 'main' ? 'основной' : 'второстепенный'} · ${esc(where)}${card.person ? ' · в составе' : ''}</small></button>`).join('')}</div>`;
  }

  /** Выбор найденной анкеты: уже в составе, значит перейти; нет, значит добавить (с прозвищами из анкеты). */
  function pickCard(cardId) {
    const card = shared.cards?.get()?.cards.find(c => c.id === cardId);
    if (!card) return false;
    if (card.person) { selected = card.person.id; }
    else if (scene().addCast(card.name)) {
      const added = scene().get().cast.at(-1);
      selected = added?.id ?? selected;
      if (added && card.aliases?.length) scene().setAliases(added.id, card.aliases.join(', '));
    } else return false;
    findQuery = '';
    return true;
  }

  const photoOf = person => photoFor(shared, person);
  const avatar = (p, cls = '') => { const img = photoOf(p); return `<span class="av ${cls}">${img ? `<img src="${esc(img)}" alt="">` : esc(p.name[0] ?? '?')}</span>`; };

  function render() {
    stopPulse?.(); stopPulse = null;
    const info = scene()?.get();
    if (!info?.hasChat) { shell.close(); return; }
    shell.theme(info.state.calendar);
    const deadIds = info.knowledge.deaths ?? {};
    // в кадре первыми, умершие и ушедшие в конце; по умолчанию в ряду только те, кто в кадре (выбранный виден всегда)
    const cast = [...info.cast].sort((a, b) => Number(Boolean(deadIds[a.id])) - Number(Boolean(deadIds[b.id])) || Number(Boolean(b.present)) - Number(Boolean(a.present)));
    if (!cast.find(p => p.id === selected)) selected = (cast.find(p => p.present && !deadIds[p.id]) ?? cast[0])?.id ?? '';
    const person = cast.find(p => p.id === selected);
    const body = person ? (info.bodies[person.id] ?? { tier: 0, wounds: [], conds: [], mood: null }) : null;
    const inFrame = cast.filter(p => p.present || p.id === selected);
    const hiddenCount = cast.length - inFrame.length;
    const shownCast = showAllCast ? cast : inFrame;
    const moreBtn = hiddenCount > 0 || showAllCast
      ? `<button class="sx-moreb" data-act="togglecast" title="${showAllCast ? 'Оставить в ряду только тех, кто в кадре' : 'Показать и тех, кого сейчас нет в кадре'}">${showAllCast ? 'Только в кадре' : `Не в кадре: ${hiddenCount}`}</button>` : '';

    const who = shownCast.map(p => {
      const b = info.bodies[p.id] ?? { mood: null }, m = moodOf(b.mood?.id), dead = Boolean(deadIds[p.id]), img = photoOf(p);
      return `<div class="sx-wc"><button class="sx-av${p.id === selected ? ' cur' : ''}${dead ? ' dead' : ''}${p.present ? ' here' : ''}" data-who="${esc(p.id)}" style="--ring:${m.color}" title="${esc(p.name)}${dead ? ' · умер' : ''}">${img ? `<img src="${esc(img)}" alt="">` : esc(p.name[0] ?? '?')}</button><span class="sx-wn">${esc(p.name.split(' ')[0])}</span></div>`;
    }).join('');

    let page = '<div class="sj-empty">Список участников пуст. Добавьте тех, кто в кадре.</div>';
    if (person && body) {
      const dead = Boolean(deadIds[person.id]);
      const chestCount = wardrobeOf(info.inventory, person.id).filter(i => !i.worn).length;
      const tabs = `<div class="sx-tabs"><button class="st-tab" data-tab="state" aria-pressed="${tab === 'state'}">Раны и рюкзак</button><button class="st-tab" data-tab="chest" aria-pressed="${tab === 'chest'}">Сундук<small>${chestCount}</small></button></div>`;
      const more = `<details class="st-more" data-more ${moreOpen ? 'open' : ''}><summary>Имена, двойники и персона</summary>
        ${twinsHtml(info, person)}
        <label class="sj-row">Другие имена<input data-aliases value="${esc((info.relations.people.find(p => p.id === person.id)?.aliases ?? []).join(', '))}" placeholder="прозвища и формы имени через запятую" aria-label="Другие имена"></label>
        ${info.people.some(p => p.id !== person.id) ? `<div class="sj-add"><select id="sj-mergewith" aria-label="Кто это на самом деле"><option value="">Это тот же человек, что…</option>${info.people.filter(p => p.id !== person.id).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button class="sj-btn" data-act="mergeinto">Объединить</button></div>` : ''}
        <label class="sj-chk sj-tgl" title="Персона это игрок: расширение не считает её персонажем, не пишет за неё и не ведёт чувства"><input type="checkbox" role="switch" data-persona="1" ${person.persona ? 'checked' : ''}><i aria-hidden="true"></i><span>Персона<small>это игрок, а не персонаж</small></span></label>
        ${knowledgeHtml(info, person)}</details>`;
      page = `${stripHtml(person, body, dead)}<div class="sx-main">${equipHtml(info, person, body)}<div class="sx-right">${tabs}${tab === 'chest' ? chestHtml(info, person) : `${woundsHtml(info, person, body)}${packHtml(info, person)}`}</div></div>${more}`;
    }

    win.innerHTML = `<div class="sj-wh"><h2>Состояние</h2><span class="sj-sub">${esc(info.date.name)} · ${info.date.year} ${esc(info.date.era)}${info.weather ? ` · ${(WEATHER_KINDS[info.weather.kind] ?? WEATHER_KINDS.clear).icon} ${esc(describeWeather(info.weather))}` : ''}</span><button class="sj-btn sj-x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="sx-who">${who}${moreBtn}</div>${addCastHtml()}<div id="sj-cfinds">${findHtml()}</div><div class="sx-page">${page}</div>`;
    const cvs = win.querySelector('canvas.sj-ecg');
    if (cvs && body) stopPulse = startPulse(cvs, pulseMood(moodOf(body.mood?.id), cleanArousal(body.arousal)), body.mood?.lvl ?? 1, { flat: cvs.dataset.flat === '1' });
  }

  const onClick = event => {
    const t = event.target;
    const pick = t.closest('[data-pick]');
    if (pick) { pickCard(pick.dataset.pick); return render(); }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'close') return shell.close();
    if (act === 'togglecast') { showAllCast = !showAllCast; return render(); }
    if (act === 'mergesuggest') { scene().mergePersons(selected, t.closest('[data-drop]').dataset.drop); return; }
    if (act === 'mergeinto') {
      const dropId = win.querySelector('#sj-mergewith')?.value;
      const info = scene().get();
      const keep = info.people.find(p => p.id === selected), drop = info.people.find(p => p.id === dropId);
      if (!keep || !drop) { win.querySelector('#sj-mergewith')?.classList.add('sj-bad'); return; }
      if (window.confirm(`Объединить «${drop.name}» с «${keep.name}»? Всё, что связано с «${drop.name}» (чувства, раны, вещи, знания), перейдёт к «${keep.name}», а «${drop.name}» станет её другим именем.`)) scene().mergePersons(selected, dropId);
      return;
    }
    if (act === 'addcast') {
      const name = (window.prompt('Имя участника', findQuery.trim()) ?? '').trim();
      if (name && scene().addCast(name)) { const added = scene().get().cast.at(-1); selected = added?.id ?? selected; findQuery = ''; }
      return render();
    }
    if (act === 'addw') { const text = win.querySelector('#sj-wtxt'); if (!scene().addWound(selected, { zone: win.querySelector('#sj-wzone').value, sev: win.querySelector('#sj-wsev').value, t: text.value })) text.classList.add('sj-bad'); return; }
    if (act === 'addc') { const text = win.querySelector('#sj-ctxt'); if (!scene().addCondition(selected, { t: text.value, days: win.querySelector('#sj-cdays').value })) text.classList.add('sj-bad'); return; }
    if (act === 'additem') { const name = win.querySelector('#sj-itname'); if (!scene().addItem({ name: name.value, qty: win.querySelector('#sj-itqty').value, note: win.querySelector('#sj-itnote').value, ownerId: selected })) name.classList.add('sj-bad'); return; }
    if (act === 'addgear') { const name = win.querySelector('#sj-gname'); const kind = parseType(win.querySelector('#sj-gtype').value), wk = WEAPON_KINDS.find(k => k.id === win.querySelector('#sj-gwtype').value), ck = CLOTHING_KINDS.find(k => k.id === win.querySelector('#sj-gcty')?.value);
      if (!scene().addGear({ ownerId: selected, name: name.value, ...kind, ...(kind.kind === 'weapon' && wk ? { wtype: wk.id, range: wk.range } : {}), ...(kind.kind === 'gear' && ck ? { ctype: ck.id, slot: ck.slot, ...(ck.id === 'camp' ? { look: Number(win.querySelector('#sj-glook')?.value) || 1 } : {}) } : {}) })) name.classList.add('sj-bad'); return; }
    if (act === 'bindpersona') { if (scene().switchPersona()) { const p = scene().get().cast.find(x => x.persona); if (p) selected = p.id; } return; }
    if (act === 'tocards') {
      const p = scene().get().cast.find(x => x.id === selected);
      const id = p ? shared.cards?.addFromPerson(p) : '';
      if (id) { shell.close(); shared.ui?.openCards?.(id); }
      return;
    }
    if (act === 'opencard') { const id = t.closest('[data-act]')?.dataset.card; if (id) { shell.close(); shared.ui?.openCards?.(id); } return; }
    if (act === 'removeperson') {
      const p = scene().get().cast.find(x => x.id === selected);
      if (p && window.confirm(`Убрать «${p.name}» из этого чата совсем? Исчезнут его чувства, раны и запись в составе; вещи станут общими.`)) scene().removePersonFromChat(p.id);
      return;
    }
    if (act === 'opensecrets') return void shared.ui?.openSecrets?.();
    if (act === 'moodpop') return void openPop('mood', t.closest('[data-act]'));
    if (act === 'arousalpop') return void openPop('arousal', t.closest('[data-act]'));
    if (act === 'tochest') { const b = t.closest('[data-act]'); tab = 'chest'; if (b.dataset.view) { cv = b.dataset.view; } else if (b.dataset.slotFilter) { cv = 'all'; wf = b.dataset.slotFilter; showWorn = true; } return render(); }
    if (act === 'saveoutfit') { const id = win.querySelector('#sx-saveas')?.value; if (id) { setSel = id; scene().saveOutfit(selected, id); } return; }

    // всплывашка закрывается нажатием мимо неё
    if (!t.closest('#sx-pop') && !t.closest('[data-slot],[data-arm],[data-act="moodpop"],[data-act="arousalpop"],[data-lookpop]')) closePop();
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; return render(); }
    const cv2 = t.closest('[data-cv]'); if (cv2) { cv = cv2.dataset.cv; return render(); }
    const wf2 = t.closest('[data-wf]'); if (wf2) { wf = wf2.dataset.wf; return render(); }
    const slot = t.closest('[data-slot]'); if (slot) { openPop('slot', slot, slot.dataset.slot); return; }
    const arm = t.closest('[data-arm]'); if (arm) { openPop('arm', arm, arm.dataset.arm); return; }
    const pw = t.closest('[data-popwear]'); if (pw) { const it = scene().get().inventory.find(x => x.id === pw.dataset.popwear); if (it?.worn) scene().unwearItem(it.id); else scene().wearItem(pw.dataset.popwear); return; }
    const pu = t.closest('[data-popun]'); if (pu) { scene().unwearItem(pu.dataset.popun); return; }
    const sset = t.closest('[data-setsel]');
    if (sset && !t.closest('[data-wearoutfit]')) { setSel = sset.dataset.setsel; return render(); }
    const wo = t.closest('[data-wearoutfit]'); if (wo) { setSel = wo.dataset.wearoutfit; scene().wearOutfit(selected, wo.dataset.wearoutfit); return; }
    const lpop = t.closest('[data-lookpop]'); if (lpop) { event.stopPropagation(); openPop('looks', lpop, lpop.dataset.lookpop); return; }
    const lset = t.closest('[data-lookset]'); if (lset) { const [id, n] = lset.dataset.lookset.split(':'); scene().updateGear(id, { look: Number(n) }); return; }
    const dtile = t.closest('[data-deltile]');
    if (dtile) { event.stopPropagation(); const it = scene().get().inventory.find(x => x.id === dtile.dataset.deltile); if (it && window.confirm(`Удалить предмет «${it.name}» совсем? Он пропадёт и из всех комплектов.`)) scene().removeItem(it.id); return; }
    const oset = t.closest('[data-oset]'); if (oset) { scene().toggleOutfitItem(selected, setSel, oset.dataset.oset); return; }
    const wear = t.closest('[data-wear]'); if (wear) { const it = scene().get().inventory.find(x => x.id === wear.dataset.wear); if (it?.worn) scene().unwearItem(it.id); else scene().wearItem(wear.dataset.wear); return; }
    const bag = t.closest('[data-tobag]'); if (bag) { scene().setItemKind(bag.dataset.tobag, ''); return; }
    const aro = t.closest('[data-arousal]'); if (aro) { scene().setArousal(selected, Number(aro.dataset.arousal)); return; }
    const mood = t.closest('[data-mood]');
    if (mood) { const cur = scene().get().bodies[selected]?.mood; scene().setMood(selected, mood.dataset.mood, cur?.lvl ?? 2); return; }
    const itq = t.closest('[data-itq]'); if (itq) { const [id, d] = itq.dataset.itq.split('|'); const i = scene().get().inventory.find(x => x.id === id); if (i) { if (i.qty + Number(d) < 1) scene().removeItem(id); else scene().updateItem(id, { qty: i.qty + Number(d) }); } return; }
    const delit = t.closest('[data-delitem]'); if (delit) { scene().removeItem(delit.dataset.delitem); return; }
    const who = t.closest('[data-who]');
    if (who) { selected = who.dataset.who; return render(); }
    const tier = t.closest('[data-tier]'); if (tier) { scene().setTier(selected, Number(tier.dataset.tier)); return; }
    const bnd = t.closest('[data-bnd]'); if (bnd) { scene().toggleBandage(selected, bnd.dataset.bnd); return; }
    const heal = t.closest('[data-heal]'); if (heal) { scene().removeWound(selected, heal.dataset.heal); return; }
    const delw = t.closest('[data-delw]'); if (delw) { scene().removeWound(selected, delw.dataset.delw); return; }
    const delc = t.closest('[data-delc]'); if (delc) { scene().removeCondition(selected, delc.dataset.delc); return; }
    const zone = t.closest('[data-zone]');
    if (zone) { if (tab !== 'state') { tab = 'state'; render(); } draftZone = zone.dataset.zone; const sel = win.querySelector('#sj-wzone'); if (sel) { sel.value = draftZone; sel.closest('details')?.setAttribute('open', ''); } win.querySelector('#sj-wtxt')?.focus(); }
  };
  const onChange = event => {
    const el = event.target, d = el.dataset ?? {};
    if (d.give !== undefined) { if (el.value) scene().giveItem(d.give, el.value === '__party' ? '' : el.value); return; }
    if (d.togear !== undefined) { if (el.value) scene().setItemKind(d.togear, ...(p => [p.kind, p])(parseType(el.value))); return; }
    if (d.geartype !== undefined) { scene().updateGear(d.geartype, parseType(el.value)); return; }
    if (d.wtype !== undefined) { const k = WEAPON_KINDS.find(x => x.id === el.value); scene().updateGear(d.wtype, { wtype: el.value, ...(k ? { range: k.range } : {}) }); return; }
    if (d.ctype !== undefined) { scene().updateGear(d.ctype, { ctype: el.value }); return; }
    if (d.look !== undefined) { scene().updateGear(d.look, { look: Number(el.value) }); return; }
    if (d.cond !== undefined) { scene().updateGear(d.cond, { cond: el.value }); return; }
    if (d.moodlvl !== undefined) { const cur = scene().get().bodies[selected]?.mood; scene().setMood(selected, cur?.id ?? 'calm', Number(el.value)); return; }
    if (d.persona !== undefined) { if (el.checked) scene().setPersona(selected); else scene().clearPersonaLock(); return; }
    if (d.aliases !== undefined) { scene().setAliases(selected, el.value); return; }
    if (d.showworn !== undefined) { showWorn = el.checked; return render(); }
    if (d.present) scene().setPresent(selected, el.checked);
    else if (el.id === 'sj-wzone') draftZone = el.value;
  };
  const onKey = event => {
    if (event.key === 'Enter') {
      const id = event.target.id;
      if (id === 'sj-wtxt') { event.preventDefault(); win.querySelector('[data-act="addw"]')?.click(); }
      else if (id === 'sj-itname') { event.preventDefault(); win.querySelector('[data-act="additem"]')?.click(); }
      else if (id === 'sj-ctxt') { event.preventDefault(); win.querySelector('[data-act="addc"]')?.click(); }
      else if (id === 'sj-gname') { event.preventDefault(); win.querySelector('[data-act="addgear"]')?.click(); }
      else if (id === 'sj-cfind') { event.preventDefault(); const first = win.querySelector('#sj-cfinds [data-pick]'); if (first) { pickCard(first.dataset.pick); render(); win.querySelector('#sj-cfind')?.focus(); } }
      else if (event.target.dataset?.who !== undefined) { event.preventDefault(); selected = event.target.dataset.who; render(); }
      else if (event.target.dataset?.setsel !== undefined || event.target.dataset?.oset !== undefined) { event.preventDefault(); event.target.click(); }
    }
  };
  const onToggle = event => {
    const el = event.target;
    if (el?.dataset?.pack !== undefined) packOpen = el.open;
    else if (el?.dataset?.more !== undefined) moreOpen = el.open;
  };
  // поиск по анкетам: результаты обновляются на лету, окно целиком не перерисовывается (фокус остаётся в строке)
  const onInput = event => {
    if (event.target?.id !== 'sj-cfind') return;
    findQuery = event.target.value;
    const box = win.querySelector('#sj-cfinds');
    if (box) box.innerHTML = findHtml();
  };
  const onFindKey = event => {
    if (event.key === 'Escape' && event.target?.id === 'sj-cfind' && findQuery) { event.preventDefault(); event.stopPropagation(); findQuery = ''; event.target.value = ''; const box = win.querySelector('#sj-cfinds'); if (box) box.innerHTML = ''; }
  };
  win.addEventListener('click', onClick);
  win.addEventListener('change', onChange);
  win.addEventListener('keydown', onFindKey, true);
  win.addEventListener('keydown', onKey);
  win.addEventListener('input', onInput);
  win.addEventListener('toggle', onToggle, true);

  // события чата приходят по ходу игры: пока человек печатает в окне, не перерисовываем
  const unsubscribe = scene()?.subscribe(info => {
    if (!shell.isOpen) return;
    if (!info?.hasChat) return shell.close();
    if (win.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'range') return;
    render();
  });

  function open(personId) {
    const info = scene()?.get();
    if (!info?.hasChat) return;
    if (typeof personId === 'string' && info.cast.some(p => p.id === personId)) { selected = personId; tab = 'state'; }
    loadStylesheetOnce('sj-sil-css', STYLE_HREF);
    scene().seedCast();                       // пустой список заполняется персоной и персонажами чата
    shell.show(info.state.calendar);
    render();
    win.focus();
  }

  shared.ui = { ...(shared.ui ?? {}), openState: open, closeState: shell.close };
  return () => {
    stopPulse?.();
    unsubscribe?.();
    win.removeEventListener('click', onClick);
    win.removeEventListener('change', onChange);
    win.removeEventListener('keydown', onKey);
    win.removeEventListener('keydown', onFindKey, true);
    win.removeEventListener('input', onInput);
    win.removeEventListener('toggle', onToggle, true);
    shell.destroy();
    if (shared.ui) { delete shared.ui.openState; delete shared.ui.closeState; }
  };
}
