# Changelog

All notable changes to aidoc-kit are documented in this file.

## [1.7.0] — 2026-10-30

### Added
- Outils MCP `find_symbol` (définition, signature, appelants et appelés d'une fonction, d'un composant ou d'un type, avec numéros de ligne) et `trace` (arbre d'appels vers l'aval ou l'amont), lus dans l'index CodeGraph (`.codegraph/`). Les fichiers générés et de test sont classés après le code
- `aidoc-kit hook read-guard` : hook PreToolUse pour Claude Code qui répond à la lecture complète d'un fichier source de 400 lignes ou plus par sa structure (expérimental)
- `bench/run.mjs` et `bench/analyze.mjs` acceptent un fichier de tâches (`--tasks-file`) et des configurations de départ (`conditions.json`) ; les configurations alternent pour neutraliser l'effet du cache de prompt

### Changed
- `aidoc-kit mcp` n'expose plus que 4 outils par défaut (`find_symbol`, `trace`, `context_for_edit`, `read_chunk`), avec des descriptions plus courtes ; `--all-tools` rend les autres

### Mesuré
- Sur une application Next.js en production de 872 fichiers (6 tâches réelles, 18 sessions par configuration), aucune configuration ne réduit le coût d'une session Claude Code : +1 % (serveur 1.6), +10 % (`find_symbol`/`trace` et une ligne dans CLAUDE.md), +4 % (avec le hook). Le README le dit
- Fiabilité, sur la même application : 7 demandes contenant chacune un piège invisible pour tsc ; Claude Code les évite toutes, avec et sans aidoc-kit (21 sessions sur 21 dans chaque configuration), pour le même coût

---

## [1.6.0] — 2026-10-30

Suite au benchmark de la 1.5.0 : sur un projet Next.js de 145 fichiers, les blocs `@ai-*` faisaient plus que doubler le volume du code et rendaient les sessions Claude Code plus chères, sans gain de réussite.

### Changed
- Blocs `@ai-*` compacts : plus de `@ai-agent-hint`, plus de consignes génériques `@ai-when-modifying` (écrites une seule fois dans `AGENTS.md`), plus de liste « Imported by » en double, `@ai-runtime` omis pour les fichiers universels, chaque balise sur une ligne. `@ai-cascade` liste au plus 5 dépendants, les plus critiques d'abord (criticité du graphe, sinon nombre d'importeurs), suivis du nombre restant. Sur le projet du benchmark : 100 ko de blocs ramenés à 30 ko
- `.codemod/ai-knowledge-base.json` : `cascadeGraph` vient de la carte des imports et contient tous les dépendants, quel que soit le contenu des blocs
- `AGENTS.md` : nouvelle section « Before modifying a file » avec les règles communes et la commande de validation ; listes de fichiers par agent ramenées à 5
- README : section « Measured cost » avec les résultats du benchmark (aucune baisse de coût sur un projet de 145 fichiers, quelle que soit la variante) ; pour Claude Code, coût mesuré de l'import `@AGENTS.md` (environ 2 000 tokens par session) et d'une ligne de renvoi (lectures supplémentaires)

### Added
- `aidoc-kit fix blocks [--dry]` : réécrit les blocs des versions précédentes au format compact. Les blocs modifiés à la main (balises `@ai-never`, `@ai-pattern`… ou consignes personnalisées) ne sont pas touchés ; les contextes enrichis par `enrich` sont conservés
- `bench/` : benchmark reproductible (projet Next.js généré, 6 tâches vérifiées automatiquement, configurations avec et sans aidoc-kit, mesure par `claude -p`)

### Fixed
- Détection de `'use client'` / `'use server'` derrière un commentaire de bloc : le bloc `@ai-*` inséré au-dessus de la directive la masquait, et `index` classait ces fichiers en `universal`

---

## [1.5.0] — 2026-10-29

### Added
- `aidoc-kit mcp` : serveur MCP en lecture seule sur stdio, utilisable depuis Claude Code, Cursor, VS Code ou Windsurf. Outils : `context_for_edit` (rôle, criticité, règles `@ai-*`, dépendants classés, références textuelles, résumé de gros fichier et commande de validation, borné par un budget de tokens), `file_info`, `dependents`, `dependencies`, `critical_files`, `read_chunk`, `graph_status`
- Recherche des références textuelles d'un fichier (JSON, configs, scripts) : le couplage par contenu, invisible dans le graphe d'imports
- Protocole implémenté sur les modules Node natifs : aucune dépendance d'exécution ajoutée. Chemins confinés à la racine du projet (liens symboliques compris), entrées validées, réponses plafonnées, aucune écriture ni exécution de commande
- API librairie : `runMcpServer`, `callTool`, `TOOL_DEFINITIONS`, `renderChunk`
- `AGENTS.md` signale l'outil `context_for_edit` quand le serveur MCP est connecté

