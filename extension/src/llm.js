/**
 * Вспомогательная модель Архивариуса (малые запросы без участия основной модели чата).
 * Подключение двух видов, оба идут через сервер Таверны, так что ключ остаётся на сервере:
 *  - 'profile': профиль подключения из Connection Manager;
 *  - 'custom': любой OpenAI-совместимый адрес (URL, ключ, имя модели).
 * Запросы встают в одну очередь с паузой между ними, при перегрузке (429) повторяются с нарастающей задержкой.
 */
export const AUX_DEFAULTS = Object.freeze({ mode: 'off', profileId: '', url: '', key: '', model: '', maxTokens: 4096, fallbackToMain: false, minGapMs: 1200 });

const CHAT_PATH = '/api/backends/chat-completions';
const REQUEST_TIMEOUT_MS = 180_000;
const RETRY_DELAYS_MS = [3000, 8000, 15000];

// ---------- простые помощники ----------
const asMessages = prompt => (Array.isArray(prompt)
  ? prompt.map(m => ({ role: m.role, content: String(m.content ?? '') }))
  : [{ role: 'user', content: String(prompt ?? '') }]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const trimBase = url => String(url ?? '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
const hostName = url => { try { return new URL(url).host; } catch { return String(url ?? '').slice(0, 40) || 'адрес не задан'; } };
const tokenLimit = (aux, override) => {
  const n = Number(override ?? aux.maxTokens) || 4096;
  return n < 256 ? 256 : n > 32000 ? 32000 : n;
};

/** Подключение готово к запросам. */
export function auxReady(aux) {
  if (!aux) return false;
  if (aux.mode === 'profile') return Boolean(aux.profileId);
  if (aux.mode === 'custom') return Boolean(aux.url) && Boolean(aux.model);
  return false;
}

/** Профили подключений Таверны, годные для запросов: [{ id, name }]. */
export function listProfiles(context) {
  try {
    const found = context.ConnectionManagerRequestService?.getSupportedProfiles?.() ?? [];
    return found.map(p => ({ id: p.id, name: p.name || p.id }));
  } catch {
    return [];
  }
}

/** Ошибка перегрузки (429, 503, 529) или лимита: повтор имеет смысл, запасной путь через основную модель только добавил бы нагрузки. */
export const isRateLimit = error => /\b(429|503|529)\b|too many requests|rate.?limit|слишком много|overload/i.test(String(error?.message ?? error));

// ---------- запрос к серверу Таверны ----------
function customHeaders(url, key) {
  return {
    chat_completion_source: 'custom',
    custom_url: trimBase(url),
    ...(key ? { custom_include_headers: JSON.stringify({ Authorization: `Bearer ${key}` }) } : {}),
  };
}

async function postJson(context, path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const seconds = Math.round(REQUEST_TIMEOUT_MS / 1000);
  try {
    let response;
    try {
      response = await fetch(path, { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify(payload), signal: controller.signal });
    } catch (error) {
      throw new Error(controller.signal.aborted ? `Вспомогательный API молчит уже ${seconds} с` : `Сервер Таверны недоступен: ${error?.message ?? error}`);
    }
    let body = '';
    try {
      body = await response.text();
    } catch {
      if (controller.signal.aborted) throw new Error(`Вспомогательный API не дослал ответ за ${seconds} с`);
    }
    if (!response.ok) throw new Error(`Вспомогательный API: код ${response.status} ${body.slice(0, 200)}`.trim());
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`Вспомогательный API прислал не JSON: ${body.slice(0, 120)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Один запрос без очереди и повторов; возвращает текст ответа. */
export async function auxGenerate(context, aux, prompt, { maxTokens } = {}) {
  const messages = asMessages(prompt);
  const limit = tokenLimit(aux, maxTokens);

  if (aux.mode === 'profile') {
    const service = context.ConnectionManagerRequestService;
    if (!service) throw new Error('Эта версия Таверны не умеет работать с профилями подключений.');
    if (!aux.profileId) throw new Error('Профиль подключения не выбран.');
    const reply = await service.sendRequest(aux.profileId, messages, limit);
    const text = typeof reply === 'string' ? reply : reply?.content;
    if (typeof text !== 'string' || text.trim() === '') throw new Error('Профиль подключения ответил пустотой.');
    return text;
  }

  if (aux.mode === 'custom') {
    if (!aux.url || !aux.model) throw new Error('Заполните адрес и модель.');
    const data = await postJson(context, `${CHAT_PATH}/generate`, {
      ...customHeaders(aux.url, aux.key), model: aux.model, messages, max_tokens: limit, stream: false, temperature: 0.3,
    });
    if (data?.error) throw new Error(`Вспомогательный API: ${data.error.message ?? 'ошибка провайдера'}`);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') throw new Error('Вспомогательный API ответил пустотой.');
    return text;
  }

  throw new Error('Вспомогательная модель не задана.');
}

// ---------- очередь и журнал запросов ----------
const requestLog = [];
const LOG_LIMIT = 80;
const remember = entry => {
  requestLog.push({ at: Date.now(), ...entry });
  if (requestLog.length > LOG_LIMIT) requestLog.shift();
};
/** Последние запросы расширения (новые в конце): { at, where, main, ok, limit?, ms, msg? }. Основную модель мы трогаем только запасным путём. */
export const getRequestLog = () => [...requestLog];

let tail = Promise.resolve();
let lastFinished = 0;
/** Все запросы Архивариуса идут строго по одному, между ними пауза не меньше gap; ошибка одного запроса очередь не останавливает. */
function enqueue(gap, task) {
  const turn = tail.then(async () => {
    const wait = lastFinished + gap - Date.now();
    if (wait > 0) await pause(wait);
    try {
      return await task();
    } finally {
      lastFinished = Date.now();
    }
  });
  tail = turn.catch(() => undefined);
  return turn;
}

/**
 * Запрос с очередью, паузой и повторами при перегрузке (три раза, паузы 3, 8 и 15 с).
 * Запасной путь на основную модель включается только при ошибках, не связанных с лимитом.
 */
export async function generate(context, aux, prompt, options) {
  const gap = Math.min(Math.max(Number(aux.minGapMs ?? 1200) || 0, 0), 20_000);
  const where = aux.mode === 'custom' ? `вспомогательная: ${hostName(aux.url)}` : 'вспомогательная: профиль подключения';
  let failure = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const began = Date.now();
    try {
      const text = await enqueue(gap, () => auxGenerate(context, aux, prompt, options));
      remember({ where, main: false, ok: true, ms: Date.now() - began });
      return text;
    } catch (error) {
      failure = error;
      const limited = isRateLimit(error);
      remember({ where, main: false, ok: false, limit: limited, ms: Date.now() - began, msg: String(error?.message ?? error).slice(0, 120) });
      if (!limited || attempt === RETRY_DELAYS_MS.length) break;
      await pause(RETRY_DELAYS_MS[attempt]);
    }
  }

  const canFallback = !isRateLimit(failure) && aux.fallbackToMain && typeof context.generateRaw === 'function';
  if (!canFallback) throw failure;
  const label = 'ОСНОВНАЯ модель (запасной путь)';
  const began = Date.now();
  try {
    const text = await context.generateRaw({ prompt: asMessages(prompt) });
    remember({ where: label, main: true, ok: true, ms: Date.now() - began });
    return text;
  } catch (error) {
    remember({ where: label, main: true, ok: false, limit: isRateLimit(error), ms: Date.now() - began, msg: String(error?.message ?? error).slice(0, 120) });
    throw error;
  }
}

// ---------- проверка связи и список моделей ----------
/** Крошечный запрос: ответ должен содержать OK. */
export async function testConnection(context, aux) {
  const began = Date.now();
  const reply = await auxGenerate(context, aux, [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 256 });
  return { ok: /ok/i.test(reply), text: reply.trim().slice(0, 60), ms: Date.now() - began };
}

/** Модели OpenAI-совместимого адреса для выпадающего списка. */
export async function fetchModels(context, url, key) {
  if (!url) throw new Error('Для списка моделей нужен адрес.');
  const data = await postJson(context, `${CHAT_PATH}/status`, customHeaders(url, key));
  if (data?.error) throw new Error(data.message || 'Провайдер не вернул моделей: проверьте адрес и ключ.');
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const names = rows.map(row => String(row?.id ?? row ?? '')).filter(Boolean);
  return [...new Set(names)].sort();
}

// ---------- разбор JSON из ответа модели ----------
/** Достаёт первый сбалансированный JSON-объект из текста (с оградами ``` и болтовнёй вокруг). Бросает ошибку, если не нашёл. */
export function parseJsonObject(raw) {
  const text = String(raw ?? '').replace(/```(?:json)?/gi, '');
  const first = text.indexOf('{');
  if (first < 0) throw new Error('В ответе нет JSON.');
  let depth = 0, quoted = false, skip = false;
  for (let i = first; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (skip) skip = false;
      else if (ch === '\\') skip = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(first, i + 1));
      } catch {
        throw new Error('JSON в ответе повреждён.');
      }
    }
  }
  throw new Error('JSON в ответе оборван (возможно, не хватило лимита токенов).');
}
