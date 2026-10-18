// Offline parser tests; no browser, server, user files or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/glossary.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}
new Function('exports', js)(exports)
const { parseGlossary, validateEntries, glossaryCSV } = exports
const sample = [{ term: 'A,B', translation: 'first\nsecond "quote"' }, { term: '王妃', translation: 'Queen' }]
assert.deepEqual(parseGlossary(glossaryCSV(sample)), sample)
assert.deepEqual(parseGlossary('\uFEFFterm\ttranslation\r\n王妃\tQueen\r\n'), [sample[1]])
for (const text of ['term,translation\nA,', 'term,translation\nA,b\na,c', 'term,translation\n"A,b', 'term,translation\nA,b,c', 'term,translation\n"A"oops,b']) {
  assert.throws(() => validateEntries(parseGlossary(text)))
}
assert.throws(() => parseGlossary('x'.repeat(1024 * 1024 + 1)))
console.log('8/8 offline glossary checks passed')
