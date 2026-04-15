# Changelog

All notable changes to aidoc-kit are documented in this file.

## [1.0.0] - 2026-04-16

### Highlights

First stable release. Battle-tested on a real Next.js 16 project
with 135 files, Firebase, and Anthropic integration.

### Added

- `init` command — auto-detects stack from package.json and generates `aidoc.config.ts`
- `enrich` command — enriches `@ai-context` with real LLM descriptions.
  Supports: Anthropic, OpenAI, Gemini, Groq, Mistral, Ollama (local/free)
- `fix arrows` command — migrates existing projects from Unicode `→` to ASCII `=>`
- Dynamic model resolution — queries provider API instead of hardcoding model names
- `--yes / -y` flag — bypass interactive confirmation (CI/CD friendly)
- `--version / -v` flag — prints version number
- `--help / -h` per subcommand — prints command-specific usage without running the command

### Fixed

- `@ai-cascade` was always empty — reverse import graph now correctly built
- `@ai-cascade` showed duplicates — deduplication applied when a file is imported
  via both a relative path (`./utils`) and a path alias (`@/lib/utils`)
- `@ai-context` was truncated to 3 importers — now lists all
- Unicode arrow `→` in generated blocks crashed Turbopack (Next.js 16) —
  replaced with ASCII `=>` in all templates
- `--help` on a subcommand was launching the real command instead of printing help
- `--version` was displaying full help text instead of the version number
- Deprecated Anthropic model hardcoded in enricher — replaced with dynamic resolution

### Changed

- Zero hardcoded model names anywhere in the codebase — model is resolved
  dynamically via provider API (e.g. `GET /v1/models`) or fails with an explicit error
- Generated `@ai-*` blocks are now 100% ASCII-safe (Turbopack / strict parsers)
- Generated `aidoc.config.ts` has `model` commented out with guidance

---

## [0.3.1] - 2026-04-15

- Hotfix: replace Unicode arrow `→` with ASCII `=>` in all generated `@ai-*` blocks
- Add `fix arrows` command to migrate existing projects

## [0.3.0] - 2026-04-15

- `init` generated config: `model` field is now commented out — dynamic resolution
  is used by default, no stale model name in generated config

## [0.2.4] - 2026-04-15

- README: `npm install -D aidoc-kit` documented as primary install method
- Generated `AGENTS.md`: includes `--yes` flag in scan command + AI agent guidance

## [0.2.3] - 2026-04-15

- Fixed duplicate entries in `@ai-cascade`
- Fixed `@ai-context` (Importé dans) truncated to 3 importers — now shows all

## [0.2.2] - 2026-04-15

- `resolveModel()` throws explicit error with docs URL when no model can be resolved
- No more static model fallbacks anywhere in `enricher.ts`

## [0.2.1] - 2026-04-15

- `--version / -v` flag implemented
- `--yes / -y` flag implemented, respects `!process.stdin.isTTY` for CI
- `--help / -h` per subcommand

## [0.2.0] - 2026-04-15

Initial public release.

- `scan` command with `--write`, `--dry`, `--path`
- `chunk` command — summarizes large files into `.codemod/chunks/`
- `run` command — applies transformation rules
- `@ai-agent`, `@ai-runtime`, `@ai-context`, `@ai-cascade`, `@ai-validate` tags
- `@ai-when-reading`, `@ai-when-modifying` guidance tags
- Built-in rules: `removeConsoleLogs`, `replaceAnyWithUnknown`
- Zero external dependencies (Node.js built-ins + TypeScript compiler)
