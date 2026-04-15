// Programmatic API — import aidoc-kit as a module
export { scanProject, extractAiDocs, buildReverseImportMap } from './core/scanner'
export { generateAiDocBlock, applyRules } from './core/transformer'
export { writeKnowledgeBase, writeAgentsMd, writeDocBlock } from './core/writer'
export { loadConfig, isIgnored } from './core/config'
export { defaultRules, removeConsoleLogs, replaceAnyWithUnknown } from './rules/index'
export type { AiDocBlock, Rule, ScanResult, KnowledgeBase, AidocConfig } from './types'
