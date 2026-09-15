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

## Keep a committed graph honest (CI)

If `aidoc-graph.json` is committed, check it on every push. The check rebuilds
the index, compares, writes nothing, and fails when the graph is stale:

```yaml
# .github/workflows/graph.yml
name: Code graph
on: [push, pull_request]
jobs:
  graph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx aidoc-kit index --check
```

Output when someone forgot to re-index:

```
✗ aidoc-graph.json is stale — it no longer matches the current code:
  files changed (2):
    lib/auth.ts (criticality, inDegree)
    lib/utils.ts (outDegree, symbolCount)
  edges: +2 / -0

Run `npx aidoc-kit index --incremental` and commit aidoc-graph.json.
```

Without such a check, keep `aidoc-graph.json` in `.gitignore` and regenerate it
locally.

## Use the graph from an agent

`aidoc-graph.json` sits at the project root, and `aidoc-kit index` writes a
"Code graph" section at the top of `AGENTS.md` with the usage rules and ready
made queries — tools that follow the [agents.md](https://agents.md) convention
(Codex, Cursor, Gemini CLI, Zed…) pick it up automatically.

For tools with their own entry file, add a one-line pointer (the `index`
command lists the ones present in your project that lack it):

```
# CLAUDE.md, .cursorrules, .github/copilot-instructions.md, .windsurfrules…
Read AGENTS.md before modifying anything.
```

The graph only sees imports, calls and references. If your project couples
files through their contents (a JSON manifest that names source files, a
script asserting that a file contains a given string), say so in those agent
instructions: these links are not in the graph.

To use the graph without writing any agent file in the repository:

```bash
npx aidoc-kit index --no-agents-md
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
