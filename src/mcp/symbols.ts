import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { codegraphDbPath } from '../codegraph/runner'

// Symbol-level queries over the CodeGraph index (functions, components, their
// call sites). One call here replaces a chain of Grep + Read round trips.

interface SymbolRow {
  id: string
  kind: string
  name: string
  file_path: string
  start_line: number
  end_line: number
  signature: string | null
  docstring: string | null
  is_exported: number
}

interface EdgeRow {
  kind: string
  line: number | null
  id: string
  name: string
  node_kind: string
  file_path: string
  start_line: number
}

const SEARCHABLE_KINDS = ['function', 'method', 'component', 'class', 'constant', 'variable', 'route', 'interface', 'type_alias', 'enum']
const FLOW_EDGES = ['calls', 'instantiates', 'references', 'navigates']
const MAX_MATCHES = 12
const DETAILED_MATCHES = 3
const MAX_LINKS = 15
const SNIPPET_LINES = 20
const TRACE_MAX_NODES = 40

const NO_INDEX =
  'No CodeGraph index found (.codegraph/). Ask the developer to run `npx aidoc-kit index`; until then, use Grep.'

const cache = new Map<string, { db: DatabaseSync; mtime: number }>()

/** Read-only handle on the project's CodeGraph database, reopened when it changes. */
function openIndex(projectRoot: string): DatabaseSync | null {
  const path = codegraphDbPath(projectRoot)
  if (!existsSync(path)) return null
  const mtime = statSync(path).mtimeMs
  const cached = cache.get(projectRoot)
  if (cached && cached.mtime === mtime) return cached.db
  cached?.db.close()
  let sqlite: typeof import('node:sqlite')
  try {
    // Synchronous require: tool handlers are synchronous. node:sqlite needs Node >= 22.5.
    sqlite = require('node:sqlite') as typeof import('node:sqlite')
  } catch {
    return null
  }
  const db = new sqlite.DatabaseSync(path, { readOnly: true })
  cache.set(projectRoot, { db, mtime })
  return db
}

function location(file: string, line: number | null): string {
  return line ? `${file}:${line}` : file
}

function describe(row: SymbolRow): string {
  const exported = row.is_exported === 1 ? 'exported ' : ''
  const signature = row.signature ? ` ${row.signature.replace(/\s+/g, ' ').slice(0, 160)}` : ''
  return `${exported}${row.kind} \`${row.name}\`${signature} — ${row.file_path}:${row.start_line}-${row.end_line}`
}

function snippet(projectRoot: string, row: SymbolRow): string | null {
  try {
    const lines = readFileSync(join(projectRoot, row.file_path), 'utf-8').split('\n')
    const end = Math.min(row.end_line, row.start_line + SNIPPET_LINES - 1)
    const body = lines.slice(row.start_line - 1, end).join('\n')
    const more = row.end_line > end ? `\n// ... ${row.end_line - end} more line(s), read ${row.file_path} offset ${end + 1}` : ''
    return '```ts\n' + body + more + '\n```'
  } catch {
    return null
  }
}

function incoming(db: DatabaseSync, id: string): EdgeRow[] {
  const rows = db.prepare(
    `SELECT e.kind, e.line, s.id, s.name, s.kind AS node_kind, s.file_path, s.start_line
     FROM edges e JOIN nodes s ON s.id = e.source
     WHERE e.target = ? AND e.kind IN (${FLOW_EDGES.map(() => '?').join(',')})
     ORDER BY s.file_path, e.line`,
  ).all(id, ...FLOW_EDGES) as unknown as EdgeRow[]
  return dedupe(rows)
}

function outgoing(db: DatabaseSync, id: string): EdgeRow[] {
  const rows = db.prepare(
    `SELECT e.kind, e.line, t.id, t.name, t.kind AS node_kind, t.file_path, t.start_line
     FROM edges e JOIN nodes t ON t.id = e.target
     WHERE e.source = ? AND e.kind IN (${FLOW_EDGES.map(() => '?').join(',')})
     ORDER BY e.line`,
  ).all(id, ...FLOW_EDGES) as unknown as EdgeRow[]
  return dedupe(rows)
}

const GENERATED_PATH = /(^|\/)[^/]*generated[^/]*\//
const TEST_FILE = /(\.test|\.spec)\.[jt]sx?$|(^|\/)(__tests__|tests?)\//

/**
 * Exact and partial (case-insensitive) matches, best first: exact name,
 * outside test files, exported, shortest name.
 */
