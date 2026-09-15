# ARCHITECTURE — aidoc-kit x CodeGraph

## Overview

aidoc-kit combines two complementary analysis layers:

1. **CodeGraph** (`@colbymchenry/codegraph`) — low-level indexing engine.
   It builds a full knowledge graph of the project (symbols, calls, imports,
   inheritance) into a local SQLite database: `.codegraph/codegraph.db`.
2. **aidoc-kit** — intelligence layer. It reads that raw graph, enriches it
   (client/server roles, criticality, domain tags) and serializes it to a
   simple, stable format: `aidoc-graph.json`.

CodeGraph is used **for indexing only**, never in the runtime of applications
that use aidoc-kit. It is an optional peer dependency: without it, every
other command (`scan`, `chunk`, `enrich`…) works exactly as before.

## Indexing flow

```
aidoc-kit index [--incremental] [--check] [--no-agents-md] [--path <dir>]
  │
  ├─ 1. detect.ts   — is CodeGraph installed in node_modules? which version?
  │                   (otherwise: install instructions, exit 1)
  │
  ├─ 2. runner.ts   — spawn the codegraph binary:
  │                     first run           → codegraph init --yes
  │                     full rebuild        → codegraph index
  │                     --incremental       → codegraph sync
  │                   then verify .codegraph/codegraph.db exists
  │
  ├─ 3. loader.ts   — read the DB through node:sqlite (built into
  │                   Node >= 22.5, zero npm dependency): files, symbols,
  │                   edges aggregated at file level → RawGraph
  │
  ├─ 4. basicEnricher.ts — RawGraph + source reading → EnrichedGraph:
  │                   client/server/universal role, 0-100 criticality, tags
  │
  └─ 5. serializer.ts — write aidoc-graph.json at the project root
                       (--check: diff.ts compares with the committed file instead)
```

## Modules

| Module | Responsibility |
|---|---|
| `src/codegraph/detect.ts` | Detect the CodeGraph install (bin + version) |
| `src/codegraph/runner.ts` | Run `codegraph init/index/sync` (direct spawn, no shell) |
| `src/codegraph/loader.ts` | SQLite read → `RawGraph` (plain TS types) |
| `src/enricher/basicEnricher.ts` | Roles, criticality, tags |
| `src/graph/types.ts` | `RawGraph` / `EnrichedGraph` contracts |
| `src/graph/serializer.ts` | Read/write `aidoc-graph.json` |
| `src/graph/query.ts` | Simple queries over the enriched graph |
| `src/graph/diff.ts` | Compare two graphs (`index --check`) |

Each step only depends on the previous step's contract: the loader is the
only module aware of CodeGraph's SQLite schema, the enricher only knows
`RawGraph`, consumers only know `EnrichedGraph`.

## `aidoc-graph.json` format

