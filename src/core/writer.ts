import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiDocBlock, KnowledgeBase, ScanResult } from '../types'

// ─── Knowledge base ────────────────────────────────────────────────────────

export function writeKnowledgeBase(result: ScanResult, projectRoot: string): void {
  const outDir = join(projectRoot, '.codemod')
  mkdirSync(outDir, { recursive: true })
  const kb = buildKnowledgeBase(result.docs)
  writeFileSync(join(outDir, 'ai-knowledge-base.json'), JSON.stringify(kb, null, 2), 'utf-8')
}

// ─── AGENTS.md ─────────────────────────────────────────────────────────────

export function writeAgentsMd(result: ScanResult, projectRoot: string): void {
  const kb = buildKnowledgeBase(result.docs)
  const lines: string[] = [
    '# AGENTS',
    '',
    `> Généré par aidoc-kit le ${new Date().toISOString().slice(0, 10)}`,
    `> ${result.totalScanned} fichiers scannés — ${result.docs.length} avec docs @ai-*`,
    '',
    '## Agents et leurs domaines',
    '',
  ]

  for (const [agent, info] of Object.entries(kb.agents)) {
    lines.push(`### ${agent}`, '')
    lines.push(`**Fichiers :** ${info.owns.length}`)
    info.owns.slice(0, 10).forEach(f => lines.push(`- \`${f}\``))
    if (info.owns.length > 10) lines.push(`- *(+ ${info.owns.length - 10} autres)*`)
    if (info.consultedBy.length > 0) {
      lines.push('', `**Consulté par :** ${info.consultedBy.join(', ')}`)
    }
    lines.push('')
  }

  if (Object.keys(kb.runtimeMap).length > 0) {
    lines.push('## Runtime Map', '')
    for (const [runtime, files] of Object.entries(kb.runtimeMap)) {
      lines.push(`### ${runtime} (${files.length} fichiers)`, '')
      files.slice(0, 5).forEach(f => lines.push(`- \`${f}\``))
      if (files.length > 5) lines.push(`- *(+ ${files.length - 5} autres)*`)
      lines.push('')
    }
  }

  if (result.filesWithoutDocs.length > 0) {
    lines.push(
      '## Fichiers sans documentation @ai-*',
      '',
      `${result.filesWithoutDocs.length} fichier(s) sans bloc \`@ai-*\` détecté(s).`,
      'Le développeur peut générer les blocs manquants avec :',
      '',
      '```bash',
      'npx aidoc-kit scan --write --yes',
      '```',
      '',
      '> **Note pour les agents IA** : ne pas exécuter cette commande toi-même.',
      '> La signaler au développeur si tu constates des fichiers non documentés.',
      '',
    )
  }

  lines.push(
    '## Fichiers volumineux — lire le chunk avant de modifier',
    '',
    'Les fichiers de plus de 150 lignes ont un résumé structuré dans `.codemod/chunks/`.',
    'Avant de modifier un fichier volumineux, **lire le fichier `.md` correspondant** dans ce dossier.',
    'Ne pas tenter de lire le fichier source en entier — utiliser le chunk.',
    '',
    'Exemple : avant de modifier `src/contexts/auth-context.tsx`',
    '=> Lire `.codemod/chunks/src/contexts/auth-context.tsx.md`',
    '',
    '> Les chunks sont générés et maintenus par le développeur via `npx aidoc-kit chunk`.',
    '> Si un chunk est manquant, demander au développeur de lancer cette commande.',
    '> **Note pour les agents IA** : aidoc-kit doit être installé en dev dep (`npm install -D aidoc-kit`).',
    '> Toutes les commandes aidoc-kit sont à confier au développeur, pas à exécuter directement.',
    '',
  )

  writeFileSync(join(projectRoot, 'AGENTS.md'), lines.join('\n'), 'utf-8')
}

// ─── Prepend doc block to a file ──────────────────────────────────────────

export function writeDocBlock(filePath: string, docBlock: string): void {
  const existing = readFileSync(filePath, 'utf-8')
  if (existing.includes('@ai-agent')) return // already documented
  writeFileSync(filePath, docBlock + '\n' + existing, 'utf-8')
}

// ─── Builder ────────────────────────────────────────────────────────────────

function buildKnowledgeBase(docs: AiDocBlock[]): KnowledgeBase {
  const agents: KnowledgeBase['agents'] = {}
  const cascadeGraph: Record<string, string[]> = {}
  const runtimeMap: Record<string, string[]> = {}
  const validationCommands: Record<string, string[]> = {}

  for (const doc of docs) {
    // Agent ownership
    if (!agents[doc.agent]) agents[doc.agent] = { owns: [], consultedBy: [] }
    agents[doc.agent].owns.push(doc.file)

    // Related agents get a "consultedBy" entry
    for (const rel of doc.related) {
      if (!rel) continue
      if (!agents[rel]) agents[rel] = { owns: [], consultedBy: [] }
      if (!agents[rel].consultedBy.includes(doc.agent)) {
        agents[rel].consultedBy.push(doc.agent)
      }
    }

    // Cascade graph
    if (doc.cascade.length > 0) cascadeGraph[doc.file] = doc.cascade

    // Runtime map
    const rt = doc.runtime || 'UNIVERSEL'
    if (!runtimeMap[rt]) runtimeMap[rt] = []
    runtimeMap[rt].push(doc.file)

    // Validation commands
    if (doc.validate) {
      if (!validationCommands[doc.validate]) validationCommands[doc.validate] = []
      validationCommands[doc.validate].push(doc.file)
    }
  }

  return { generatedAt: new Date().toISOString(), agents, cascadeGraph, runtimeMap, validationCommands }
}
