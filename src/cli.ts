#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve, relative, join } from 'node:path'
import { scanProject, buildReverseImportMap, walkDir } from './core/scanner'
import { generateAiDocBlock, applyRules } from './core/transformer'
import { writeKnowledgeBase, writeAgentsMd, writeDocBlock } from './core/writer'
import { chunkFile, writeChunk } from './core/chunker'
import { loadConfig, isIgnored } from './core/config'
import { defaultRules } from './rules/index'

// ─── Arg helpers ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const command = args[0]

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : undefined
}
function hasFlag(flag: string): boolean {
  return args.includes(flag)
}

// ─── Confirmation prompt ───────────────────────────────────────────────────

function confirm(message: string): Promise<boolean> {
  // Non-interactive (piped input, CI) → proceed without prompt
  if (!process.stdin.isTTY) return Promise.resolve(true)
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${message} (y/n) `, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

// ─── scan ──────────────────────────────────────────────────────────────────

async function cmdScan(): Promise<void> {
  const projectRoot = resolve(getFlag('--path') ?? '.')
  const write = hasFlag('--write')
  const dry = hasFlag('--dry')

  const config = loadConfig(projectRoot)

  console.log(`\naidoc-kit scan → ${projectRoot}\n`)

  const result = scanProject(projectRoot)

  // Filter out files matching config.ignore patterns
  const ignorePatterns = config.ignore ?? []
  const filteredWithoutDocs = ignorePatterns.length > 0
    ? result.filesWithoutDocs.filter(f => !isIgnored(f, ignorePatterns))
    : result.filesWithoutDocs

  console.log(`✓ ${result.totalScanned} fichiers scannés`)
  console.log(`✓ ${result.docs.length} fichiers avec blocs @ai-*`)
  console.log(`✗ ${filteredWithoutDocs.length} fichiers sans docs${ignorePatterns.length > 0 ? ' (après filtres ignore)' : ''}\n`)

  if (filteredWithoutDocs.length > 0 && (write || dry)) {
    // Build reverse import map once for all files
    const allAbsFiles = [
      ...result.docs.map(d => resolve(projectRoot, d.file)),
      ...filteredWithoutDocs.map(f => resolve(projectRoot, f)),
    ]
    const reverseMap = buildReverseImportMap(allAbsFiles)

    if (dry) {
      console.log('Aperçu des blocs générés :')
      for (const relFile of filteredWithoutDocs) {
        const absFile = resolve(projectRoot, relFile)
        const importers = (reverseMap.get(absFile) ?? []).map(f => relative(projectRoot, f))
        const block = generateAiDocBlock(absFile, importers, config)
        if (block) console.log(`\n── ${relFile} ──\n${block}`)
      }
      console.log()
    } else {
      // Ask confirmation before writing
      const ok = await confirm(
        `→ Écrire les blocs @ai-* dans ${filteredWithoutDocs.length} fichier(s) ?`,
      )
      if (!ok) {
        console.log('Annulé.')
        return
      }
      console.log()
      for (const relFile of filteredWithoutDocs) {
        const absFile = resolve(projectRoot, relFile)
        const importers = (reverseMap.get(absFile) ?? []).map(f => relative(projectRoot, f))
        const block = generateAiDocBlock(absFile, importers, config)
        if (!block) continue
        writeDocBlock(absFile, block)
        console.log(`  ✓ ${relFile}`)
      }
      console.log()
    }
  }

  if (!dry) {
    writeKnowledgeBase(result, projectRoot)
    writeAgentsMd(result, projectRoot)
    console.log('✓ .codemod/ai-knowledge-base.json mis à jour')
    console.log('✓ AGENTS.md mis à jour')
  }
}

// ─── run ───────────────────────────────────────────────────────────────────

function cmdRun(): void {
  const projectRoot = resolve(getFlag('--path') ?? '.')
  const dry = hasFlag('--dry')

  console.log(`\naidoc-kit run → ${projectRoot}\n`)

  const result = scanProject(projectRoot)
  let changedCount = 0

  for (const doc of result.docs) {
    const absFile = resolve(projectRoot, doc.file)
    const { changed, source } = applyRules(absFile, defaultRules)
    if (changed) {
      if (!dry) writeFileSync(absFile, source, 'utf-8')
      console.log(`  ${dry ? '[dry]' : '✓'} ${doc.file}`)
      changedCount++
    }
  }

  if (changedCount === 0) {
    console.log('Aucune transformation à appliquer.')
  } else {
    console.log(`\n${dry ? '[dry]' : '✓'} ${changedCount} fichier(s) transformé(s)`)
  }
}

// ─── chunk ────────────────────────────────────────────────────────────────

async function cmdChunk(): Promise<void> {
  const projectRoot = resolve(getFlag('--path') ?? '.')

  console.log(`\naidoc-kit chunk → ${projectRoot}\n`)

  const allFiles = walkDir(projectRoot)
  const reverseMap = buildReverseImportMap(allFiles)
  const codemodDir = join(projectRoot, '.codemod')

  let chunked = 0
  for (const filePath of allFiles) {
    const importedBy = reverseMap.get(filePath) ?? []
    const chunk = chunkFile(filePath, importedBy, projectRoot)
    if (chunk) {
      writeChunk(chunk, codemodDir)
      console.log(`  📦 ${chunk.filePath} (${chunk.totalLines} lignes)`)
      chunked++
    }
  }

  if (chunked === 0) {
    console.log(`Aucun fichier ne dépasse le seuil (150 lignes). Chunking non nécessaire.`)
  } else {
    console.log(`\n✓ ${chunked} fichier(s) chunkés → .codemod/chunks/`)
    console.log('💡 Dis à ton agent : "Lis .codemod/chunks/ avant de modifier un gros fichier"')
  }
}

// ─── help ──────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
aidoc-kit — AI-native documentation toolkit

Commandes :
  scan   Scanner un projet et construire la knowledge base
         --path <dir>   Dossier racine (défaut: .)
         --write        Écrire les blocs @ai-* manquants (confirmation interactive)
         --dry          Afficher les blocs générés sans modifier les fichiers

  run    Appliquer les règles de transformation
         --path <dir>   Dossier racine (défaut: .)
         --dry          Afficher les changements sans modifier les fichiers

Config :
  Créer un fichier aidoc.config.js (ou .json) à la racine du projet :

    module.exports = {
      agents: { '@/lib/permissions': 'permissions-expert', 'stripe': 'billing-expert' },
      ignore: ['src/generated/**', '**/*.test.ts'],
      validate: 'npm run typecheck',
    }

Exemples :
  npx aidoc-kit scan
  npx aidoc-kit scan --path ./src --dry
  npx aidoc-kit scan --write
  npx aidoc-kit run --dry
  npx aidoc-kit chunk
  npx aidoc-kit chunk --path ./src
`)
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

switch (command) {
  case 'scan':
    cmdScan().catch((err: unknown) => {
      console.error(err)
      process.exit(1)
    })
    break
  case 'run':
    cmdRun()
    break
  case 'chunk':
    cmdChunk().catch((err: unknown) => {
      console.error(err)
      process.exit(1)
    })
    break
  default:
    printHelp()
    break
}