### Fixed
- Lecture des blocs `@ai-*` : une balise n'est reconnue qu'en début de ligne JSDoc. Auparavant, la mention « lancer @ai-validate » dans `@ai-when-modifying` était prise pour la balise : la commande de validation enregistrée dans `.codemod/ai-knowledge-base.json` était la ligne « 3. Si tu n'as pas accès au terminal… » au lieu de `npm run typecheck`
- `@ai-context` et `@ai-validate` écrits sous la balise (format généré par `scan --write`) sont lus en entier, sans le préfixe `* ` ; `@ai-agent` ne déborde plus sur `@ai-agent-hint`

---

## [1.4.0] — 2026-09-15

Corrections issues d'un retour terrain sur un dépôt public : le graphe y induisait en erreur sur trois points.

### Added
- `index --check` : recalcule le graphe et le compare à `aidoc-graph.json` versionné, sans rien écrire ; code de sortie 1 si le graphe est périmé, avec la liste des fichiers et arêtes qui divergent. Conçu pour la CI (fonctionne sans `.codegraph/` préexistant). La comparaison porte sur le contenu, pas sur les dates : `generatedAt` précède toujours le commit qui contient le graphe
- `--no-agents-md` (`scan`, `index`) et option de config `agentsMd: false` : n'écrit jamais `AGENTS.md`, pour les dépôts dont la politique interdit les fichiers d'instructions d'agent
- API librairie : `diffEnrichedGraphs`, `isGraphDiffEmpty`

