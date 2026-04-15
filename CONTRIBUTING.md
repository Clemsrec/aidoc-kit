# Contributing to aidoc-kit

## Setup

```bash
git clone https://github.com/Clemsrec/aidoc-kit
cd aidoc-kit
npm install
npm run build
```

## Core rules

- **Zero external dependencies** — Node.js built-ins + `typescript` only. Never add a package just for convenience.
- All new agent inference rules go in `src/core/transformer.ts` (built-in) or are user-configurable via `aidoc.config.js`.
- Test each rule on a real project before submitting a PR.

## Adding a new `@ai-*` tag

1. Add the field to `AiDocBlock` in [src/types.ts](src/types.ts)
2. Add extraction logic in [src/core/scanner.ts](src/core/scanner.ts) (`extractTag` / `extractTagLines`)
3. Add generation logic in [src/core/transformer.ts](src/core/transformer.ts) (`generateAiDocBlock`)
4. Update the knowledge base builder in [src/core/writer.ts](src/core/writer.ts) if the tag belongs in the index
5. Update the README tag table

## Adding a new agent inference rule

Open `inferAgent()` in [src/core/transformer.ts](src/core/transformer.ts) and add a rule in the built-in section, most specific first. Add a comment explaining which library/path pattern it matches.

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Include a short description of what changed and why
- Make sure `npm run build` passes with no TypeScript errors
