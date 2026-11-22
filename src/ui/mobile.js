/**
 * Телефонный вид: один признак на всё расширение (html[data-sj-mobile]).
 * Включается на узком экране либо когда Таверна считает устройство мобильным и экран не шире WIDE_LIMIT.
 */
const NARROW = '(max-width: 800px)';
const WIDE_LIMIT = 1100;   // телефон лёжа или малый планшет: ещё тесно, шире уже обычная раскладка

/** Выбор человека в настройках: auto, on (телефонный вид всегда), off (никогда). */
export function mobileMode() {
  try {
    const v = globalThis.SillyTavern?.getContext?.().extensionSettings?.sceneJournal?.mobileMode;
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch { return 'auto'; }
}

export function isMobileView() {
  try {
    const mode = mobileMode();
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    if (window.matchMedia(NARROW).matches) return true;
    // телефон или планшет: тип устройства по версии Таверны или сенсорный экран (в режиме «версия для компьютера» ширина около 980)
    const byDevice = Boolean(globalThis.SillyTavern?.getContext?.().isMobile?.()) || window.matchMedia('(pointer: coarse)').matches;
    return byDevice && window.innerWidth <= WIDE_LIMIT;
  } catch { return false; }
}

const root = document.documentElement;
const listeners = new Set();
export function syncMobile() {
  const on = isMobileView();
  if (on) root.dataset.sjMobile = '1'; else delete root.dataset.sjMobile;
  for (const fn of listeners) { try { fn(on); } catch { /* слушатель не должен ронять остальных */ } }
  return on;
}
/** Подписка на смену вида; сразу вызывает слушателя с текущим состоянием. */
export function onMobileChange(fn) { listeners.add(fn); fn(isMobileView()); return () => listeners.delete(fn); }

window.addEventListener('resize', syncMobile);
window.addEventListener('orientationchange', syncMobile);
syncMobile();
