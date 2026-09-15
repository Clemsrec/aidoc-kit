import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffEnrichedGraphs, isGraphDiffEmpty } from './diff'
import type { EnrichedFile, EnrichedGraph } from './types'

function file(path: string, overrides: Partial<EnrichedFile> = {}): EnrichedFile {
  return {
    file: path, language: 'typescript', role: 'universal', roleReason: 'no client/server signal',
    criticality: 0, criticalityLevel: 'low', inDegree: 0, outDegree: 0, tags: [], symbolCount: 1,
    ...overrides,
  }
}

function graph(files: EnrichedFile[], edges: EnrichedGraph['edges'] = [], generatedAt = '2026-09-15T10:00:00.000Z'): EnrichedGraph {
  return {
    version: 1, generatedAt, codegraph: { version: '1.6.0' },
    stats: { files: files.length, edges: edges.length, client: 0, server: 0, universal: files.length },
    files, edges,
  }
}

test('diff: identical content with a different generatedAt is up to date', () => {
  const a = graph([file('a.ts')], [{ from: 'b.ts', to: 'a.ts', kind: 'imports', count: 1 }])
  const b = graph([file('a.ts')], [{ from: 'b.ts', to: 'a.ts', kind: 'imports', count: 1 }], '2026-09-20T08:00:00.000Z')
  assert.ok(isGraphDiffEmpty(diffEnrichedGraphs(a, b)))
})

test('diff: added, removed and changed files are reported', () => {
  const committed = graph([file('a.ts'), file('gone.ts')])
  const fresh = graph([file('a.ts', { role: 'server', inDegree: 3 }), file('new.ts')])
  const diff = diffEnrichedGraphs(committed, fresh)
  assert.deepEqual(diff.addedFiles, ['new.ts'])
  assert.deepEqual(diff.removedFiles, ['gone.ts'])
  assert.deepEqual(diff.changedFiles, [{ file: 'a.ts', fields: ['role', 'inDegree'] }])
  assert.ok(!isGraphDiffEmpty(diff))
})

test('diff: edge changes, including call counts, make the graph stale', () => {
  const committed = graph([file('a.ts')], [{ from: 'b.ts', to: 'a.ts', kind: 'calls', count: 1 }])
  const fresh = graph([file('a.ts')], [{ from: 'b.ts', to: 'a.ts', kind: 'calls', count: 2 }])
  const diff = diffEnrichedGraphs(committed, fresh)
  assert.equal(diff.addedEdges, 1)
  assert.equal(diff.removedEdges, 1)
})
