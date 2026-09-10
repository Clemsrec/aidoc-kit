# EXAMPLES — enriched code graph

## Build the graph

```bash
# One-time: install the indexing engine (dev dependency, never shipped to runtime)
npm install -D @colbymchenry/codegraph

# Full index — runs CodeGraph, enriches, writes aidoc-graph.json
npx aidoc-kit index

# After that, only re-index what changed
npx aidoc-kit index --incremental
```

Sample output:

```
aidoc-kit index - /Users/you/my-app

✓ CodeGraph detected (v1.6.0)
◆  Indexed 21 files
●  210 nodes, 530 edges in 264ms

✓ 21 files, 69 file-level edges
✓ Roles: 1 client / 2 server / 18 universal

High-criticality files:
  [72] src/lib/auth.ts (8 dependents, auth)
  [57] app/api/billing/route.ts (3 dependents, api/billing)

✓ aidoc-graph.json written
```

Requires Node.js >= 22.5 (CodeGraph's own requirement — aidoc-kit reads its
SQLite index with the built-in `node:sqlite`, no extra dependency).

## Use the graph from an agent

`aidoc-graph.json` sits at the project root. A one-line instruction in your
agent rules (`.cursorrules`, `CLAUDE.md`, Copilot instructions) is enough:

```
Before modifying a file, check its entry in aidoc-graph.json:
- criticalityLevel high/critical => read every dependent (edges where to == file) first
- role server => never import it from client code
```

## Use the graph from the library

```typescript
import {
  readEnrichedGraph,
  getDependents,
  getCriticalFiles,
} from 'aidoc-kit'

const graph = readEnrichedGraph(process.cwd())
if (!graph) throw new Error('Run `npx aidoc-kit index` first')

// Which files would a change to src/types.ts affect?
console.log(getDependents(graph, 'src/types.ts'))
// => ['src/core/config.ts', 'src/core/scanner.ts', ...]

// What should be reviewed with extra care?
for (const f of getCriticalFiles(graph, 'high')) {
  console.log(`${f.criticality} ${f.file} (${f.inDegree} dependents, ${f.tags.join('/') || 'no tags'})`)
}

// Role of a given file
const file = graph.files.find(f => f.file === 'app/api/billing/route.ts')
console.log(file?.role, '—', file?.roleReason)
// => server — server path (app/api/)
```

## Rebuild programmatically

```typescript
import {
  detectCodegraph,
  runCodegraphIndex,
  loadRawGraph,
  enrichGraph,
  writeEnrichedGraph,
} from 'aidoc-kit'

const root = process.cwd()
const install = detectCodegraph(root)
if (!install) throw new Error('npm install -D @colbymchenry/codegraph')

runCodegraphIndex(root, install.binPath, { incremental: true })
const raw = await loadRawGraph(root)
const enriched = enrichGraph(raw, root)
writeEnrichedGraph(enriched, root)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full format and the roadmap
(symbol-level queries, MCP server).
