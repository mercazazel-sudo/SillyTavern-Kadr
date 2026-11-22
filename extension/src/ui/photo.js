/**
 * Фото человека для круглых аватарок: сначала из анкеты, а у персоны (игрока) из Таверны. Персоны в анкетах обычно нет, поэтому
 * без Таверны у неё была только буква. Персону ищем по имени среди персон Таверны (список avatar → имя), иначе берём выбранную в панели.
 */
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Адрес миниатюры персоны Таверны по её имени; '' если не нашлась. */
export function personaPhoto(name) {
  try {
    const personas = globalThis.SillyTavern?.getContext?.().powerUserSettings?.personas ?? {};
    const want = norm(name);
    const hit = want ? Object.entries(personas).find(([, n]) => norm(n) === want) : null;
    if (hit) return `/thumbnail?type=persona&file=${encodeURIComponent(hit[0])}`;
    const sel = document.querySelector('#user_avatar_block .avatar-container.selected')?.getAttribute('data-avatar-id');
    if (sel && (!want || norm(personas[sel]) === want || !Object.keys(personas).length)) return `/thumbnail?type=persona&file=${encodeURIComponent(sel)}`;
    const last = [...document.querySelectorAll('#chat .mes[is_user="true"] .avatar img')].pop();
    return last?.getAttribute('src') || '';
  } catch { return ''; }
}

/** Фото человека: из анкеты, у персоны из Таверны. */
export function photoFor(shared, person) {
  const card = shared.cards?.get()?.cards?.find(c => c.person?.id === person.id && c.image)?.image;
  return card || (person.persona ? personaPhoto(person.name) : '');
}
