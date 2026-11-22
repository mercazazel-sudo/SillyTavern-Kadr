import test from 'node:test';
import assert from 'node:assert/strict';
import { latinKey, sameNameAcrossScripts, findAcrossScripts } from '../extension/src/core/names.js';

test('имена между алфавитами: Астарион и Astarion Ancunín — один человек', () => {
  assert.equal(latinKey('Астарион'), 'astarion');
  assert.equal(latinKey("Lae'zel"), 'laezel');
  assert.equal(latinKey('Astarion Ancunín'), 'astarion ancunin');
  assert.equal(sameNameAcrossScripts('Астарион', 'Astarion Ancunín'), true);
  assert.equal(sameNameAcrossScripts('Лаэзель', "Lae'zel"), true);
  assert.equal(sameNameAcrossScripts('Астарион', 'Gale Dekarios'), false);
  assert.equal(sameNameAcrossScripts('Ли', 'Lee'), false);                    // слова короче четырёх знаков не сравниваются
  assert.equal(findAcrossScripts([{ name: 'Gale' }, { name: 'Astarion Ancunín', aliases: [] }], 'Астарион')?.name, 'Astarion Ancunín');
});
