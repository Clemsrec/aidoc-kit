import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractAiDocs } from './scanner'

function docsOf(source: string): ReturnType<typeof extractAiDocs> {
  const path = join(mkdtempSync(join(tmpdir(), 'aidoc-scanner-')), 'file.ts')
  writeFileSync(path, source)
  return extractAiDocs(path)
}

// Shape written by `aidoc-kit scan --write`.
const GENERATED_BLOCK = [
  '/**',
  ' * @ai-agent general-expert',
  ' * @ai-agent-hint Consider switching agent',
  ' * @ai-runtime UNIVERSEL',
  ' *',
  ' * @ai-context',
  ' * [GENERE] Ce fichier exporte : a, b',
  ' * Importe dans : src/cli.ts',
  ' *',
  ' * @ai-when-modifying',
  ' * 1. Verifier les fichiers en cascade ci-dessous avant de modifier',
  ' * 2. Apres modification, indiquer au developpeur de lancer @ai-validate',
  ' *',
  ' * @ai-cascade',
  ' * - src/cli.ts',
  ' *',
  ' * @ai-validate',
  ' * npm run typecheck',
  ' */',
  'export const a = 1',
].join('\n')

test('extractAiDocs: a tag mentioned inside another tag is not read as that tag', () => {
  const docs = docsOf(GENERATED_BLOCK)
  assert.equal(docs?.validate, 'npm run typecheck')
  assert.equal(docs?.whenModifying.length, 2)
})

test('extractAiDocs: values below the tag are read, on one line', () => {
  const docs = docsOf(GENERATED_BLOCK)
  assert.equal(docs?.context, '[GENERE] Ce fichier exporte : a, b Importe dans : src/cli.ts')
  assert.equal(docs?.runtime, 'UNIVERSEL')
})

test('extractAiDocs: @ai-agent does not swallow @ai-agent-hint', () => {
  assert.equal(docsOf(GENERATED_BLOCK)?.agent, 'general-expert')
})

test('extractAiDocs: same-line values and lists keep working', () => {
  const docs = docsOf([
    '/**',
    ' * @ai-agent auth-expert',
    ' * @ai-agents-related billing-expert, types-expert',
    ' * @ai-validate pnpm tsc --noEmit',
    ' * @ai-never',
    ' * - Log tokens',
    ' */',
    'export const b = 2',
  ].join('\n'))
  assert.equal(docs?.agent, 'auth-expert')
  assert.deepEqual(docs?.related, ['billing-expert', 'types-expert'])
  assert.equal(docs?.validate, 'pnpm tsc --noEmit')
  assert.deepEqual(docs?.neverDo, ['- Log tokens'])
  assert.deepEqual(docs?.cascade, [])
})
