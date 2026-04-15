# aidoc-kit

> AI-native documentation scanner for JS/TS projects

[![npm version](https://badge.fury.io/js/aidoc-kit.svg)](https://www.npmjs.com/package/aidoc-kit)
[![CI](https://github.com/Clemsrec/aidoc-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Clemsrec/aidoc-kit/actions)
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
# 1. Detect your stack and generate aidoc.config.ts automatically:
npx aidoc-kit init

# 2. Preview generated @ai-* blocks without writing anything:
npx aidoc-kit scan --dry

# 3. Write blocks to all files (asks confirmation):
npx aidoc-kit scan --write

# 4. Summarise large files for agents:
npx aidoc-kit chunk

# 5. Enrich @ai-context with an LLM (uses the provider detected at init):
npx aidoc-kit enrich --dry
```

That's all a new user needs. `init` reads `package.json`, detects frameworks, auth libraries, databases, AI SDKs and generates a ready-to-use `aidoc.config.ts`.

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
| `@ai-when-reading` | How to consume this file correctly |
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

Run `npx aidoc-kit init` to generate a pre-filled `aidoc.config.ts` automatically. Or create it manually:

```ts
// aidoc.config.ts
export default {
  agents: {
    'firebase-admin': 'firebase-admin-expert',
    'stripe': 'billing-expert',
    '@/lib/permissions': 'permissions-expert',
  },
  ignore: ['src/generated/', '*.test.ts', '*.spec.ts'],
  validate: 'npm run typecheck',
}
```

Also supported: `aidoc.config.js` (CommonJS `module.exports`) and `aidoc.config.json`.

## AI-powered context enrichment

Once `scan --write` has generated the base `@ai-*` blocks, run `enrich` to replace the generic `[GÉNÉRÉ]` descriptions with real LLM-written context:

```bash
npx aidoc-kit enrich --provider gemini --model gemini-2.0-flash --key YOUR_KEY
npx aidoc-kit enrich --provider openai --model gpt-4o-mini --key sk-...
npx aidoc-kit enrich --provider anthropic --model claude-3-5-haiku-20241022 --key sk-ant-...
npx aidoc-kit enrich --provider groq --model llama-3.1-8b-instant --key gsk_...
npx aidoc-kit enrich --provider mistral --model mistral-small-latest --key ...
npx aidoc-kit enrich --provider ollama --model llama3.2   # no key needed — fully local
```

Use `--dry` to preview which files would be enriched without making any changes.

You can also set the default provider in `aidoc.config.js` to avoid repeating flags:

```js
module.exports = {
  enrich: {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    key: process.env.GEMINI_API_KEY,   // never hardcode keys
  },
}
```

### Choosing your LLM for enrich

| Provider | Recommended model | Cost | Speed | Best for |
|----------|-------------------|------|-------|----------|
| Ollama | llama3.2 | Free | Medium | Local dev, privacy, confidential code |
| Groq | llama-3.1-8b-instant | Very low | Ultra fast | CI/CD, large projects |
| Gemini | gemini-2.0-flash-lite | Very low | Fast | Daily use |
| Anthropic | claude-3-5-haiku | Low | Fast | Best code quality |
| Mistral | mistral-small-latest | Low | Fast | European data residency |
| OpenAI | gpt-4o-mini | Low | Fast | General use |

> **Privacy note:** Ollama runs entirely on your machine — no code ever leaves your network. This makes it the right choice for client projects or proprietary codebases.

## Large file chunking

AI agents often truncate large files — reading only the first 50-100 lines of a 500-line file. `aidoc-kit chunk` solves this by pre-summarising every file over 150 lines into a structured Markdown file inside `.codemod/chunks/`.

```bash
npx aidoc-kit chunk
# 📦 src/contexts/auth-context.tsx (320 lignes)
# 📦 src/lib/firebase.ts (210 lignes)
#
# ✓ 2 fichier(s) chunkés → .codemod/chunks/
```

Each generated chunk looks like:

```markdown
# Chunk — src/contexts/auth-context.tsx
> 320 lignes — généré par aidoc-kit chunk

## Exports publics
- `AuthProvider` (function) — ligne 45
- `AuthContextType` (interface) — ligne 12
- `useAuthContext` (const) — ligne 89

## Imports critiques
- firebase/auth (getAuth, onAuthStateChanged, signInWithEmailAndPassword)
- react (createContext, useContext, useState, useEffect)
- @/lib/types (User, UserRole)

## Structure du fichier
- L. 1-50 : imports
- L. 51-100 : types et interfaces
- L. 101-150 : hooks React
- L. 151-200 : fonctions asynchrones
- L. 201-320 : rendu JSX

## Fonctions et méthodes
| Nom | Lignes | Paramètres | Retour |
|-----|--------|------------|--------|
| AuthProvider | 45-180 | children: ReactNode | JSX.Element |
| useAuthContext | 181-200 | — | AuthContextType |

## Importé par
- `src/app/layout.tsx`
- `src/hooks/use-auth.ts`
```

Tell your AI agent: *"Read `.codemod/chunks/` before modifying any large file."*

## CLI reference

```
aidoc-kit — AI-native documentation toolkit

Commands:
  scan    Scan a project and build the knowledge base
          --path <dir>   Project root (default: .)
          --write        Write missing @ai-* blocks (interactive confirmation)
          --dry          Preview generated blocks without writing anything

  chunk   Summarise large files (≥150 lines) into .codemod/chunks/*.md
          --path <dir>   Project root (default: .)

  enrich  Enrich @ai-context blocks with real LLM-generated descriptions
          --provider     openai | anthropic | gemini | groq | mistral | ollama
          --model        Model to use (defaults per provider)
          --key          API key (not needed for ollama)
          --host         Ollama host (default: http://localhost:11434)
          --path <dir>   Project root (default: .)
          --dry          List files without modifying

  run     Apply transformation rules
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
