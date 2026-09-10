/**
 * @ai-agent types-expert
 * @ai-agent-hint If you are not the types-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GENERATED] This file exports: RawFile, RawSymbol, RawFileEdge, RawGraph, FileRole, CriticalityLevel, EnrichedFile, EnrichedGraph
 * Imported by: src/codegraph/loader.ts, src/enricher/basicEnricher.ts, src/graph/query.ts, src/graph/serializer.ts
 *
 * @ai-when-modifying
 * 1. Check cascade files below before modifying
 * 2. After modifying, ask the developer to run @ai-validate
 * 3. If you have no terminal access, report the command to run
 *
 * @ai-cascade
 * - src/codegraph/loader.ts
 * - src/enricher/basicEnricher.ts
 * - src/graph/query.ts
 * - src/graph/serializer.ts
 *
 * @ai-validate
 * npm run typecheck
 */
// ─── Raw graph (read from CodeGraph's SQLite index) ────────────────────────

/** One indexed source file, as reported by CodeGraph. */
export interface RawFile {
  /** Project-relative path */
  path: string
  language: string
  symbolCount: number
}

/** A symbol extracted by CodeGraph (subset of its `nodes` table). */
export interface RawSymbol {
  id: string
  /** function, method, class, interface, constant, type_alias… */
  kind: string
  name: string
  qualifiedName: string
  /** Project-relative path of the declaring file */
  file: string
  startLine: number
  endLine: number
  exported: boolean
}

/** A file-to-file relation aggregated from CodeGraph's symbol-level edges. */
export interface RawFileEdge {
  from: string
  to: string
  /** imports, calls, references, extends… */
  kind: string
  /** Number of symbol-level edges collapsed into this file-level edge */
  count: number
}

/** The raw knowledge graph read from `.codegraph/codegraph.db`. */
export interface RawGraph {
  files: RawFile[]
  symbols: RawSymbol[]
  /** Cross-file edges only (same-file edges are dropped during aggregation) */
  fileEdges: RawFileEdge[]
  /** CodeGraph version that produced the index, when recorded */
  codegraphVersion: string | null
}

// ─── Enriched graph (aidoc-kit's intelligence layer) ───────────────────────

/** Execution role of a file, inferred by the enricher. */
export type FileRole = 'client' | 'server' | 'universal'

export type CriticalityLevel = 'low' | 'medium' | 'high' | 'critical'

/** One file with aidoc-kit's enrichment layered on top of the raw graph. */
export interface EnrichedFile {
  file: string
  language: string
  role: FileRole
  /** How the role was determined — directive, path rule or content heuristic */
  roleReason: string
  /** 0-100, see basicEnricher for the formula */
  criticality: number
  criticalityLevel: CriticalityLevel
  /** Distinct files that import/call/reference this one */
  inDegree: number
  /** Distinct files this one imports/calls/references */
  outDegree: number
  /** Domain tags inferred from the path: api, auth, billing, payment… */
  tags: string[]
  symbolCount: number
}

/** The enriched graph serialized to `aidoc-graph.json`. */
export interface EnrichedGraph {
  /** Format version — bump on breaking changes to this shape */
  version: 1
  generatedAt: string
  codegraph: { version: string | null }
  stats: {
    files: number
    edges: number
    client: number
    server: number
    universal: number
  }
  files: EnrichedFile[]
  edges: RawFileEdge[]
}
