/**
 * Значки видов одежды (core/gear.js, CLOTHING_KINDS): готовые цветные рисунки в extension/assets/clothes/<вид>.png,
 * один квадрат на все, прозрачный фон. В отличие от значков оружия они не перекрашиваются темой: по цвету видно материал
 * (сталь, кожа, ткань). Возвращают тег img; для неизвестного вида пустую строку (окно покажет значок слота).
 */
const BASE = new URL('../../assets/clothes/', import.meta.url).href;

export const CLOTH_ICON_IDS = Object.freeze(['plate', 'mail', 'leather', 'robe', 'cloth', 'doublet', 'cloak', 'gloves', 'bracers', 'gauntlets', 'sabatons', 'boots', 'shoes', 'helmet', 'cap', 'hat', 'hood', 'camp']);

/** Значок вида одежды (тег img) или '' для неизвестного вида. Для лагерной одежды look (1..10) выбирает облик. */
export function clothIcon(kindId, look = 1) {
  if (!CLOTH_ICON_IDS.includes(kindId)) return '';
  const file = kindId === 'camp' ? `camp${Math.min(Math.max(Math.trunc(Number(look)) || 1, 1), 10)}` : kindId;
  return `<img class="ci" src="${BASE}${file}.png" alt="" draggable="false">`;
}

// Пустой слот: призрачный силуэт вещи этого слота (маска, красится акцентом темы), рисунки в extension/assets/slots/<слот>.png
const SLOT_BASE = new URL('../../assets/slots/', import.meta.url).href;
export const SLOT_ICON_IDS = Object.freeze(['head', 'cloak', 'body', 'hands', 'feet']);
/** Значок пустого слота (span-маска) или '' для неизвестного слота. */
export function slotIcon(slotId) {
  if (!SLOT_ICON_IDS.includes(slotId)) return '';
  return `<span class="wi sph" role="img" style="--wi:url('${SLOT_BASE}${slotId}.png')"></span>`;
}
