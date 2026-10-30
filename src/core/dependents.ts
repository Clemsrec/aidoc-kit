import { relative } from 'node:path'
import { readEnrichedGraph } from '../graph/serializer'

function toRel(projectRoot: string, abs: string): string {
  return relative(projectRoot, abs).split('\\').join('/')
}

/**
 * Orders dependents for an @ai-cascade block, which only shows the first few:
 * by criticality when aidoc-graph.json exists, else by how many files import them.
 * Takes and returns absolute paths in, project-relative paths out.
 */
export function dependentRanker(reverseMap: Map<string, string[]>, projectRoot: string): (importers: string[]) => string[] {
  const graph = readEnrichedGraph(projectRoot)
  const criticality = new Map(graph?.files.map(f => [f.file, f.criticality]) ?? [])
  const score = (abs: string): number => criticality.get(toRel(projectRoot, abs)) ?? (reverseMap.get(abs)?.length ?? 0)
  return importers => [...importers]
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b))
    .map(f => toRel(projectRoot, f))
}

/** Full dependents of every file, project-relative, for the knowledge base. */
export function toCascadeGraph(reverseMap: Map<string, string[]>, projectRoot: string): Record<string, string[]> {
  const graph: Record<string, string[]> = {}
  for (const [file, importers] of reverseMap) {
    if (importers.length === 0) continue
    graph[toRel(projectRoot, file)] = importers.map(f => toRel(projectRoot, f)).sort()
  }
  return graph
}
