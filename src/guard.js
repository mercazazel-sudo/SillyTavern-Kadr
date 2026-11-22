/** Ошибка одного модуля не должна ронять остальные. */
export const TAG = '[Кадр]';

export function report(where, error) {
  console.error(`${TAG} ${where}:`, error);
}

/** Вызывает fn; при ошибке пишет в консоль и возвращает fallback. */
export function safe(where, fn, fallback = undefined) {
  try { return fn(); } catch (error) { report(where, error); return fallback; }
}
