import { FEATURES } from './core/features.js';
import { AUX_DEFAULTS } from './llm.js';

/** Общие настройки живут в extensionSettings.sceneJournal: их сохраняет сама Таверна. */
export const KEY = 'sceneJournal';
export const DEFAULTS = Object.freeze({
  enabled: true,
  strip: true,            // строка сцены у поля ввода
  calendar: 'harptos',    // календарь для новых чатов
  setupOff: false,        // «Больше не показывать»: мастер настройки сам не открывается (по умолчанию открывается в каждом новом чате)
  themeColor: '#c8a24a',  // «свой цвет» в выборе цвета окон (работает, когда theme = 'custom')
  theme: '',              // цвет окон: пусто = по миру, иначе id палитры (перекрывает цвет мира)
  autoStep: true,         // время идёт само: каждый ответ рассказчика прибавляет минуты
  stepMinutes: 10,
  sendBlock: true,        // отправлять рассказчику блок о времени и месте
  sendHolidays: true,     // добавлять в блок праздники сегодняшнего дня из включённых слоёв
  sendQuests: true,       // сообщать рассказчику идущие квесты (цель, последняя запись, открытые и закрытые зацепки)
  sendRelations: true,    // сообщать рассказчику отношения тех, кто в кадре (числа превращены в подсказки поведения)
  relationsBudget: 4000,  // сколько знаков отношений уходит рассказчику, слабые линии срезаются первыми
  sendKnowledge: true,    // сообщать рассказчику, кто что знает (тайны, знакомства, погибшие)
  knowledgeBudget: 2000,  // сколько знаков уходит на тайны
  eye: { enabled: FEATURES.eye, watcher: FEATURES.eye ? 'Вестор' : '', devices: FEATURES.eye ? ['Всевидящее Око', 'Око', 'Scrying Eye'] : [], budget: 1000 },   // удалённый свидетель: пока устройство (Око) в комнате, всё сказанное записывается в журнал наблюдений и уходит наблюдателю, когда он в кадре
  sendFate: true,         // сообщать рассказчику режим сцены, одноразовые подсказки и броски
  fate: { includePersona: true, lethal: false, avoidRepeat: true, autoMode: true, diceCheck: true, autoWound: true },   // кости судьбы: задевать ли персону, смертельное, не повторять варианты
  shortRules: false,      // краткие правила в блоке (втрое короче). По умолчанию полные: разница около 550 токенов из 71 000, правила точнее
  sendPlaces: true,       // карточка текущего места (описание, приметы, перемены) уходит рассказчику
  holidayNotes: {},       // календарь: свои описания праздников { «мир|название»: текст }, дополняют или заменяют справку
  placeLinks: [],         // записи лорбука, привязанные к местам: [{ placeId, entry, file, when, how }]
  places: { nodes: [] },  // библиотека мест (общая для всех чатов); текущее место и находки лежат в данных чата
  sendInventory: true,    // сообщать рассказчику вещи тех, кто в кадре, и общие
  personaBookStrict: true, // лорбук персоны читается, только если в чат вошла привязанная к нему персона
  mapNestingDone: 0,      // версия восстановления вложенности и картинок мест из Кулис (2: с папкой «Лагерь»)
  cardsOnlyBound: true,   // анкеты читают только лорбуки, привязанные к чату, персонажу или выбранные глобально
  sendCards: true,        // анкеты персонажей: разделы по правилам «когда слать» вместо записей лорбука
  cardsBudget: 12000,     // сколько знаков анкет уходит рассказчику
  cards: { cards: [] },   // библиотека анкет (общая для всех чатов); набор подключённых лежит в данных чата
  sendCast: true,         // сообщать рассказчику, кто в кадре
  sendBody: true,         // и состояние тех, кто в кадре (раны, самочувствие); у кого всё в порядке, строки нет
  dayCounter: true,       // счётчик дней истории в строке сцены: Д1, Д2, Д3…
  weather: true,          // считать погоду (по сезону мира и климату чата)
  sendWeather: true,      // добавлять погоду в блок рассказчику
  weatherFromText: true,  // менять погоду, когда рассказчик пишет «пошёл дождь» и подобное
  tension: true,          // шкала напряжения сцены
  sendTension: true,      // сообщать напряжение рассказчику (на «спокойно» строка не отправляется)
  tensionFromText: true,  // сдвигать напряжение по словам рассказчика («обнажил меч», «погоня», «успокоил»)
  tensionDecay: 3,        // каждые N ответов без новых событий напряжение остывает на ступень (0 = не остывает)
  depth: 1,               // глубина вставки блока в чат
  aux: { ...AUX_DEFAULTS },                      // вспомогательная модель Архивариуса
  chronicle: { auto: true, journal: true, relations: true, scene: true, items: true, itemsAlways: true, body: true, place: true, autoApplyPlace: true, know: true, autoApplyKnow: true, requestMode: 'grouped', autoApplyJournal: true, autoApplyBody: true, autoApplyRelations: true, autoApplyScene: true, autoApplyItems: true },   // Архивариус: сам после ответа, и какие задачи
  digest: { enabled: true, keep: 6, batch: 6, words: 350, markHidden: true },   // сжатие контекста: сколько последних сообщений оставить, по сколько сжимать, длина сводки
  layers: {},             // выбранные слои праздников: { календарь: [id слоёв] }
});

export function getSettings(context) {
  const store = context.extensionSettings;
  store[KEY] = { ...DEFAULTS, ...(store[KEY] ?? {}) };
  store[KEY].aux = { ...AUX_DEFAULTS, ...(typeof store[KEY].aux === 'object' && store[KEY].aux ? store[KEY].aux : {}) };
  store[KEY].fate = { ...DEFAULTS.fate, ...(typeof store[KEY].fate === 'object' && store[KEY].fate ? store[KEY].fate : {}) };
  store[KEY].chronicle = { ...DEFAULTS.chronicle, ...(typeof store[KEY].chronicle === 'object' && store[KEY].chronicle ? store[KEY].chronicle : {}) };
  store[KEY].eye = { ...DEFAULTS.eye, ...(typeof store[KEY].eye === 'object' && store[KEY].eye ? store[KEY].eye : {}) };
  store[KEY].digest = { ...DEFAULTS.digest, ...(typeof store[KEY].digest === 'object' && store[KEY].digest ? store[KEY].digest : {}) };
  if (typeof store[KEY].layers !== 'object' || store[KEY].layers === null) store[KEY].layers = {};
  return store[KEY];
}
export const saver = context => () => context.saveSettingsDebounced?.();
