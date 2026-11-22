/**
 * Летящий куб для проверки «бросить куб» (плашка 🎲 в строке сцены): 1d20 или 2d20 с преимуществом или помехой, как в расширении «Кубик d20».
 * Движок (физика и отрисовка на canvas) лежит в dice-engine.js. Результат выбирается заранее через crypto, анимация его только доигрывает.
 * Итог ни в поле ввода, ни в чат не вписывается: после приземления он записывается в проверку (scene.rollCheck) и уходит рассказчику
 * тем же путём, что и без анимации, а в строке остаётся значок с числом и исходом.
 */
import { DiceStage, customTheme, rollInt, evaluate } from './dice-engine.js';
import { OUTCOME_RU } from '../core/fate.js';
import { report } from '../guard.js';

let stage = null, stageEl = null, resultEl = null, busy = false, hideTimer = 0;

/** Любой CSS-цвет (hex, hsl, rgb) → #rrggbb через canvas; '' если не получилось. */
function toHex(css) {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillStyle = String(css).trim();
    return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle : '';
  } catch { return ''; }
}

/** Цвета кубика из палитры окон (мир или выбранный цвет): тело из панели, цифры цветом акцента. */
function themeFrom(el) {
  const cs = getComputedStyle(el ?? document.body);
  const body = toHex(cs.getPropertyValue('--panel2')) || '#262838';
  const num = toHex(cs.getPropertyValue('--accent')) || '#ecc979';
  return customTheme(body, num);
}

function hide() {
  clearTimeout(hideTimer);
  resultEl?.classList.remove('show');
  stageEl?.classList.remove('show');
  setTimeout(() => { if (!busy && stage && !stageEl.classList.contains('show')) stage.clear(); }, 450);
}

function ensureStage() {
  if (stageEl?.isConnected && stage) return;
  stageEl = document.createElement('div');
  stageEl.className = 'sj-dstage';
  const canvas = document.createElement('canvas');
  resultEl = document.createElement('div');
  resultEl.className = 'sj-dresult';
  resultEl.title = 'Клик: убрать';
  resultEl.addEventListener('click', hide);
  stageEl.append(canvas, resultEl);
  document.body.append(stageEl);
  stage = new DiceStage(canvas);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !busy) hide(); });
}

function showResult(results, check, res) {
  const rule = check.mode === 'advantage' ? 'adv' : check.mode === 'disadvantage' ? 'dis' : 'sum';
  const ev = evaluate(results, results.length === 2 ? rule : 'sum', 20);
  if (results.length === 2 && ev.kept >= 0) stage.setDim(1 - ev.kept, true);       // отброшенный кубик тускнеет
  const outcome = res ? OUTCOME_RU[res.outcome] : '';
  const hit = res && ['hit', 'crit-hit', 'fail', 'crit-fail'].includes(res.outcome);
  resultEl.className = `sj-dresult${ev.crit ? ` ${ev.crit}` : ''}${res ? (hit ? ' bad' : ' ok') : ''}`;
  resultEl.innerHTML = '<div class="m"></div><div class="s"></div>';
  resultEl.firstChild.textContent = ev.main;
  resultEl.lastChild.textContent = [ev.sub || (ev.crit === 'crit' ? 'Критический успех' : ev.crit === 'fumble' ? 'Критический провал' : ''), `сложность ${check.dc}`, outcome].filter(Boolean).join(' · ');
  const a = stage.anchor();
  if (a) {
    resultEl.style.left = `${Math.min(Math.max(a.x, 110), window.innerWidth - 110)}px`;
    resultEl.style.top = `${Math.min(a.y, window.innerHeight - 90)}px`;
  }
  requestAnimationFrame(() => resultEl.classList.add('show'));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, 3800);
}

/**
 * Бросок проверки с летящим кубом. scene: shared.scene; fromEl: плашка, из которой вылетает куб (её центр).
 * Возвращает true, если бросок запущен. При «уменьшить движение» или сбое анимации бросок просто записывается без неё.
 */
export function rollCheckWithDice({ scene, fromEl }) {
  const check = scene?.get?.()?.fate?.check;
  const fate = scene?.get?.()?.fate;
  if (!check || check.roll || busy || fate?.mode === 'intimacy' || fate?.heat) return false;       // в интимной сцене куб не летит
  const count = check.mode === 'normal' ? 1 : 2;                                    // 1d20, а с преимуществом или помехой 2d20
  const results = Array.from({ length: count }, () => rollInt(20));
  const calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (calm) { scene.rollCheck({ dice: results }); return true; }
  try {
    ensureStage();
    busy = true;
    clearTimeout(hideTimer);
    resultEl.classList.remove('show');
    stageEl.classList.add('show');
    const r = fromEl?.getBoundingClientRect?.();
    stage.throwDice({
      results, sides: 20,
      from: r ? [r.left + r.width / 2, r.top + r.height / 2] : [window.innerWidth / 2, window.innerHeight - 60],
      size: 52, theme: themeFrom(fromEl),
      onLanded: () => {
        busy = false;
        let res = null;
        try { res = scene.rollCheck({ dice: results }); } catch (error) { report('запись броска', error); }
        showResult(results, check, res);
      },
    });
  } catch (error) {
    busy = false;
    report('бросок куба', error);
    scene.rollCheck({ dice: results });                                              // анимация сорвалась: бросок всё равно засчитывается
  }
  return true;
}
