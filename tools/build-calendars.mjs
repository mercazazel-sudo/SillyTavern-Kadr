// Календари живут в одном исходнике data/calendars.js (его же читает мокап как обычный скрипт).
// Этот скрипт делает из него ES-модуль для расширения: src/core/calendars.js.
// Запуск: node tools/build-calendars.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'data', 'calendars.js'), 'utf8');

const apiStart = src.indexOf('  const api = {');
if (apiStart < 0) throw new Error('в data/calendars.js не найден блок const api');
const apiEnd = src.indexOf('};', apiStart);
const names = src.slice(apiStart, apiEnd).replace(/^[^{]*\{/, '').split(',').map(s => s.trim()).filter(Boolean);

let body = src.slice(0, apiStart);
body = body.replace(/^\(function \(root\) \{\r?\n/m, '');
const out = `// ФАЙЛ СОЗДАН СКРИПТОМ tools/build-calendars.mjs из data/calendars.js. Руками не править.\n${body}\nexport { ${names.join(', ')} };\n`;

const target = resolve(root, 'src', 'core', 'calendars.js');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, 'utf8');
console.log(`ok: ${target} (${names.length} экспортов: ${names.join(', ')})`);
