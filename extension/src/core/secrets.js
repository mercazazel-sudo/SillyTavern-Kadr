/**
 * Заглушка модуля «Тайны» для публичной демо-версии: учёт того, кто что знает, знакомств и гибели выключен.
 * Подставляется сборщиком tools/build-public.mjs вместо src/core/secrets.js; данные остаются пустыми.
 */
export const ACQUAINTANCE = Object.freeze(['known', 'seen', 'strangers']);
export const emptyKnowledge = () => ({ events: [], learned: [], acquaintances: {}, deaths: {} });
export const normalizeKnowledge = () => emptyKnowledge();
export const pairKey = (a, b) => [String(a), String(b)].sort().join('|');
export const knowledgeLines = () => [];
export const findLoreEvent = () => null;
export const appendWatchLog = (_previous, text) => String(text ?? '');
export const dossier = () => ({ knows: [], doesNotKnow: [] });
export const RULE = '';
