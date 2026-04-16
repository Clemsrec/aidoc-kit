#!/usr/bin/env node
/**
 * @ai-agent general-expert
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : cli.ts
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
import { writeFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve, relative, join } from 'node:path'
import { scanProject, buildReverseImportMap, walkDir } from './core/scanner'
import { generateAiDocBlock, applyRules } from './core/transformer'
import { writeKnowledgeBase, writeAgentsMd, writeDocBlock } from './core/writer'
import { chunkFile, writeChunk } from './core/chunker'
import { callLLM, resolveModel, buildPrompt, readSourceLines, type Provider } from './core/enricher'
import { runInit } from './core/init'
import { fixArrows } from './core/fixer'
import { loadConfig, isIgnored } from './core/config'
import { defaultRules } from './rules/index'

// ─── Arg helpers ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const command = args[0]

// ─── Early exits ──────────────────────────────────────────────────────────────

if (command === '--version' || command === '-v') {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as { version: string }
  console.log(pkg.version)
  process.exit(0)
}

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : undefined
}

// ─── Enrich helpers ────────────────────────────────────────────────────────

/**
 * Infer the provider from the model name prefix.
 * Used when --provider is not explicitly set but --model is.
 */
function inferProvider(model: string): Provider | null {
  if (model.startsWith('claude'))                   return 'anthropic'
  if (model.startsWith('gemini') || model.startsWith('models/gemini')) return 'gemini'
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('llama') || model.startsWith('mixtral')) return 'groq'
  if (model.startsWith('mistral') || model.startsWith('codestral')) return 'mistral'
  return null
}

/**
 * Standard environment variable names per provider.
 * Keys are read from env — never passed as CLI arguments (OWASP: shell history risk).
 */
const ENV_KEY_NAMES: Record<Provider, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai:    ['OPENAI_API_KEY'],
  gemini:    ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'],
  groq:      ['GROQ_API_KEY'],
  mistral:   ['MISTRAL_API_KEY'],
  ollama:    [],
}
function hasFlag(flag: string): boolean {
  return args.includes(flag)
}

// ─── Confirmation prompt ───────────────────────────────────────────────────

function confirm(message: string): Promise<boolean> {
  // --yes / -y flag or non-interactive (piped, CI) → proceed without prompt
  if (hasFlag('--yes') || hasFlag('-y') || !process.stdin.isTTY) return Promise.resolve(true)
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
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: aidoc-kit scan [options]

  --path <dir>   Dossier racine (défaut: .)
  --write        Écrire les blocs @ai-* manquants (confirmation interactive)
  --yes, -y      Passer la confirmation (CI, pipe, non-interactif)
  --dry          Afficher les blocs générés sans modifier les fichiers
  -h, --help     Afficher cette aide
`)
    return
  }
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
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: aidoc-kit run [options]

  --path <dir>   Dossier racine (défaut: .)
  --dry          Afficher les changements sans modifier les fichiers
  -h, --help     Afficher cette aide
`)
    return
  }
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
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: aidoc-kit chunk [options]

  --path <dir>   Dossier racine (défaut: .)
  -h, --help     Afficher cette aide
