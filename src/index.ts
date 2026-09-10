/**
 * @ai-agent general-expert
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : index.ts
 * 
 *
 * @ai-when-modifying
 * 1. Vérifier les fichiers en cascade ci-dessous avant de modifier
 * 2. Après modification, indiquer au développeur de lancer @ai-validate
 * 3. Si tu n'as pas accès au terminal, signaler la commande à exécuter
 *
 * @ai-cascade
 * (aucun détecté)
 *
 * @ai-validate
 * npm run typecheck
 */
// Programmatic API — import aidoc-kit as a module
export { scanProject, extractAiDocs, buildReverseImportMap } from './core/scanner'
export { generateAiDocBlock, applyRules } from './core/transformer'
export { writeKnowledgeBase, writeAgentsMd, writeDocBlock } from './core/writer'
export { loadConfig, isIgnored } from './core/config'
export { defaultRules, removeConsoleLogs, replaceAnyWithUnknown } from './rules/index'
export type { AiDocBlock, Rule, ScanResult, KnowledgeBase, AidocConfig } from './types'

// Enriched code graph (CodeGraph integration)
export { detectCodegraph, codegraphInstallHint } from './codegraph/detect'
export { runCodegraphIndex, codegraphDbPath } from './codegraph/runner'
export { loadRawGraph } from './codegraph/loader'
export { enrichGraph, inferRole, inferTags, computeCriticality } from './enricher/basicEnricher'
export { writeEnrichedGraph, readEnrichedGraph, GRAPH_FILENAME } from './graph/serializer'
export { getDependents, getDependencies, getCriticalFiles } from './graph/query'
export type {
  RawGraph, RawFile, RawSymbol, RawFileEdge,
  EnrichedGraph, EnrichedFile, FileRole, CriticalityLevel,
} from './graph/types'
