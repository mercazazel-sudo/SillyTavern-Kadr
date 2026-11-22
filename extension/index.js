/** Точка входа. Каждый модуль стартует отдельно, и ошибка одного не мешает остальным. */
import { TAG, report } from './src/guard.js';
import { getSettings, saver } from './src/settings.js';
import { startScene } from './src/scene-service.js';
import { startSceneWindow } from './src/ui/scene-window.js';
import { startStrip } from './src/ui/strip.js';
import { startLetterWindow } from './src/ui/letter-window.js';
import { startCalendarWindow } from './src/ui/calendar-window.js';
import { startStateWindow } from './src/ui/state-window.js';
import { startJournalWindow } from './src/ui/journal-window.js';
import { startSettingsWindow } from './src/ui/settings-window.js';
import { startRelationsWindow } from './src/ui/relations-window.js';
import { startChronicle } from './src/chronicle-service.js';
import { startDigest } from './src/digest-service.js';
import { startChronicleWindow } from './src/ui/chronicle-window.js';
import { startCards } from './src/cards-service.js';
import { startPlaceLore } from './src/placelore-service.js';
import { startCardsWindow } from './src/ui/cards-window.js';
import { startMapWindow } from './src/ui/map-window.js';
import { startSelection } from './src/ui/selection.js';
import { startHub } from './src/ui/hub.js';
import { FEATURES } from './src/core/features.js';
import { startRequestWatch } from './src/request-watch.js';
import { setTheme } from './src/ui/theme.js';
import { startSetupWindow } from './src/ui/setup-window.js';

/** Порядок важен: окна и строка читают сервис сцены. */
const MODULES = [
  { name: 'наблюдатель за запросами к моделям', start: deps => startRequestWatch(deps) },
  { name: 'сцена (время, место, блок рассказчику)', start: deps => startScene(deps) },
  { name: 'окно «Обстановка»', start: deps => startSceneWindow(deps) },
  { name: 'окно «Секретное письмо»', start: deps => startLetterWindow(deps) },
  { name: 'окно «Календарь»', start: deps => startCalendarWindow(deps) },
  { name: 'окно «Состояние»', start: deps => startStateWindow(deps) },
  { name: 'окно «Журнал»', start: deps => startJournalWindow(deps) },
  { name: 'Архивариус (служба)', start: deps => startChronicle(deps) },
  { name: 'сжатие контекста (служба)', start: deps => startDigest(deps) },
  { name: 'анкеты (служба)', start: deps => startCards(deps) },
  { name: 'секреты лорбуков (служба)', on: FEATURES.secrets, start: async deps => (await import('./src/secrets-service.js')).startSecrets(deps) },
  { name: 'записи лорбука у мест (служба)', start: deps => startPlaceLore(deps) },
  { name: 'строка сцены', start: deps => startStrip(deps) },
  { name: 'окно «Тайны»', on: FEATURES.secrets, start: async deps => (await import('./src/ui/secrets-window.js')).startSecretsWindow(deps) },
  { name: 'окно «d20 жизни»', on: FEATURES.fate, start: async deps => (await import('./src/ui/fate-window.js')).startFateWindow(deps) },
  { name: 'окно «Анкеты»', start: deps => startCardsWindow(deps) },
  { name: 'окно «Карта»', start: deps => startMapWindow(deps) },
  { name: 'окно «Отношения»', start: deps => startRelationsWindow(deps) },
  { name: 'окно «Архивариус»', start: deps => startChronicleWindow(deps) },
  { name: 'окно «Настройки»', start: deps => startSettingsWindow(deps) },
  { name: 'мастер первой настройки', start: deps => startSetupWindow(deps) },
  { name: 'плашка выделения («В журнал», «В тайны»)', start: deps => startSelection(deps) },
  { name: 'пульт', start: deps => startHub(deps) },
];

let controller = null;

/** Вызывается Таверной при активации расширения (manifest.json → hooks.activate). */
export async function init() {
  if (controller) return controller;
  const context = globalThis.SillyTavern?.getContext?.();
  if (!context) { report('запуск', new Error('нет SillyTavern.getContext()')); return null; }
  const settings = getSettings(context);
  const deps = { context, settings, save: saver(context), shared: {}, bus: new EventTarget() };
  setTheme(settings.theme, settings.themeColor);
  const stops = [];
  for (const module of MODULES) {
    if (module.on === false) continue;
    try {
      const stop = await module.start(deps);
      if (typeof stop === 'function') stops.push(stop);
    } catch (error) { report(`модуль «${module.name}»`, error); }
  }
  controller = { deps, stop: () => { for (const fn of stops.reverse()) { try { fn(); } catch (error) { report('откат', error); } } controller = null; } };
  globalThis.SceneJournal = controller;   // для проверки из консоли и тестов
  console.info(`${TAG} запущено`);
  return controller;
}
