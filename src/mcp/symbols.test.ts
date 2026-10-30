import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findSymbol, traceSymbol } from './symbols'
import { readGuard } from '../hooks/read-guard'
import { toolDefinitions, DEFAULT_TOOLS } from './tools'

type Node = [id: string, kind: string, name: string, file: string, start: number, end: number, signature: string]

/** A project with a minimal CodeGraph database: form -> action -> computeFee. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'aidoc-symbols-'))
  mkdirSync(join(root, '.codegraph'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/fee.ts'), 'export function computeFee(cents: number): number {\n  return Math.round(cents * 0.2)\n}\n')
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(join(root, '.codegraph/codegraph.db'))
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT, file_path TEXT, start_line INTEGER,
      end_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
    CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
    CREATE TABLE files (path TEXT PRIMARY KEY, generated INTEGER);
  `)
  const nodes: Node[] = [
    ['n1', 'component', 'InvoiceForm', 'src/form.tsx', 1, 40, '()'],
    ['n2', 'function', 'createInvoiceAction', 'src/actions.ts', 10, 30, '(input: Input)'],
    ['n3', 'function', 'computeFee', 'src/fee.ts', 1, 3, '(cents: number): number'],
    ['n4', 'function', 'computeFee', 'src/fee.test.ts', 1, 5, '()'],
    ['n5', 'function', 'computeFeeLabel', 'src/generated/api.ts', 1, 2, '()'],
  ]
  const insert = db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)')
  for (const [id, kind, name, file, start, end, signature] of nodes) insert.run(id, kind, name, name, file, start, end, signature)
  const edge = db.prepare('INSERT INTO edges (source, target, kind, line) VALUES (?, ?, ?, ?)')
  edge.run('n1', 'n2', 'calls', 12)
  edge.run('n2', 'n3', 'calls', 20)
  edge.run('n2', 'n3', 'references', 20)
  db.close()
  return root
}

test('symbols: find_symbol shows definition, callers, callees and code for one match', () => {
  const out = findSymbol(project(), 'createInvoiceAction')
  assert.match(out, /function `createInvoiceAction` \(input: Input\) — src\/actions\.ts:10-30/)
  assert.match(out, /Used by \(1\):\n {2}- `InvoiceForm` \(component\) src\/form\.tsx:12/)
  assert.match(out, /Uses \(1\):\n {2}- `computeFee` \(function\) src\/fee\.ts:20/, 'calls and references at one site count once')
})

test('symbols: exact name first, test and generated files last', () => {
  const out = findSymbol(project(), 'computeFee')
  const order = ['src/fee.ts', 'src/fee.test.ts', 'src/generated/api.ts'].map(f => out.indexOf(f))
  assert.ok(order[0] < order[1] && order[1] < order[2], out)
  assert.match(findSymbol(project(), 'computeFee', 'src/fee.ts'), /```ts\nexport function computeFee/)
  assert.match(findSymbol(project(), 'nothing'), /No symbol matching/)
})

test('symbols: trace follows calls in both directions', () => {
  const root = project()
  assert.match(traceSymbol(root, 'InvoiceForm', 'callees', 3), /- `createInvoiceAction` \(function\) src\/actions\.ts:10 <- called at line 12\n {2}- `computeFee` \(function\) src\/fee\.ts:1 <- called at line 20/)
  assert.match(traceSymbol(root, 'computeFee', 'callers', 2, 'src/fee.ts'), /- `createInvoiceAction` \(function\) src\/actions\.ts:20\n {2}- `InvoiceForm` \(component\) src\/form\.tsx:12/)
})

test('symbols: without an index the tools say so', () => {
  const root = mkdtempSync(join(tmpdir(), 'aidoc-noindex-'))
  assert.match(findSymbol(root, 'x'), /No CodeGraph index/)
})

test('mcp: four tools are exposed by default', () => {
  assert.deepEqual(toolDefinitions(false).map(t => t.name).sort(), [...DEFAULT_TOOLS].sort())
  assert.ok(toolDefinitions(true).length > DEFAULT_TOOLS.length)
})

test('read guard: whole reads of large source files get the structure instead', () => {
  const root = mkdtempSync(join(tmpdir(), 'aidoc-guard-'))
  const big = join(root, 'big.ts')
  writeFileSync(big, Array.from({ length: 500 }, (_, i) => `export const v${i} = ${i}`).join('\n'))
  writeFileSync(join(root, 'small.ts'), 'export const a = 1\n')
  const decision = readGuard({ tool_name: 'Read', cwd: root, tool_input: { file_path: big } })
  assert.equal(decision?.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(decision?.hookSpecificOutput.permissionDecisionReason ?? '', /big\.ts has 500 lines[\s\S]*offset=1 limit=500[\s\S]*## Public exports/)
  assert.equal(readGuard({ tool_name: 'Read', cwd: root, tool_input: { file_path: big, offset: 10, limit: 20 } }), null)
  assert.equal(readGuard({ tool_name: 'Read', cwd: root, tool_input: { file_path: join(root, 'small.ts') } }), null)
  assert.equal(readGuard({ tool_name: 'Grep', cwd: root, tool_input: {} }), null)
  assert.equal(readGuard({ tool_name: 'Read', cwd: root, tool_input: { file_path: join(root, 'notes.md') } }), null)
  assert.equal(readGuard('garbage'), null)
})