### Fixed
- `AGENTS.md` ne contient plus de consignes inapplicables : la section sur `.codemod/chunks/` n'apparaît que si le dossier existe, et le conseil `scan --write` (ainsi que les sections agents et runtime) seulement si le projet utilise des blocs `@ai-*`. Auparavant, un projet utilisant uniquement le graphe recevait l'instruction d'ajouter des commentaires `@ai-*` à tous ses fichiers
- `AGENTS.md` énonce la limite du graphe : il ne voit que les imports, appels et références ; les dépendances par contenu (JSON citant un fichier, script vérifiant qu'un fichier contient une chaîne) n'y figurent pas, et un score faible ne prouve pas un faible impact
- La règle de fraîcheur d'`AGENTS.md` ne compare plus `generatedAt` à la date du dernier commit (comparaison toujours fausse) et renvoie vers `index --check`

---

## [1.3.4] — 2026-09-15

### Docs
- README : bannière graphe enrichi (CodeGraph, rôles, criticité) et roadmap à jour ; le numéro de version n'est plus écrit en dur dans le README — le badge npm et le CHANGELOG font foi. Publication pour que la page npmjs.com serve le README actuel

---

## [1.3.3] — 2026-09-15

### Fixed
- `AGENTS.md` n'est plus écrasé : le contenu généré vit dans un bloc balisé (`<!-- aidoc-kit:generated:start/end -->`), seul ce bloc est réécrit par `scan` et `index`. Le contenu rédigé à la main — avant ou après le bloc — est préservé ; un fichier entièrement généré par une version antérieure est migré vers le format balisé. Auparavant, un `AGENTS.md` manuel était perdu au premier `scan`/`index`
- Tests unitaires de la fusion (`mergeAgentsMd`)

---

## [1.3.2] — 2026-09-15

### Added
- `index` : les fichiers d'entrée App Router (`page`, `layout`, `route`, `sitemap`, `robots`, `opengraph-image`…) sans directive `'use client'` sont désormais classés `server` (Server Components par défaut). Volontairement limité aux fichiers d'entrée : un composant partagé sous `app/` peut être embarqué dans un bundle client s'il est importé depuis une frontière `'use client'`
- Tests unitaires de l'enricher (`inferRole`, criticité) exécutés par `npm test`

---

## [1.3.1] — 2026-09-15

Contenu identique à la 1.3.0 — le numéro 1.3.0 est resté bloqué en état « staged » sur le registre npm et ne pouvait plus être publié.

---

## [1.3.0] — 2026-09-15

### Added
- Commande `index [--incremental]` : intégration de CodeGraph (`@colbymchenry/codegraph`) comme moteur d'indexation bas niveau — `codegraph init/index/sync` puis enrichissement aidoc-kit (rôle `client`/`server`/`universal` avec justification, criticité 0-100, tags api/auth/billing/payment) et écriture de `aidoc-graph.json` à la racine du projet
- Lecture de l'index SQLite via `node:sqlite` natif (Node >= 22.5, uniquement pour `index`) — zéro dépendance npm runtime conservée ; CodeGraph est une peer dependency **optionnelle**
- API librairie : `loadRawGraph`, `enrichGraph`, `readEnrichedGraph`, `getDependents`, `getDependencies`, `getCriticalFiles` + types `RawGraph`/`EnrichedGraph`
- `AGENTS.md` : section « Code graph » auto-générée en tête de fichier (règles d'usage pour agents IA, requêtes ciblées prêtes à copier, contrôle de fraîcheur) ; `index` signale les fichiers d'entrée agents (`CLAUDE.md`, `.cursorrules`…) qui ne référencent pas encore `AGENTS.md`
- `ARCHITECTURE.md` et `EXAMPLES.md`

### Fixed
- `.codegraph` ajouté aux répertoires ignorés par `scan` et `--watch`

---

## [1.2.3] — 2026-05-01

### Fixed
- `_next` (dossier de runtime Next.js) ajouté aux répertoires ignorés par défaut dans `walkDir` et `--watch` — les blocs `@ai-*` ne sont plus écrits dans les artefacts de build Next.js

---

## [1.2.2] — 2026-04-30

### Added
- `scan --watch` : surveille le projet en continu (via `fs.watch` natif Node 18+) et écrit automatiquement les blocs `@ai-*` manquants à chaque changement de fichier, sans confirmation. Débounce 500ms. Arrêt propre sur Ctrl+C.

---

## [1.2.1] — 2026-04-17

### Fixed
- `loadConfig` supporte désormais `aidoc.config.ts` nativement via `tsx` ou `ts-node` (fallback `.js`/`.json` conservé) — le chemin `init → enrich` fonctionne sans miroir `.js`
- `enrich` : message final affiné selon l'état réel (déjà enrichi / blocs manuels / rien trouvé) — plus de faux « Run scan --write first » trompeur
- `enrich` : la sélection des fichiers cibles est désormais restreinte aux blocs marqués `[GENERATED]` / `[GÉNÉRÉ]` — les `@ai-context` écrits manuellement ne sont plus réécrits par le LLM
- `DEFAULT_IGNORE_PATTERNS` ajouté : `aidoc.config.ts/js/json` sont exclus par défaut des passes `scan` et `enrich` — évite l'auto-documentation en boucle

---

## [1.2.0] — 2026-04-17

### Added
- `aidoc-kit agents` command stub — generates Copilot agent instruction files from @ai-agent tags (`.github/copilot/<agent>.md`)
- `@ai-agent-hint` tag — auto-generated after `@ai-agent`, instructs agents to switch to a specialized Copilot agent when relevant
- Cascade criticality indicator in `@ai-context`: `[HIGH-IMPACT]` (10-19 dependents), `[CRITICAL]` (20+ dependents)
- DESIGN.md: "Agent Routing" and "@ai-cascade as Architecture Map" sections

### Changed
- `@ai-runtime` is now omitted when deductible from an explicit `'use client'` / `'use server'` directive
- README: `@ai-*` tags table updated with Required/Optional column and new tags

---

## [1.1.0] — 2026-04-16

### Changed
- Provider init now detects API keys from .env automatically
- Model names are never hardcoded — resolved via /models API at runtime
- Error messages no longer suggest specific model identifiers

### Added
- `aidoc-kit models` command to list available models for configured provider
- Support for GitHub Copilot / VS Code Agent mode (prompt-export)
- Manual mode for projects without any LLM setup

---

## [1.0.3] - 2026-04-16

### Fixed

- `@ai-cascade` entries now use plain dash (`- file`) instead of `=>` —
  `>` crashes SWC when parsing `.tsx` files even inside JSDoc comments
- `fix arrows` command now also replaces `=>` patterns (from v0.3.1–1.0.2)
  in addition to Unicode `→` (from v0.2.x)

### Rule established

**`@ai-*` blocks injected into source files must be 100% ASCII.**
Emojis and special characters are only used in CLI console output,
never in code injected into `.ts` / `.tsx` files.

---

## [1.0.2] - 2026-04-16

- Fix `writeDocBlock` shebang handling — `#!/usr/bin/env node` is now preserved
  as the first line when writing blocks to `cli.ts`-style files

## [1.0.1] - 2026-04-16

- Fix `writeDocBlock` false positive — guard tightened to ` * @ai-agent ` (JSDoc
  format) to avoid skipping files that contain `@ai-agent` in their source code
  (e.g. `scanner.ts`, `types.ts`)



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
