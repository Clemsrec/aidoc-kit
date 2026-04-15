#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve, relative, join } from 'node:path'
import { scanProject, buildReverseImportMap, walkDir } from './core/scanner'
import { generateAiDocBlock, applyRules } from './core/transformer'
import { writeKnowledgeBase, writeAgentsMd, writeDocBlock } from './core/writer'
import { chunkFile, writeChunk } from './core/chunker'
import { callLLM, resolveModel, buildPrompt, readSourceLines, type Provider } from './core/enricher'
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
    // Build reverse import map over ALL project files (docs + all undocumented, regardless of
    // ignore patterns) so that @ai-cascade is complete even when some importers are filtered.
    const allAbsFiles = [
      ...result.docs.map(d => resolve(projectRoot, d.file)),
      ...result.filesWithoutDocs.map(f => resolve(projectRoot, f)),
    ]
    // Pass projectRoot so that @/ alias imports (Next.js, Vite) are resolved correctly
    const reverseMap = buildReverseImportMap(allAbsFiles, projectRoot)

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
  const reverseMap = buildReverseImportMap(allFiles, projectRoot)
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

// ─── enrich ──────────────────────────────────────────────────────────────

async function cmdEnrich(): Promise<void> {
  const projectRoot = resolve(getFlag('--path') ?? '.')
  const dry = hasFlag('--dry')
  const config = loadConfig(projectRoot)

  // CLI flags take priority over aidoc.config values
  const provider = (getFlag('--provider') ?? config.enrich?.provider ?? 'gemini') as Provider
  const apiKey = getFlag('--key') ?? config.enrich?.key
  const host = getFlag('--host') ?? config.enrich?.host
  const userModel = getFlag('--model') ?? config.enrich?.model

  // Resolve model dynamically (queries provider API when none specified)
  const model = await resolveModel(provider, apiKey ?? '', userModel)

  console.log(`\naidoc-kit enrich → ${projectRoot}`)
  console.log(`Provider : ${provider} / Modèle : ${model}${dry ? ' (dry-run)' : ''}\n`)

  const allFiles = walkDir(projectRoot)
  const reverseMap = buildReverseImportMap(allFiles, projectRoot)
  const ignorePatterns = config.ignore ?? []

  // Only enrich files without an existing @ai-context (non-default content)
  const toEnrich = allFiles.filter(f => {
    const rel = relative(projectRoot, f)
    if (ignorePatterns.length > 0 && isIgnored(rel, ignorePatterns)) return false
    try {
      const src = readSourceLines(f).join('\n')
      // Skip if already has a non-generated context
      return src.includes('@ai-agent') && src.includes('[GÉNÉRÉ]')
    } catch {
      return false
    }
  })

  if (toEnrich.length === 0) {
    console.log('Aucun fichier avec un bloc @ai-context généré trouvé.')
    console.log('Lance `npx aidoc-kit scan --write` d’abord.')
    return
  }

  console.log(`${toEnrich.length} fichier(s) à enrichir :\n`)
  toEnrich.forEach(f => console.log(`  - ${relative(projectRoot, f)}`))

  if (dry) {
    console.log('\n[dry-run] Aucune modification écrite.')
    return
  }

  console.log()
  let enriched = 0
  let failed = 0

  for (const filePath of toEnrich) {
    const rel = relative(projectRoot, filePath)
    const lines = readSourceLines(filePath)
    const importedBy = (reverseMap.get(filePath) ?? []).map(f => relative(projectRoot, f))

    // Extract export names from existing @ai-context line
    const contextLine = lines.find(l => l.includes('[GÉNÉRÉ] Ce fichier exporte'))
    const exportNames = contextLine
      ? (contextLine.split(':')[1] ?? '').trim().split(',').map(s => s.trim()).filter(Boolean)
      : []

    const prompt = buildPrompt(rel, exportNames, importedBy, lines)

    try {
      const description = await callLLM(prompt, { provider, model, apiKey, host, dryRun: false })

      if (!description) {
        console.log(`  ⚠️  ${rel} — réponse vide, bloc original conservé`)
        failed++
        continue
      }

      // Replace [GÉNÉRÉ] line with LLM description
      const source = lines.join('\n')
      const updated = source.replace(
        /\[GÉNÉRÉ\] Ce fichier exporte[^\n]*/,
        description.replace(/\$/g, '$$$$'),
      )

      if (source !== updated) {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(filePath, updated, 'utf-8')
        console.log(`  ✓ ${rel}`)
        enriched++
      } else {
        console.log(`  — ${rel} (aucun changement)`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`  ✖ ${rel} — ${message}`)
      failed++
    }
  }

  console.log(`\n✓ ${enriched} fichier(s) enrichi(s)${failed > 0 ? `, ${failed} échec(s)` : ''}`)
}

// ─── help ──────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
aidoc-kit — AI-native documentation toolkit

Commandes :
  scan    Scanner un projet et construire la knowledge base
          --path <dir>   Dossier racine (défaut: .)
          --write        Écrire les blocs @ai-* manquants (confirmation interactive)
          --dry          Afficher les blocs générés sans modifier les fichiers

  chunk   Résumer les gros fichiers (≥150 lignes) dans .codemod/chunks/
          --path <dir>   Dossier racine (défaut: .)

  enrich  Enrichir les blocs @ai-context avec un LLM
          --provider     openai | anthropic | gemini | groq | mistral | ollama
          --model        Modèle à utiliser (auto-résolu si absent)
          --key          Clé API (non nécessaire pour ollama)
          --host         Hôte Ollama (défaut: http://localhost:11434)
          --path <dir>   Dossier racine (défaut: .)
          --dry          Lister les fichiers sans modifier

  run     Appliquer les règles de transformation
          --path <dir>   Dossier racine (défaut: .)
          --dry          Afficher les changements sans modifier les fichiers

Config :
  Créer un fichier aidoc.config.js (ou .json) à la racine du projet :

    module.exports = {
      agents: { '@/lib/permissions': 'permissions-expert', 'stripe': 'billing-expert' },
      ignore: ['src/generated/**', '**/*.test.ts'],
      validate: 'npm run typecheck',
      enrich: { provider: 'gemini', model: 'gemini-2.0-flash', key: process.env.GEMINI_API_KEY },
    }

Exemples :
  npx aidoc-kit scan
  npx aidoc-kit scan --path ./src --dry
  npx aidoc-kit scan --write
  npx aidoc-kit run --dry
  npx aidoc-kit chunk
  npx aidoc-kit chunk --path ./src
  npx aidoc-kit enrich --provider gemini --model gemini-2.0-flash --key YOUR_KEY
  npx aidoc-kit enrich --provider openai --model gpt-4o-mini --key sk-...
  npx aidoc-kit enrich --provider anthropic --model claude-3-5-haiku-20241022 --key sk-ant-...
  npx aidoc-kit enrich --provider groq --model llama-3.1-8b-instant --key gsk_...
  npx aidoc-kit enrich --provider mistral --model mistral-small-latest --key ...
  npx aidoc-kit enrich --provider ollama --model llama3.2
  npx aidoc-kit enrich --dry
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
  case 'enrich':
    cmdEnrich().catch((err: unknown) => {
      console.error(err)
      process.exit(1)
    })
    break
  default:
    printHelp()
    break
}
