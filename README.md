# aidoc-kit

> AI-native documentation scanner for JS/TS projects

[![npm version](https://badge.fury.io/js/aidoc-kit.svg)](https://www.npmjs.com/package/aidoc-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)

## The problem

When AI agents (GitHub Copilot, Cursor, Claude) work on large Next.js projects with 200–400 files, they lose context between sessions. They re-discover architecture, miss existing conventions, and break established patterns.

## How it works

1. **Scan** — aidoc-kit reads your entire project via TypeScript's native AST compiler
2. **Generate** — it creates `@ai-*` doc blocks on every file and builds a reverse dependency graph
3. **Agents understand** — Copilot and any AI agent reads `.codemod/` and `AGENTS.md` to instantly understand your project without reading 400 files

## Installation

```bash
npm install -D aidoc-kit
# or run directly without installing:
npx aidoc-kit scan
```

## Quick start

```bash
# In any JS/TS project root:
npx aidoc-kit scan

# Output:
# ✓ 47 fichiers scannés
# ✓ 12 fichiers avec blocs @ai-*
# ✗ 35 fichiers sans docs
#
# ✓ .codemod/ai-knowledge-base.json mis à jour
# ✓ AGENTS.md mis à jour

# Preview generated blocks without writing anything:
npx aidoc-kit scan --dry

# Write missing blocks to files (asks confirmation):
npx aidoc-kit scan --write
```

## What gets generated

### On each file (auto-generated block)

```typescript
/**
 * @ai-agent auth-expert
 * @ai-runtime CLIENT UNIQUEMENT
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : AuthProvider, useAuthContext
 * Importé dans : src/app/layout.tsx, src/hooks/use-auth.ts
 *
 * @ai-when-modifying
 * 1. Vérifier les fichiers en cascade ci-dessous
 * 2. Lancer @ai-validate après toute modification
 *
 * @ai-cascade
 * → src/hooks/use-auth.ts
 * → src/lib/types.ts
 *
 * @ai-validate
 * npm run typecheck
 */
```

### At project root

- `AGENTS.md` — entry point for any AI agent working on the project
- `.codemod/ai-knowledge-base.json` — full indexed knowledge base (agents, cascade graph, runtime map)

## Supported `@ai-*` tags

| Tag | Description |
|-----|-------------|
| `@ai-agent` | Domain expert responsible for this file |
| `@ai-agents-related` | Other agents to consult when modifying |
| `@ai-runtime` | `CLIENT UNIQUEMENT` / `SERVER UNIQUEMENT` / `UNIVERSEL` |
| `@ai-context` | What this file does and exposes |
| `@ai-when-modifying` | Rules to follow when editing |
| `@ai-always` | Invariants that must always be respected |
| `@ai-never` | Absolute prohibitions |
| `@ai-pattern` | Correct usage code example |
| `@ai-cascade` | Files that must be checked after modifying this one |
| `@ai-validate` | Command to run after modifications |

## Runtime auto-detection

aidoc-kit detects the execution environment automatically:

| Signal | Runtime |
|--------|---------|
| `'use client'` directive | `CLIENT UNIQUEMENT` |
| `'use server'` directive | `SERVER UNIQUEMENT` |
| `firebase-admin` import | `SERVER UNIQUEMENT` |
| `useState` / `useEffect` usage | `CLIENT UNIQUEMENT` |
| None of the above | `UNIVERSEL` |

## Agent inference

The responsible agent is inferred from imports and file path, in priority order:

1. **Custom rules** from `aidoc.config.js` — your project-specific mappings
2. **Built-in rules** — `firebase-admin` → `firebase-admin-expert`, `stripe` → `billing-expert`, `@tanstack/react-query` → `data-fetching-expert`, `zustand` → `state-expert`, `react-hook-form` → `forms-expert`, …
3. **Path heuristics** — `/hooks/` → `hooks-expert`, `/api/` → `api-expert`, `/components/` → `ui-expert`, …

## Configuration

Create `aidoc.config.js` at your project root:

```js
// aidoc.config.js
module.exports = {
  agents: {
    'firebase-admin': 'firebase-admin-expert',
    'stripe': 'billing-expert',
    '@/lib/permissions': 'permissions-expert',
  },
  ignore: ['src/generated/', '*.test.ts', '*.spec.ts'],
  validate: 'npm run typecheck',
}
```

Or as JSON:

```json
{
  "agents": { "stripe": "billing-expert" },
  "ignore": ["src/generated/"],
  "validate": "npm run typecheck"
}
```

## CLI reference

```
aidoc-kit — AI-native documentation toolkit

Commands:
  scan   Scan a project and build the knowledge base
         --path <dir>   Project root (default: .)
         --write        Write missing @ai-* blocks (interactive confirmation)
         --dry          Preview generated blocks without writing anything

  run    Apply transformation rules
         --path <dir>   Project root (default: .)
         --dry          Preview changes without writing
```

## Reverse dependency graph

One of aidoc-kit's core features is the **reverse import map**: for every file, it resolves which other files import it (via the TypeScript AST, not text search). This powers the accurate `@ai-cascade` section — when you touch `types.ts`, the agent knows exactly which 4 files depend on it.

## Why zero dependencies?

aidoc-kit uses only Node.js built-ins + the TypeScript compiler already installed in every TypeScript project. No extra packages, no version conflicts, no supply chain risk.

## Roadmap

- [ ] VS Code extension with `@ai-*` tag highlighting and hover docs
- [ ] MCP server to expose scan/transform as AI agent tools
- [ ] `--watch` mode (rebuild knowledge base on save)
- [ ] Public rules registry for popular lib migrations (Next.js, Firebase, Stripe)
- [ ] CI/CD integration to validate `@ai-*` coverage on each PR
- [ ] HTML visual report of the dependency graph

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Made by [Clément Tournier](https://github.com/Clemsrec)
