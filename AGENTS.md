# AGENTS.md — aidoc-kit

> Instructions for AI agents (GitHub Copilot, Cursor, Claude, etc.) working on **this** repository.

---

## Project overview

**aidoc-kit** is a zero-dependency Node.js/TypeScript library that:
- Scans a JS/TS project via the **native TypeScript compiler AST**
- Generates `@ai-*` JSDoc blocks on each source file
- Builds a reverse dependency graph (`@ai-cascade`)
- Produces `.codemod/ai-knowledge-base.json` and `AGENTS.md` for AI agents

---

## Source architecture

```
src/
├── cli.ts              → CLI entry point (aidoc-kit scan / run)
├── index.ts            → Programmatic API exports
├── types.ts            → All TypeScript interfaces (AiDocBlock, Rule, ScanResult, …)
├── core/
│   ├── config.ts       → aidoc.config.js / .json loader + isIgnored()
│   ├── scanner.ts      → File walker, AST parser, extractAiDocs(), buildReverseImportMap()
│   ├── transformer.ts  → generateAiDocBlock(), inferAgent(), applyRules()
│   └── writer.ts       → writeKnowledgeBase(), writeAgentsMd(), writeDocBlock()
└── rules/
    └── index.ts        → Built-in transformation rules (removeConsoleLogs, replaceAnyWithUnknown)
```

### Data flow

```
scanProject()
  └── walkDir() → list all .ts/.tsx/.js/.jsx files
  └── extractAiDocs() → parse @ai-* tags from JSDoc blocks (per file)
  └── buildReverseImportMap() → AST import resolution → cascade graph

generateAiDocBlock()
  └── detectRuntime() → 'use client' / 'use server' / firebase-admin heuristics
  └── extractImports() → all import specifiers
  └── inferAgent() → custom config rules → built-in rules → path heuristics

writeKnowledgeBase() → .codemod/ai-knowledge-base.json
writeAgentsMd()      → AGENTS.md at project root
writeDocBlock()      → prepend @ai-* block to a source file
```

---

## Absolute rules

- **Zero external dependencies.** Node.js built-ins + `typescript` (peer dep) only. Never `npm install` a package just for convenience.
- **Do not modify** `scanner.ts`, `transformer.ts`, or `writer.ts` core logic unless explicitly asked.
- **TypeScript strict mode** — no `any`, no implicit returns, no unused variables.
- All type definitions live in `types.ts`. Do not scatter interfaces across files.

---

## How to add a new `@ai-*` tag

1. Add the field to `AiDocBlock` in `src/types.ts`
2. Add extraction in `extractAiDocs()` in `src/core/scanner.ts` (use `extractTag` / `extractTagLines`)
3. Add generation in `generateAiDocBlock()` in `src/core/transformer.ts`
4. If the tag belongs in the indexed knowledge base, update `writeKnowledgeBase()` in `src/core/writer.ts`
5. Add a row to the tag table in `README.md`

## How to add a new agent inference rule

Open `inferAgent()` in `src/core/transformer.ts`. Add your rule in the built-in section, **most specific first**. Include a comment explaining which import path or library it targets.

```typescript
// Example: Prisma ORM → database-expert
if (imports.some(i => i.includes('@prisma/client'))) return 'database-expert'
```

---

## Build & development

```bash
npm install          # install devDependencies (TypeScript only)
npm run build        # tsc → compiles to dist/
npm run typecheck    # type-check without emitting
npm run dev          # tsc --watch
```

## Testing

```bash
npm run test         # runs Node.js built-in test runner on dist/**/*.test.js
```

> No test files yet — contributions welcome. Tests should live alongside source as `src/**/*.test.ts`.

---

## Before submitting a PR

- `npm run build` must pass with zero TypeScript errors
- No new external dependencies
- One feature/fix per PR, focused diff