function lookup(db: DatabaseSync, name: string, file?: string): SymbolRow[] {
  const kinds = SEARCHABLE_KINDS.map(() => '?').join(',')
  const fileClause = file ? ' AND file_path = ?' : ''
  const rows = db.prepare(
    `SELECT n.id, n.kind, n.name, n.file_path, n.start_line, n.end_line, n.signature, n.docstring, n.is_exported,
            COALESCE(f.generated, 0) AS generated
     FROM nodes n LEFT JOIN files f ON f.path = n.file_path
     WHERE n.name LIKE ? ESCAPE '\\' AND n.kind IN (${kinds})${fileClause.replace('file_path', 'n.file_path')} LIMIT 500`,
  ).all(`%${name.replace(/[\\%_]/g, c => `\\${c}`)}%`, ...SEARCHABLE_KINDS, ...(file ? [file] : [])) as unknown as (SymbolRow & { generated: number })[]
  const rank = (r: SymbolRow & { generated: number }): number[] => [
    r.name === name ? 0 : r.name.toLowerCase() === name.toLowerCase() ? 1 : 2,
    r.generated === 1 || GENERATED_PATH.test(r.file_path) ? 2 : TEST_FILE.test(r.file_path) ? 1 : 0,
    r.is_exported === 1 ? 0 : 1,
    r.name.length,
  ]
  return rows
    .sort((x, y) => {
      const a = rank(x), b = rank(y)
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
      return x.file_path.localeCompare(y.file_path) || x.start_line - y.start_line
    })
    .slice(0, MAX_MATCHES)
}

function dedupe(rows: EdgeRow[]): EdgeRow[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    const key = `${r.id}:${r.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function linkList(rows: EdgeRow[], label: string): string[] {
  if (rows.length === 0) return []
  const shown = rows.slice(0, MAX_LINKS).map(r => `  - \`${r.name}\` (${r.node_kind}) ${location(r.file_path, r.line ?? r.start_line)}`)
  const more = rows.length > MAX_LINKS ? [`  - ... ${rows.length - MAX_LINKS} more`] : []
  return [`- ${label} (${rows.length}):`, ...shown, ...more]
}

/** Definition, signature, callers and callees of the symbols matching `name`. */
export function findSymbol(projectRoot: string, name: string, file?: string): string {
  const db = openIndex(projectRoot)
  if (!db) return NO_INDEX
  const matches = lookup(db, name, file)
  if (matches.length === 0) return `No symbol matching "${name}"${file ? ` in ${file}` : ''}. Try a shorter name, or Grep for text.`

  const out = [`# Symbols matching "${name}" (${matches.length}${matches.length === MAX_MATCHES ? '+' : ''})`]
  if (matches.length > DETAILED_MATCHES) {
    // Many candidates: one line each, so the agent picks one and asks again.
    for (const row of matches) {
      const callers = incoming(db, row.id).length
      out.push(`- ${describe(row)}${callers > 0 ? ` (used by ${callers})` : ''}`)
    }
    out.push('', 'Call find_symbol with an exact name (and "file" if needed) for callers, callees and code.')
    return out.join('\n')
  }
  for (const row of matches) {
    out.push('', `## ${describe(row)}`)
    if (row.docstring) out.push(row.docstring.split('\n').map(l => l.replace(/^\s*(\/\*\*|\*\/|\*)\s?/, '')).filter(Boolean).slice(0, 3).join(' '))
    // Callers matter most for "who uses this"; callees for "what does it do".
    out.push(...linkList(incoming(db, row.id), 'Used by'))
    out.push(...linkList(outgoing(db, row.id), 'Uses'))
  }
  if (matches.length === 1) {
    const code = snippet(projectRoot, matches[0])
    if (code) out.push('', code)
  }
  return out.join('\n')
}

/**
 * Call chain around one symbol: what it calls, recursively ("callees"), or
 * what leads to it ("callers"), as an indented tree with call sites.
 */
export function traceSymbol(projectRoot: string, name: string, direction: 'callers' | 'callees', depth: number, file?: string): string {
  const db = openIndex(projectRoot)
  if (!db) return NO_INDEX
  const matches = lookup(db, name, file)
  if (matches.length === 0) return `No symbol matching "${name}". Use find_symbol to search by part of the name.`
  if (matches.length > 1 && matches[0].name !== name) {
    return `Several symbols match "${name}": ${matches.map(m => `\`${m.name}\` (${m.file_path})`).join(', ')}. Call trace again with the exact name, or with "file".`
  }
  const root = matches[0]
  const step = direction === 'callees' ? outgoing : incoming
  const lines = [`# ${direction === 'callees' ? 'What' : 'Who'} \`${root.name}\` ${direction === 'callees' ? 'calls' : 'is called by'}, depth ${depth}`, describe(root), '']
  const seen = new Set([root.id])
  let count = 0

  const walk = (id: string, level: number): void => {
    if (level > depth || count >= TRACE_MAX_NODES) return
    for (const edge of step(db, id)) {
      if (count >= TRACE_MAX_NODES) break
      const repeat = seen.has(edge.id)
      lines.push(`${'  '.repeat(level - 1)}- \`${edge.name}\` (${edge.node_kind}) ${location(edge.file_path, direction === 'callees' ? edge.start_line : edge.line)}${direction === 'callees' && edge.line ? ` <- called at line ${edge.line}` : ''}${repeat ? ' (see above)' : ''}`)
      count++
      if (!repeat) {
        seen.add(edge.id)
        walk(edge.id, level + 1)
      }
    }
  }
  walk(root.id, 1)
  if (count === 0) lines.push(`_No ${direction} found in the index._`)
  if (count >= TRACE_MAX_NODES) lines.push(`_Stopped after ${TRACE_MAX_NODES} entries: trace a deeper symbol to continue._`)
  return lines.join('\n')
}