`)
    return
  }
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
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: aidoc-kit enrich [options]

  --provider     openai | anthropic | gemini | groq | mistral | ollama
                 (auto-deduced from --model when omitted: claude-* => anthropic, etc.)
  --model        Model name (auto-resolved via provider API when omitted)
  --host         Ollama base URL (default: http://localhost:11434)
  --path <dir>   Root directory (default: .)
  --dry          List files without modifying them
  -h, --help     Show this help

API keys are read from environment variables (never pass secrets as CLI args):
  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY

Or set them in aidoc.config.ts:
  enrich: { provider: 'anthropic', key: process.env.ANTHROPIC_API_KEY }
`)
    return
  }
  const projectRoot = resolve(getFlag('--path') ?? '.')
  const dry = hasFlag('--dry')
  const config = loadConfig(projectRoot)

  // Resolve provider: explicit flag > config > inferred from model name > error
  const userModel = getFlag('--model') ?? config.enrich?.model
  const explicitProvider = getFlag('--provider') ?? config.enrich?.provider

  let provider: Provider
  if (explicitProvider) {
    provider = explicitProvider as Provider
  } else if (userModel) {
    const inferred = inferProvider(userModel)
    if (!inferred) {
      console.error(`Provider inconnu pour le modele "${userModel}".`)
      console.error('Passe --provider openai|anthropic|gemini|groq|mistral|ollama')
      process.exit(1)
    }
    provider = inferred
    console.log(`Provider infere depuis le modele : ${provider}`)
  } else {
    console.error('Provider non determine. Passe --provider ou --model avec un nom reconnu (claude-*, gpt-*, gemini-*).')
    process.exit(1)
  }

  // Resolve API key: config value (typically process.env.XXX) > standard env vars
  // Passing secrets as CLI args leaks them into shell history (OWASP A02).
  const configKey = config.enrich?.key
  const matchedEnvVar = ENV_KEY_NAMES[provider].find(k => process.env[k] !== undefined && process.env[k] !== '')
  const envKey = matchedEnvVar ? process.env[matchedEnvVar] : undefined
  const apiKey = configKey ?? envKey

  if (!apiKey && provider !== 'ollama') {
    const envNames = ENV_KEY_NAMES[provider]
    console.error(`Cle API manquante pour le provider "${provider}".`)
    console.error(`Exporte la variable dans ton shell :`)
    envNames.forEach(k => console.error(`  export ${k}=ta-cle`))
    console.error(`Ou ajoute-la dans aidoc.config.ts :`)
    console.error(`  enrich: { provider: '${provider}', key: process.env.${envNames[0] ?? 'API_KEY'} }`)
    process.exit(1)
  }

  if (matchedEnvVar) console.log(`Cle lue depuis $${matchedEnvVar}`)

  const host = getFlag('--host') ?? config.enrich?.host

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
  init    Détecter la stack du projet et générer aidoc.config.ts
          --path <dir>   Dossier racine (défaut: .)

  scan    Scanner un projet et construire la knowledge base
          --path <dir>   Dossier racine (défaut: .)
          --write        Écrire les blocs @ai-* manquants (confirmation interactive)
          --yes, -y      Passer la confirmation (CI, pipe, non-interactif)
          --dry          Afficher les blocs générés sans modifier les fichiers

  chunk   Résumer les gros fichiers (≥150 lignes) dans .codemod/chunks/
          --path <dir>   Dossier racine (défaut: .)

  enrich  Enrichir les blocs @ai-context avec un LLM
          --provider     openai | anthropic | gemini | groq | mistral | ollama
                         (auto-déduit depuis --model si absent)
          --model        Modèle (auto-résolu via API provider si absent)
          --host         Hôte Ollama (défaut: http://localhost:11434)
          --path <dir>   Dossier racine (défaut: .)
          --dry          Lister les fichiers sans modifier
          Clés API : ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY...

  run     Appliquer les règles de transformation
          --path <dir>   Dossier racine (défaut: .)
          --dry          Afficher les changements sans modifier les fichiers

  fix     Corriger les blocs @ai-* générés par d'anciennes versions
    arrows  Remplacer le caractère → (U+2192) par => (Turbopack compat)

Config :
  Lance "npx aidoc-kit init" pour générer un aidoc.config.ts adapté à ton projet.
  Ou crée-le manuellement :

    module.exports = {
      agents: { '@/lib/permissions': 'permissions-expert', 'stripe': 'billing-expert' },
      ignore: ['src/generated/**', '**/*.test.ts'],
      validate: 'npm run typecheck',
      enrich: { provider: 'gemini', model: 'gemini-2.0-flash', key: process.env.GEMINI_API_KEY },
    }

Exemples :
  npx aidoc-kit init
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
  npx aidoc-kit fix arrows
`)
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

switch (command) {
  case 'init':
    if (hasFlag('--help') || hasFlag('-h')) {
      console.log(`
Usage: aidoc-kit init [options]

  --path <dir>   Dossier racine (défaut: .)
  -h, --help     Afficher cette aide
`)
    } else {
      runInit(resolve(getFlag('--path') ?? '.'))
    }
    break
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
  case 'fix': {
    const subArgs = args.slice(1)
    if (subArgs[0] === 'arrows' || subArgs.includes('--arrows')) {
      const projectRoot = resolve(getFlag('--path') ?? '.')
      fixArrows(projectRoot)
    } else {
      console.log(`Sous-commande fix inconnue. Commandes disponibles : arrows`)
    }
    break
  }
  default:
    printHelp()
    break
}
