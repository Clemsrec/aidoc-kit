import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ToolInputError, callTool, findTextReferences, readTagValue, resolveProjectPath } from './tools'
import type { EnrichedFile, EnrichedGraph } from '../graph/types'

function file(path: string, overrides: Partial<EnrichedFile> = {}): EnrichedFile {
  return {
    file: path, language: 'typescript', role: 'universal', roleReason: 'no client/server signal',
    criticality: 0, criticalityLevel: 'low', inDegree: 0, outDegree: 0, tags: [], symbolCount: 1,
    ...overrides,
  }
}

const AUTH_SOURCE = `/**
 * @ai-agent auth-expert
 * @ai-runtime SERVER UNIQUEMENT
 *
 * @ai-context
 * Session helpers
 *
 * @ai-never
 * - Log tokens
 *
 * @ai-validate
 * npm run typecheck
 */
export function getSession(): string { return 'ok' }
`

function fixture(withGraph = true): string {
  const root = mkdtempSync(join(tmpdir(), 'aidoc-mcp-'))
  const write = (rel: string, content: string): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  write('src/lib/auth.ts', AUTH_SOURCE)
  write('src/app/page.tsx', "import { getSession } from '../lib/auth'\nexport default function Page() { return getSession() }\n")
  write('config/routes.json', '{ "guard": "src/lib/auth.ts" }\n')
  write('src/big.ts', Array.from({ length: 200 }, (_, i) => `export const v${i} = ${i}`).join('\n') + '\n')
  if (withGraph) {
    const graph: EnrichedGraph = {
      version: 1,
      generatedAt: '2099-01-01T00:00:00.000Z',
      codegraph: { version: '1.6.0' },
      stats: { files: 3, edges: 1, client: 1, server: 1, universal: 1 },
      files: [
        file('src/app/page.tsx', { role: 'client', criticality: 10, outDegree: 1 }),
        file('src/big.ts'),
        file('src/lib/auth.ts', { role: 'server', criticality: 80, criticalityLevel: 'critical', inDegree: 1, tags: ['auth'] }),
      ],
      edges: [{ from: 'src/app/page.tsx', to: 'src/lib/auth.ts', kind: 'imports', count: 1 }],
    }
    write('aidoc-graph.json', JSON.stringify(graph))
  }
  return root
}

test('mcp tools: paths outside the project root are refused', () => {
  const root = fixture()
  assert.throws(() => resolveProjectPath(root, '../etc/passwd'), ToolInputError)
  assert.throws(() => resolveProjectPath(root, '/etc/passwd'), ToolInputError)
  assert.throws(() => resolveProjectPath(root, '.'), ToolInputError)
  const outside = mkdtempSync(join(tmpdir(), 'aidoc-outside-'))
  writeFileSync(join(outside, 'secret.ts'), 'x')
  symlinkSync(outside, join(root, 'escape'))
  assert.throws(() => resolveProjectPath(root, 'escape/secret.ts'), ToolInputError)
  assert.equal(resolveProjectPath(root, './src/lib/auth.ts').rel, 'src/lib/auth.ts')
})

test('mcp tools: invalid arguments are rejected', () => {
  const root = fixture()
  assert.throws(() => callTool(root, 'file_info', {}), ToolInputError)
  assert.throws(() => callTool(root, 'file_info', { path: 'src/lib/auth.ts', extra: 1 }), ToolInputError)
  assert.throws(() => callTool(root, 'context_for_edit', { path: 'src/lib/auth.ts', maxTokens: 10 }), ToolInputError)
  assert.throws(() => callTool(root, 'critical_files', { minLevel: 'low' }), ToolInputError)
  assert.throws(() => callTool(root, 'nope', {}), ToolInputError)
})

test('mcp tools: context_for_edit gathers graph, rules, dependents and text references', () => {
  const root = fixture()
  const out = callTool(root, 'context_for_edit', { path: 'src/lib/auth.ts' })
  assert.match(out, /Criticality: critical \(80\/100\)/)
  assert.match(out, /High criticality/)
  assert.match(out, /no source file modified since/)
  assert.match(out, /Never:\n {2}- Log tokens/)
  assert.match(out, /Validate with: `npm run typecheck`/)
  assert.match(out, /`src\/app\/page\.tsx` — low \(10\), client/)
  assert.match(out, /`config\/routes\.json:1`/)
})

test('mcp tools: context_for_edit respects the size budget', () => {
  const root = fixture()
  const out = callTool(root, 'context_for_edit', { path: 'src/big.ts', maxTokens: 500 })
  assert.ok(out.length <= 500 * 4 + 100, `got ${out.length} chars`)
  assert.match(out, /truncated to fit the size budget/)
})

test('mcp tools: text references skip graph dependents and generated cascade lines', () => {
  const root = fixture()
  writeFileSync(join(root, 'src/other.ts'), '/**\n * @ai-cascade\n * - src/lib/auth.ts\n */\nexport const a = 1\n')
  const refs = findTextReferences(root, 'src/lib/auth.ts', new Set(['config/routes.json']))
  assert.deepEqual(refs, [])
})

test('mcp tools: read_chunk summarises large files and declines small ones', () => {
  const root = fixture()
  assert.match(callTool(root, 'read_chunk', { path: 'src/big.ts' }), /## Public exports/)
  assert.match(callTool(root, 'read_chunk', { path: 'src/lib/auth.ts' }), /under 150 lines/)
})

test('mcp tools: graph tools degrade gracefully without aidoc-graph.json', () => {
  const root = fixture(false)
  assert.match(callTool(root, 'dependents', { path: 'src/lib/auth.ts' }), /npx aidoc-kit index/)
  assert.match(callTool(root, 'graph_status', {}), /not found/)
  const ctx = callTool(root, 'context_for_edit', { path: 'src/lib/auth.ts' })
  assert.match(ctx, /Agent: auth-expert/)
  assert.match(ctx, /config\/routes\.json:1/)
})

test('mcp tools: critical_files and dependents rank by criticality', () => {
  const root = fixture()
  assert.match(callTool(root, 'critical_files', {}), /`src\/lib\/auth\.ts` — critical \(80\), server, 1 dependent\(s\), auth/)
  assert.match(callTool(root, 'dependencies', { path: 'src/app/page.tsx' }), /`src\/lib\/auth\.ts` — critical/)
})

test('mcp tools: readTagValue ignores mentions of a tag inside another tag', () => {
  const source = [
    '/**',
    ' * @ai-context',
    ' * Exports a, b',
    ' * Imported by: src/cli.ts',
    ' *',
    ' * @ai-when-modifying',
    ' * 1. Ask the developer to run @ai-validate',
    ' *',
    ' * @ai-validate',
    ' * npm run typecheck',
    ' */',
  ].join('\n')
  assert.equal(readTagValue(source, 'ai-validate'), 'npm run typecheck')
  assert.equal(readTagValue(source, 'ai-context'), 'Exports a, b Imported by: src/cli.ts')
  assert.equal(readTagValue('export const a = 1', 'ai-validate'), '')
})
