/**
 * @ai-agent general-expert
 * @ai-agent-hint If you are not the general-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GENERATED] This file exports: getDependents, getDependencies, getCriticalFiles
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
import type { EnrichedGraph } from './types'

// Minimal query helpers over the enriched graph. Richer APIs (getCallers at
// symbol level, getImpact, search) are planned on top of the CodeGraph
// database itself — see ARCHITECTURE.md.

/** Files that import/call/reference the given file (direct dependents). */
export function getDependents(graph: EnrichedGraph, file: string): string[] {
  return [...new Set(graph.edges.filter(e => e.to === file).map(e => e.from))]
}

/** Files the given file imports/calls/references (direct dependencies). */
export function getDependencies(graph: EnrichedGraph, file: string): string[] {
  return [...new Set(graph.edges.filter(e => e.from === file).map(e => e.to))]
}

/** Files at or above a criticality level, most critical first. */
export function getCriticalFiles(
  graph: EnrichedGraph,
  minLevel: 'medium' | 'high' | 'critical' = 'high',
): EnrichedGraph['files'] {
  const order = { low: 0, medium: 1, high: 2, critical: 3 }
  return graph.files
    .filter(f => order[f.criticalityLevel] >= order[minLevel])
    .sort((a, b) => b.criticality - a.criticality)
}
