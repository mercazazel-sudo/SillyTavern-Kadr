/**
 * Значки видов оружия (core/gear.js, WEAPON_KINDS): рисунки в extension/assets/weapons/<вид>.png это маски (белый цвет, форма
 * и плотность в прозрачности). Значок рисуется как CSS-маска (.wi) поверх цветной заливки, поэтому красится цветом акцента
 * темы и не требует отдельных картинок под каждую тему. Для неизвестного вида возвращается пустая строка (окно покажет общий значок).
 * Размер задаёт CSS (.wi), значок масштабируется вместе со шрифтом места, куда вставлен.
 */
const BASE = new URL('../../assets/weapons/', import.meta.url).href;

export const WEAPON_ICON_IDS = Object.freeze(['sword', 'dagger', 'axe', 'hammer', 'mace', 'spear', 'staff', 'bow', 'crossbow']);

/** Значок вида оружия (span-маска) или '' для неизвестного вида. */
export function weaponIcon(kindId) {
  if (!WEAPON_ICON_IDS.includes(kindId)) return '';
  return `<span class="wi" role="img" style="--wi:url('${BASE}${kindId}.png')"></span>`;
}