Versioned JSON (`version: 1`), written at the target project root, sorted by
path for stable git diffs.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-09-10T08:15:00.000Z",
  "codegraph": { "version": "1.6.0" },
  "stats": { "files": 21, "edges": 69, "client": 1, "server": 2, "universal": 18 },
  "files": [
    {
      "file": "src/types.ts",
      "language": "typescript",
      "role": "universal",            // client | server | universal
      "roleReason": "no client/server signal",
      "criticality": 42,              // 0-100
      "criticalityLevel": "medium",   // low | medium | high | critical
      "inDegree": 7,                  // files depending on this one
      "outDegree": 0,
      "tags": [],                     // api, auth, billing, payment
      "symbolCount": 6
    }
  ],
  "edges": [
    { "from": "src/cli.ts", "to": "src/core/scanner.ts", "kind": "imports", "count": 3 }
  ]
}
```

Edges are aggregated at file level (`count` keeps the symbol-level volume).
Symbol-by-symbol detail stays queryable in `.codegraph/codegraph.db` — no
point duplicating it in the JSON.

### Role (client/server)

Decreasing priority, same order as the historical `@ai-runtime` detection:

1. Explicit `'use client'` / `'use server'` directive at the top of the file
2. `.server.ts` / `.client.ts` suffix (Remix convention)
3. App Router entry files (`app/**/page|layout|route|sitemap|robots|opengraph-image…`)
   without a directive → server (RSC default). Only entry files: a shared
   component under `app/` can still end up in a client bundle when imported
   from a `'use client'` boundary, so it is not classified this way.
4. Server path: `app/api/`, `pages/api/`, `server/`, `api/`
5. Content heuristics: `firebase-admin` import → server, React hooks → client
6. Otherwise: `universal`

The `roleReason` field records which rule decided.

Known limitation (inherited from `detectRuntime`): content heuristics work on
raw text — a file that merely *mentions* `useState` or `firebase-admin`
(regexes, docs) is classified as if it used them.

### Criticality

0-100 score, deterministic, documented in `basicEnricher.ts`:

- fan-in: 6 points per dependent file, capped at 60
- +15 when the file is an API surface (`app/api/`, `pages/api/`, `api/`)
- +25 when it belongs to a sensitive domain (auth, billing, payment)

Levels: `critical` >= 80, `high` >= 55, `medium` >= 25, otherwise `low`.

### What the graph does not see

Edges come from CodeGraph's AST analysis: imports, calls, references,
inheritance. Coupling that lives in file *contents* is invisible — a JSON
file that names a source path, a script that reads a file as text and checks
for a string, a route resolved from configuration. Such a file can score low
while a change to it breaks something important. The generated `AGENTS.md`
states this limit explicitly; project-specific content dependencies belong in
the project's own agent instructions.

## Freshness

`aidoc-graph.json` describes the code at `generatedAt`. A committed graph that
no longer matches the code is worse than no graph, because agents trust it.

`aidoc-kit index --check` recomputes the graph (`codegraph sync`, or a full
build when `.codegraph/` is absent, as in CI) and compares it with the
committed file through `diffEnrichedGraphs` (`src/graph/diff.ts`). It writes
nothing and exits 1 on any difference in files, roles, criticality, degrees,
symbol counts or edges. `generatedAt` is ignored on purpose.

Comparing `generatedAt` with the last commit date was rejected: the graph is
committed together with the code, so it always predates its own commit, and a
documentation-only commit would flag an accurate graph as stale.

Tested: a graph built incrementally and one rebuilt from an empty
`.codegraph/` compare equal.

## How agents query the graph

- **Static file**: `aidoc-graph.json` is directly readable by any agent
  (Claude Code, Cursor, Copilot) — the recommended entry point for "which
  files are critical?", "who depends on X?".
- **Library API**: `readEnrichedGraph`, `getDependents`, `getDependencies`,
  `getCriticalFiles` (see `EXAMPLES.md`).
- **Symbol-level detail**: through CodeGraph's own CLI or MCP server
  (`codegraph query`, `codegraph serve --mcp`) — aidoc-kit does not
  reimplement what already exists underneath.

## Constraints

- **Zero runtime dependency**: `@colbymchenry/codegraph` is an optional
  `peerDependency`. SQLite reading goes through `node:sqlite` (built-in).
  Only the `index` command requires Node >= 22.5 — a requirement CodeGraph
  itself already imposes; the rest of aidoc-kit stays Node 18 compatible.
- **Opt-out of agent files**: `--no-agents-md` or `agentsMd: false` stops
  `scan` and `index` from writing `AGENTS.md`, for repositories whose policy
  forbids agent instruction files. The generated block only contains sections
  that apply (no chunk instructions without `.codemod/chunks/`, no `scan --write`
  advice for projects that do not use `@ai-*` blocks).
- **SQLite schema is not a contract**: CodeGraph's schema is an internal
  detail of that project. `loader.ts` verifies the expected tables exist
  (`files`, `nodes`, `edges`) and fails with an actionable message if the
  schema moves. Any future adaptation happens in that single module.

## Next steps

1. **Refine roles and criticality**: parse the AST instead of content regexes
   (removes false positives), weigh by distance to entrypoints and transitive
   impact depth (CodeGraph's `getImpactRadius`).
2. **Full query API**: symbol-level `getCallers` / `getImpact` / `search`,
   reading the CodeGraph DB on demand (same patterns as `loader.ts`), exposed
   in the library and as CLI subcommands (`aidoc-kit graph callers <symbol>`).
3. **aidoc-kit MCP server** (optional): expose the *enriched* graph over MCP
   (`get_critical_files`, `get_impact`, `get_role` tools) to complement
   CodeGraph's raw MCP with the criticality/role layer.
4. **scan <-> graph loop**: inject the criticality computed here into the
   `@ai-*` blocks generated by `scan --write` (replaces the plain dependent
   count currently in `transformer.ts`).
