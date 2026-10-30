import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { buildReverseImportMap, walkDir } from './scanner'
import { generateAiDocBlock } from './transformer'
import { dependentRanker } from './dependents'
import type { AidocConfig } from '../types'

// Rewrites @ai-* blocks written by aidoc-kit < 1.6 in the compact format:
// rules common to every file move to AGENTS.md, dependents are capped.
// Blocks a person edited are left alone.

/** Tags aidoc-kit never writes: their presence means a person edited the block. */
const MANUAL_TAGS = ['@ai-never', '@ai-always', '@ai-pattern', '@ai-when-reading', '@ai-agents-related']

/** The @ai-when-modifying steps older versions wrote, in English and French. */
const GENERIC_RULES = [
  'Check cascade files below before modifying',
  'After modifying, ask the developer to run @ai-validate',
  'If you have no terminal access, report the command to run',
  'Vérifier les fichiers en cascade ci-dessous avant de modifier',
  'Après modification, indiquer au développeur de lancer @ai-validate',
  "Si tu n'as pas accès au terminal, signaler la commande à exécuter",
]

const LEADING_BLOCK = /^(#![^\n]*\n)?(\/\*\*[\s\S]*?\*\/)/

export type CompactOutcome =
  | { status: 'compacted'; source: string }
  | { status: 'skipped'; reason: 'no block' | 'not generated' | 'edited' | 'already compact' }

function tagBody(block: string, tag: string): string[] | null {
  const match = block.match(new RegExp(`^[ \\t]*\\*?[ \\t]*@${tag}(?![\\w-])([\\s\\S]*?)(?=^[ \\t]*\\*?[ \\t]*@|\\*\\/)`, 'm'))
  if (!match) return null
  return match[1].split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean)
}

/**
 * Compact the leading aidoc-kit block of `source`. `fresh` is the block the
 * current version generates for this file; the agent, validation command and
 * any LLM-enriched context of the old block are carried over.
 */
export function compactSource(source: string, fresh: string): CompactOutcome {
  const match = source.match(LEADING_BLOCK)
  const block = match?.[2]
  if (!block || !block.includes(' * @ai-agent ')) return { status: 'skipped', reason: 'no block' }
  const enriched = block.includes('@ai-enriched')
  if (!enriched && !/\[GENERATED\]|\[GÉNÉRÉ\]/.test(block)) return { status: 'skipped', reason: 'not generated' }
  if (MANUAL_TAGS.some(t => block.includes(t))) return { status: 'skipped', reason: 'edited' }
  const rules = tagBody(block, 'ai-when-modifying') ?? []
  if (rules.some(r => !GENERIC_RULES.includes(r.replace(/^\d+\.\s*/, '')))) return { status: 'skipped', reason: 'edited' }
  if (!block.includes('@ai-agent-hint') && rules.length === 0 && !/Imported by:|Importé dans/.test(block)) {
    return { status: 'skipped', reason: 'already compact' }
  }

  let next = fresh
  const agent = tagBody(block, 'ai-agent')?.[0]
  if (agent) next = next.replace(/^ \* @ai-agent .*$/m, ` * @ai-agent ${agent}`)
  const validate = tagBody(block, 'ai-validate')?.join(' ')
  if (validate) next = next.replace(/^ \* @ai-validate .*$/m, ` * @ai-validate ${validate}`)
  if (enriched) {
    const context = tagBody(block, 'ai-context') ?? []
    const date = tagBody(block, 'ai-enriched')?.[0] ?? ''
    const lines = [' * @ai-context', ...context.map(l => ` * ${l}`), ` * @ai-enriched ${date}`].join('\n')
    next = next.replace(/^ \* @ai-context .*$/m, () => lines)
  }

  const start = match.index! + (match[1]?.length ?? 0)
  return { status: 'compacted', source: source.slice(0, start) + next + source.slice(start + block.length) }
}

export interface CompactReport {
  compacted: { file: string; before: number; after: number }[]
  edited: string[]
}

/** Compact every aidoc-kit block in the project. Nothing is written when `dry`. */
export function compactBlocks(projectRoot: string, config: AidocConfig, dry: boolean): CompactReport {
  const files = walkDir(projectRoot)
  const reverseMap = buildReverseImportMap(files, projectRoot)
  const rank = dependentRanker(reverseMap, projectRoot)
  const report: CompactReport = { compacted: [], edited: [] }

  for (const file of files) {
    const source = readFileSync(file, 'utf-8')
    if (!source.includes('@ai-agent')) continue
    const fresh = generateAiDocBlock(file, rank(reverseMap.get(file) ?? []), config)
    const outcome = compactSource(source, fresh)
    const rel = relative(projectRoot, file)
    if (outcome.status === 'skipped') {
      if (outcome.reason === 'edited') report.edited.push(rel)
      continue
    }
    report.compacted.push({ file: rel, before: source.length, after: outcome.source.length })
    if (!dry) writeFileSync(file, outcome.source, 'utf-8')
  }
  return report
}
