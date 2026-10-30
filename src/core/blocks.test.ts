import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAiDocBlock, CASCADE_LIMIT } from './transformer'
import { compactSource } from './compactor'
import { detectDirective } from './directives'
import { toCascadeGraph } from './dependents'
import { extractAiDocs } from './scanner'
import { inferRole } from '../enricher/basicEnricher'

function tempFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'aidoc-blocks-')), name)
  writeFileSync(path, content)
  return path
}

const deps = Array.from({ length: 18 }, (_, i) => `src/app/api/r${i}/route.ts`)

// Block written by aidoc-kit 1.5 for a file with 18 dependents.
const LEGACY = [
  '/**',
  ' * @ai-agent auth-expert',
  ' * @ai-agent-hint If you are not the auth-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.',
  ' * @ai-runtime UNIVERSEL',
  ' *',
  ' * @ai-context',
  ' * [GENERATED] This file exports: getSession',
  ` * Imported by: ${deps.join(', ')}`,
  ' * [HIGH-IMPACT] 18 dependents detected. Prefer small, isolated changes.',
  ' *',
  ' * @ai-when-modifying',
  ' * 1. Check cascade files below before modifying',
  ' * 2. After modifying, ask the developer to run @ai-validate',
  ' * 3. If you have no terminal access, report the command to run',
  ' *',
  ' * @ai-cascade',
  ...deps.map(d => ` * - ${d}`),
  ' *',
  ' * @ai-validate',
  ' * pnpm tsc --noEmit',
  ' */',
].join('\n')
const BODY = "\nexport function getSession(): string { return 'ok' }\n"

test('blocks: compact format keeps only what is specific to the file', () => {
  const file = tempFile('session.ts', BODY)
  const block = generateAiDocBlock(file, deps, { validate: 'npm run typecheck' })
  assert.ok(!block.includes('@ai-agent-hint'))
  assert.ok(!block.includes('@ai-when-modifying'))
  assert.ok(!block.includes('Imported by'))
  assert.ok(!block.includes('@ai-runtime'), 'universal runtime is omitted')
  assert.match(block, /@ai-cascade \[HIGH-IMPACT\] 18 dependents, most depended-on first:/)
  assert.equal(block.split('\n').filter(l => l.startsWith(' * - src/')).length, CASCADE_LIMIT)
  assert.match(block, / \* - \.\.\. 13 more: /)
  assert.ok(/^[\x20-\x7e\n]*$/.test(block), 'block is ASCII')
  assert.ok(block.length < LEGACY.length * 0.3, `${block.length} vs ${LEGACY.length}`)
})

test('blocks: the scanner reads the compact format', () => {
  const file = tempFile('session.ts', generateAiDocBlock(tempFile('s.ts', BODY), deps.slice(0, 2), {}) + BODY)
  const docs = extractAiDocs(file)
  assert.equal(docs?.context, '[GENERATED] This file exports: getSession')
  assert.equal(docs?.validate, 'npm run typecheck')
  assert.deepEqual(docs?.cascade, ['2 dependents:', '- src/app/api/r0/route.ts', '- src/app/api/r1/route.ts'])
})

test('blocks: a file without dependents gets no @ai-cascade', () => {
  assert.ok(!generateAiDocBlock(tempFile('a.ts', BODY), [], {}).includes('@ai-cascade'))
})

test('blocks: compactSource rewrites a legacy block and keeps agent and validate', () => {
  const file = tempFile('session.ts', LEGACY + BODY)
  const out = compactSource(LEGACY + BODY, generateAiDocBlock(file, deps, {}))
  assert.equal(out.status, 'compacted')
  if (out.status !== 'compacted') return
  assert.ok(out.source.endsWith(BODY))
  assert.match(out.source, / \* @ai-agent auth-expert\n/)
  assert.match(out.source, / \* @ai-validate pnpm tsc --noEmit\n/)
  assert.ok(!out.source.includes('@ai-when-modifying'))
  assert.ok(out.source.length < (LEGACY + BODY).length / 3)
})

test('blocks: compactSource keeps an LLM-enriched context', () => {
  const enriched = LEGACY.replace(' * [GENERATED] This file exports: getSession', ' * Reads the session cookie and returns the signed-in user.\n * @ai-enriched 2026-09-01')
  const source = enriched + BODY
  const out = compactSource(source, generateAiDocBlock(tempFile('s.ts', source), deps, {}))
  assert.equal(out.status, 'compacted')
  if (out.status !== 'compacted') return
  assert.match(out.source, / \* @ai-context\n \* Reads the session cookie and returns the signed-in user\.\n/)
  assert.match(out.source, / \* @ai-enriched 2026-09-01\n/)
})

test('blocks: compactSource leaves hand-edited and compact blocks alone', () => {
  const withNever = LEGACY.replace(' * @ai-validate', ' * @ai-never\n * - Log tokens\n *\n * @ai-validate')
  assert.deepEqual(compactSource(withNever + BODY, ''), { status: 'skipped', reason: 'edited' })
  const customRule = LEGACY.replace('3. If you have no terminal access, report the command to run', '3. Keep the cookie name in sync with the edge config')
  assert.deepEqual(compactSource(customRule + BODY, ''), { status: 'skipped', reason: 'edited' })
  const compact = generateAiDocBlock(tempFile('s.ts', BODY), deps, {})
  assert.deepEqual(compactSource(compact + BODY, compact), { status: 'skipped', reason: 'already compact' })
  assert.deepEqual(compactSource(BODY, ''), { status: 'skipped', reason: 'no block' })
})

test('directives: a leading @ai-* block does not hide use client', () => {
  const hook = `${LEGACY}\n'use client'\n\nexport function useThing() {}\n`
  assert.equal(detectDirective(hook), 'client')
  assert.equal(detectDirective("// note\n'use server'\n"), 'server')
  assert.equal(detectDirective("#!/usr/bin/env node\n/* x */\n\"use client\""), 'client')
  assert.equal(detectDirective("export const a = 'use client'"), null)
  assert.equal(inferRole('src/hooks/use-thing.ts', hook).role, 'client')
})

test('dependents: the knowledge base keeps every dependent', () => {
  const root = '/p'
  const map = new Map([['/p/src/a.ts', deps.map(d => `/p/${d}`)], ['/p/src/b.ts', []]])
  const graph = toCascadeGraph(map, root)
  assert.equal(graph['src/a.ts'].length, 18)
  assert.ok(!('src/b.ts' in graph))
})
