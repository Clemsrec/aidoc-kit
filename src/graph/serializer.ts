/**
 * @ai-agent general-expert
 * @ai-agent-hint If you are not the general-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GENERATED] This file exports: GRAPH_FILENAME, writeEnrichedGraph, readEnrichedGraph
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EnrichedGraph } from './types'

export const GRAPH_FILENAME = 'aidoc-graph.json'

/**
 * Write the enriched graph at the project root. Files and edges are already
 * sorted by path in the loader, so successive runs produce stable diffs.
 */
export function writeEnrichedGraph(graph: EnrichedGraph, projectRoot: string): string {
  const outPath = join(projectRoot, GRAPH_FILENAME)
  writeFileSync(outPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8')
  return outPath
}

/** Read a previously generated aidoc-graph.json, or null when absent/invalid. */
export function readEnrichedGraph(projectRoot: string): EnrichedGraph | null {
  const path = join(projectRoot, GRAPH_FILENAME)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as EnrichedGraph
    return parsed.version === 1 ? parsed : null
  } catch {
    return null
  }
}
