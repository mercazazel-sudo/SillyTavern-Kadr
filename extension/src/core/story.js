/**
 * Сам рассказ без служебного обвеса. Ответы рассказчика часто начинаются с блока анализа <rp_preflight>…</rp_preflight>
 * (тысячи знаков про «Setting», «Present», «Goal») и могут содержать <details>…</details>: Архивариусам, детекторам погоды и
 * напряжения и поиску имён нужна только история, иначе служебные слова дают ложные срабатывания.
 */
export function storyText(mes) {
  let t = String(mes ?? '');
  t = t.replace(/<rp_preflight>[\s\S]*?<\/rp_preflight>/gi, ' ');
  t = t.replace(/<details[\s\S]*?<\/details>/gi, ' ');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  if (/<rp_preflight>/i.test(t) && !/<\/rp_preflight>/i.test(t)) t = t.slice(0, t.search(/<rp_preflight>/i));   // блок не закрыт: берём то, что до него
  return t.replace(/<\/?[a-z_]+>/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
