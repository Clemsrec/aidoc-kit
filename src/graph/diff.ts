import type { EnrichedFile, EnrichedGraph } from './types'

export interface GraphDiff {
  addedFiles: string[]
  removedFiles: string[]
  /** Files present in both graphs whose enrichment differs, with the fields that changed */
  changedFiles: Array<{ file: string; fields: string[] }>
  addedEdges: number
  removedEdges: number
}

const COMPARED_FIELDS: Array<keyof EnrichedFile> = [
  'language', 'role', 'roleReason', 'criticality', 'criticalityLevel',
  'inDegree', 'outDegree', 'tags', 'symbolCount',
]

/**
 * Compare a committed graph with a freshly computed one. `generatedAt` and
 * the CodeGraph version are deliberately ignored: only what an agent would
 * read counts, so regenerating an unchanged project is not reported as drift.
 */
export function diffEnrichedGraphs(committed: EnrichedGraph, fresh: EnrichedGraph): GraphDiff {
  const before = new Map(committed.files.map(f => [f.file, f]))
  const after = new Map(fresh.files.map(f => [f.file, f]))

  const addedFiles = [...after.keys()].filter(f => !before.has(f))
  const removedFiles = [...before.keys()].filter(f => !after.has(f))
  const changedFiles: GraphDiff['changedFiles'] = []
  for (const [file, next] of after) {
    const prev = before.get(file)
    if (!prev) continue
    const fields = COMPARED_FIELDS.filter(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
    if (fields.length > 0) changedFiles.push({ file, fields })
  }

  const edgeKey = (e: EnrichedGraph['edges'][number]) => `${e.from}\0${e.to}\0${e.kind}\0${e.count}`
  const beforeEdges = new Set(committed.edges.map(edgeKey))
  const afterEdges = new Set(fresh.edges.map(edgeKey))

  return {
    addedFiles,
    removedFiles,
    changedFiles,
    addedEdges: [...afterEdges].filter(k => !beforeEdges.has(k)).length,
    removedEdges: [...beforeEdges].filter(k => !afterEdges.has(k)).length,
  }
}

export function isGraphDiffEmpty(diff: GraphDiff): boolean {
  return diff.addedFiles.length === 0
    && diff.removedFiles.length === 0
    && diff.changedFiles.length === 0
    && diff.addedEdges === 0
    && diff.removedEdges === 0
}
