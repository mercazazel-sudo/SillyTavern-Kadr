/** Мелочи для интерфейса. */
export const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ждёт появления элемента (Таверна достраивает интерфейс после загрузки). Возвращает элемент или null по таймауту. */
export function waitFor(selector, timeoutMs = 20000) {
  return new Promise(resolve => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const timer = setTimeout(() => { observer.disconnect(); resolve(document.querySelector(selector)); }, timeoutMs);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { clearTimeout(timer); observer.disconnect(); resolve(el); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}
