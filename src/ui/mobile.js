/**
 * Телефонный вид: один признак на всё расширение (html[data-sj-mobile]).
 * Включается на узком экране либо когда Таверна считает устройство мобильным и экран не шире WIDE_LIMIT.
 */
const NARROW = '(max-width: 800px)';
const WIDE_LIMIT = 1100;   // телефон лёжа или малый планшет: ещё тесно, шире уже обычная раскладка

export function isMobileView() {
  try {
    if (window.matchMedia(NARROW).matches) return true;
    const byDevice = Boolean(globalThis.SillyTavern?.getContext?.().isMobile?.());
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
