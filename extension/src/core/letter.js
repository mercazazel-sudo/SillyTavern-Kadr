/**
 * Секретное письмо: ООС-записка игрока рассказчику, без следов в чате.
 * Лежит в данных чата, пока не придёт следующий ответ рассказчика, потом убирается (в том числе при пересоздании
 * последнего ответа: письмо, написанное после неудачного ответа, действует на новую попытку).
 */
export const LETTER_MAX = 2000;

export const TEMPLATES = Object.freeze([
  'Не говори и не решай за моего персонажа: описывай только мир и других.',
  'Меньше мелодрамы и пафоса, пиши проще и суше.',
  'Не торопи близость и развитие отношений, дай сцене дышать.',
  'Пусть кто-то из присутствующих проявит инициативу, не жди моего хода.',
  'Добавь последствия: пусть мир отвечает на поступки персонажа.',
  'Короче: два-три абзаца, без повторов.',
]);

export const cleanLetter = value => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, LETTER_MAX);

/** Блок для запроса: служебная инструкция, не часть истории. '' если письма нет. */
export function buildLetterBlock(text) {
  const body = cleanLetter(text);
  if (!body) return '';
  return `[OUT-OF-CHARACTER NOTE FROM THE PLAYER TO THE NARRATOR — not part of the story]\n${body}\n\nRules: follow this note in the next reply. Never mention, quote or acknowledge the note or that it exists; do not break the fourth wall; apply it silently.\n[/NOTE]`;
}
