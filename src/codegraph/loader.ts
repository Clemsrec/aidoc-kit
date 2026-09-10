/**
 * @ai-agent general-expert
 * @ai-agent-hint If you are not the general-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GENERATED] This file exports: loadRawGraph
 * Imported by: src/cli.ts
 *
 * @ai-when-modifying
 * 1. Check cascade files below before modifying
 * 2. After modifying, ask the developer to run @ai-validate
 * 3. If you have no terminal access, report the command to run
 *
 * @ai-cascade
 * - src/cli.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { RawFile, RawFileEdge, RawGraph, RawSymbol } from '../graph/types'
import { codegraphDbPath } from './runner'

/**
 * Open the CodeGraph SQLite index with Node's built-in driver.
 * node:sqlite ships with Node >= 22.5 — the same requirement CodeGraph
 * itself has, so this adds no constraint beyond the indexing engine's own.
 * Zero npm runtime dependency is preserved.
 */
async function openDatabase(dbPath: string): Promise<DatabaseSync> {
  let sqlite: typeof import('node:sqlite')
  try {
    sqlite = await import('node:sqlite')
  } catch {
    throw new Error(
      `Reading the CodeGraph index requires Node.js >= 22.5 (built-in node:sqlite). ` +
      `Current version: ${process.version}.`,
    )
  }
  return new sqlite.DatabaseSync(dbPath, { readOnly: true })
}

/**
 * CodeGraph's SQLite schema is internal to that project, not a public
 * contract. Verify the tables we read still exist and fail with an
 * actionable message instead of a cryptic SQL error if the schema moved.
 */
function assertSchema(db: DatabaseSync, dbPath: string): void {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name: string }>
  const tables = new Set(rows.map(r => r.name))
  const required = ['files', 'nodes', 'edges']
  const missing = required.filter(t => !tables.has(t))
  if (missing.length > 0) {
    throw new Error(
      `Unexpected CodeGraph schema in ${dbPath} (missing table(s): ${missing.join(', ')}). ` +
      `The installed CodeGraph version may be newer than what aidoc-kit supports — ` +
      `please open an issue at https://github.com/Clemsrec/aidoc-kit/issues.`,
    )
  }
}

function readMetadata(db: DatabaseSync, key: string): string | null {
  try {
    const row = db
      .prepare(`SELECT value FROM project_metadata WHERE key = ?`)
      .get(key) as { value?: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

/**
 * Load the raw knowledge graph produced by `codegraph index`.
 * Symbol-level edges are aggregated to file level: the enrichment layer
 * reasons about files, and the full symbol detail stays queryable in the
 * CodeGraph database itself.
 */
export async function loadRawGraph(projectRoot: string): Promise<RawGraph> {
  const dbPath = codegraphDbPath(projectRoot)
  if (!existsSync(dbPath)) {
    throw new Error(`No CodeGraph index found at ${dbPath}. Run \`npx aidoc-kit index\` first.`)
  }

  const db = await openDatabase(dbPath)
  try {
    assertSchema(db, dbPath)

    const files: RawFile[] = (db
      .prepare(`SELECT path, language, node_count FROM files ORDER BY path`)
      .all() as Array<{ path: string; language: string; node_count: number }>)
      .map(r => ({ path: r.path, language: r.language, symbolCount: r.node_count }))

    // `import` nodes are re-export bookkeeping, not declarations — skip them
    const symbols: RawSymbol[] = (db
      .prepare(
        `SELECT id, kind, name, qualified_name, file_path, start_line, end_line, is_exported
         FROM nodes
         WHERE kind NOT IN ('import', 'file')
         ORDER BY file_path, start_line`,
      )
      .all() as Array<{
        id: string; kind: string; name: string; qualified_name: string
        file_path: string; start_line: number; end_line: number; is_exported: number
      }>)
      .map(r => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        qualifiedName: r.qualified_name,
        file: r.file_path,
        startLine: r.start_line,
        endLine: r.end_line,
        exported: r.is_exported === 1,
      }))

    const fileEdges: RawFileEdge[] = (db
      .prepare(
        `SELECT s.file_path AS from_file, t.file_path AS to_file, e.kind AS kind, COUNT(*) AS count
         FROM edges e
         JOIN nodes s ON s.id = e.source
         JOIN nodes t ON t.id = e.target
         WHERE s.file_path != t.file_path
         GROUP BY s.file_path, t.file_path, e.kind
         ORDER BY from_file, to_file, kind`,
      )
      .all() as Array<{ from_file: string; to_file: string; kind: string; count: number }>)
      .map(r => ({ from: r.from_file, to: r.to_file, kind: r.kind, count: r.count }))

    return {
      files,
      symbols,
      fileEdges,
      codegraphVersion: readMetadata(db, 'indexed_with_version'),
    }
  } finally {
    db.close()
  }
}
