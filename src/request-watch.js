/**
 * Наблюдатель за запросами к моделям. Ничего не меняет и не отправляет: только запоминает, какие запросы к
 * /api/backends/chat-completions/generate уходили из этой страницы, какого они размера, куда и чем ответили.
 * Нужен, чтобы понять, чей запрос получил «Too Many Requests»: основной пост, фоновый запрос другого расширения или наш.
 */
const GENERATE = '/api/backends/chat-completions/generate';

export function startRequestWatch(deps) {
  const { shared, settings } = deps;
  const log = [];
  const realFetch = window.fetch;

  const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };

  /** Разбор тела запроса: размер, модель, адрес, чей он по виду. Любая ошибка разбора не мешает запросу. */
  function describe(body) {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : null;
      if (!data) return null;
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const chars = messages.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : JSON.stringify(m?.content ?? '').length), 0);
      const host = hostOf(data.custom_url) || String(data.chat_completion_source ?? '');
      const auxHost = hostOf(settings.aux?.url);
      let kind = 'фоновый запрос (Кулисы или другое расширение)';
      if (auxHost && host === auxHost && data.model === settings.aux?.model) kind = 'наш Архивариус';
      else if (chars >= 40000) kind = 'основной пост';
      return { kind, host, model: String(data.model ?? '').slice(0, 40), tokens: Math.round(chars / 3), stream: Boolean(data.stream) };
    } catch { return null; }
  }

  window.fetch = function watchedFetch(input, init) {
    let info = null, started = 0;
    try {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (String(url).includes(GENERATE) && String(init?.method ?? 'GET').toUpperCase() === 'POST') { info = describe(init?.body); started = Date.now(); }
    } catch { /* наблюдение не должно ломать запрос */ }
    const result = realFetch.apply(this, arguments);
    if (info) {
      const entry = { at: Date.now(), ...info, status: 0, ms: 0 };
      log.push(entry);
      if (log.length > 60) log.shift();
      result.then(response => { entry.status = response.status; entry.ms = Date.now() - started; }, () => { entry.status = -1; entry.ms = Date.now() - started; });
    }
    return result;
  };

  shared.watch = { get: () => [...log] };
  return () => {
    if (window.fetch !== realFetch) window.fetch = realFetch;
    delete shared.watch;
  };
}
