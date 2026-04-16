/**
 * @ai-agent general-expert
 * @ai-runtime SERVER UNIQUEMENT
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : detectStack, generateConfig, runInit
 * Importé dans : src/cli.ts
 *
 * @ai-when-modifying
 * 1. Vérifier les fichiers en cascade ci-dessous avant de modifier
 * 2. Après modification, indiquer au développeur de lancer @ai-validate
 * 3. Si tu n'as pas accès au terminal, signaler la commande à exécuter
 *
 * @ai-cascade
 * => src/cli.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DetectedStack {
  framework: string | null
  auth: string[]
  database: string[]
  ai: string[]
  styling: string[]
  state: string[]
  forms: string[]
  payment: string[]
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

// ─── Stack detection ────────────────────────────────────────────────────────

export function detectStack(rootDir: string): DetectedStack {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return emptyStack()

  let pkg: PackageJson
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson
  } catch {
    return emptyStack()
  }

  const deps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  }
  const has = (name: string): boolean => name in deps

  return {
    framework: has('next') ? `Next.js ${deps['next']}`
      : has('@remix-run/react') ? 'Remix'
      : has('vite') ? 'Vite'
      : has('react') ? 'React'
      : has('vue') ? 'Vue'
      : has('@angular/core') ? 'Angular'
      : null,

    auth: [
      has('firebase') && 'firebase/auth',
      has('next-auth') && 'next-auth',
      has('@supabase/supabase-js') && '@supabase/supabase-js',
      has('@auth0/nextjs-auth0') && '@auth0/nextjs-auth0',
      has('lucia') && 'lucia',
    ].filter(Boolean) as string[],

    database: [
      has('firebase') && 'firebase/firestore',
      has('firebase-admin') && 'firebase-admin',
      has('@prisma/client') && '@prisma/client',
      has('@supabase/supabase-js') && '@supabase/supabase-js',
      has('mongoose') && 'mongoose',
      has('drizzle-orm') && 'drizzle-orm',
      has('@planetscale/database') && '@planetscale/database',
    ].filter(Boolean) as string[],

    ai: [
      has('@anthropic-ai/sdk') && '@anthropic-ai/sdk',
      has('openai') && 'openai',
      has('@google/generative-ai') && '@google/generative-ai',
      has('groq-sdk') && 'groq-sdk',
      has('@mistralai/mistralai') && '@mistralai/mistralai',
    ].filter(Boolean) as string[],

    styling: [
      has('tailwindcss') && 'tailwindcss',
      has('styled-components') && 'styled-components',
      has('@emotion/react') && '@emotion/react',
    ].filter(Boolean) as string[],

    state: [
      has('zustand') && 'zustand',
      has('jotai') && 'jotai',
      has('recoil') && 'recoil',
      has('@reduxjs/toolkit') && '@reduxjs/toolkit',
    ].filter(Boolean) as string[],

    forms: [
      has('react-hook-form') && 'react-hook-form',
      has('formik') && 'formik',
      has('zod') && 'zod',
    ].filter(Boolean) as string[],

    payment: [
      has('stripe') && 'stripe',
      has('@stripe/stripe-js') && 'stripe',
    ].filter(Boolean) as string[],
  }
}

function emptyStack(): DetectedStack {
  return { framework: null, auth: [], database: [], ai: [], styling: [], state: [], forms: [], payment: [] }
}

// ─── Config generation ──────────────────────────────────────────────────────

function buildAgentsMap(stack: DetectedStack): Record<string, string> {
  const agents: Record<string, string> = {}

  stack.auth.forEach(lib => { agents[lib] = 'auth-expert' })

  stack.database.forEach(lib => {
    agents[lib] = lib.includes('admin') ? 'firebase-admin-expert' : 'database-expert'
  })

  stack.ai.forEach(lib => { agents[lib] = 'ai-expert' })

  stack.payment.forEach(lib => { agents[lib] = 'billing-expert' })

  stack.state.forEach(lib => { agents[lib] = 'state-expert' })

  stack.forms.forEach(lib => { agents[lib] = 'forms-expert' })

  if (stack.framework?.startsWith('Next')) {
    agents['next/navigation'] = 'routing-expert'
    agents['next/server'] = 'server-expert'
  }

  return agents
}

function detectEnrichProvider(stack: DetectedStack): string {
  if (stack.ai.some(l => l.includes('anthropic'))) return 'anthropic'
  if (stack.ai.some(l => l.includes('openai'))) return 'openai'
  if (stack.ai.some(l => l.includes('google'))) return 'gemini'
  if (stack.ai.some(l => l.includes('groq'))) return 'groq'
  if (stack.ai.some(l => l.includes('mistral'))) return 'mistral'
  return 'anthropic'
}

function detectEnrichKeyEnv(stack: DetectedStack): string {
  if (stack.ai.some(l => l.includes('anthropic'))) return 'process.env.ANTHROPIC_API_KEY'
  if (stack.ai.some(l => l.includes('openai'))) return 'process.env.OPENAI_API_KEY'
  if (stack.ai.some(l => l.includes('google'))) return 'process.env.GOOGLE_AI_API_KEY'
  if (stack.ai.some(l => l.includes('groq'))) return 'process.env.GROQ_API_KEY'
  if (stack.ai.some(l => l.includes('mistral'))) return 'process.env.MISTRAL_API_KEY'
  return 'process.env.ANTHROPIC_API_KEY'
}

/** Starting model value written to aidoc.config.ts. The developer (or agent) must keep it up to date. */
function detectDefaultModel(provider: string): string {
  const suggestions: Record<string, string> = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai:    'gpt-4o-mini',
    gemini:    'gemini-2.0-flash',
    groq:      'llama-3.1-8b-instant',
    mistral:   'mistral-small-latest',
    ollama:    'llama3.2',
  }
  return suggestions[provider] ?? 'YOUR_MODEL_HERE'
}

export function generateConfig(rootDir: string, stack: DetectedStack): string {
  const agents = buildAgentsMap(stack)
  const provider = detectEnrichProvider(stack)
  const keyEnv = detectEnrichKeyEnv(stack)
  const defaultModel = detectDefaultModel(provider)

  const docsUrls: Record<string, string> = {
    anthropic: 'https://docs.anthropic.com/models',
    openai:    'https://platform.openai.com/docs/models',
    gemini:    'https://ai.google.dev/gemini-api/docs/models',
    groq:      'https://console.groq.com/docs/models',
    mistral:   'https://docs.mistral.ai/getting-started/models',
    ollama:    'https://ollama.com/library',
  }
  const docsUrl = docsUrls[provider] ?? 'https://github.com/Clemsrec/aidoc-kit#choosing-your-llm'

  const agentsLines = Object.entries(agents)
    .map(([k, v]) => `    '${k}': '${v}',`)
    .join('\n')

  const agentsBlock = agentsLines.length > 0
    ? `  agents: {\n${agentsLines}\n  },\n`
    : ''

  return `// aidoc.config.ts \u2014 g\u00e9n\u00e9r\u00e9 par npx aidoc-kit init
// Modifie ce fichier pour personnaliser le comportement d'aidoc-kit.
// Documentation : https://github.com/Clemsrec/aidoc-kit

export default {
${agentsBlock}  ignore: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.stories.tsx',
    'src/generated/**',
  ],
  validate: 'npm run typecheck',
  enrich: {
    provider: '${provider}',
    key: ${keyEnv},

    // aidoc-kit résout le modèle automatiquement via l'API du provider.
    // Décommente et renseigne "model" uniquement si la résolution échoue
    // (réseau indisponible, clé invalide, API /models non supportée).
    //
    // Modèles disponibles : ${docsUrl}
    //
    // @ai-maintainer : si enrich échoue avec "Modèle non résolu", renseigner ce champ.
    // model: '${defaultModel}',
  },
}
`
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function runInit(rootDir: string): void {
  console.log('\n🔍 Analyse de package.json...\n')

  const stack = detectStack(rootDir)
  const configPath = join(rootDir, 'aidoc.config.ts')
  let detected = false

  if (stack.framework) { console.log(`✅ Framework    : ${stack.framework}`); detected = true }
  if (stack.auth.length > 0) { console.log(`✅ Auth         : ${stack.auth.join(', ')}`); detected = true }
  if (stack.database.length > 0) { console.log(`✅ Database     : ${stack.database.join(', ')}`); detected = true }
  if (stack.ai.length > 0) { console.log(`✅ AI provider  : ${stack.ai.join(', ')}`); detected = true }
  if (stack.styling.length > 0) { console.log(`✅ Styling      : ${stack.styling.join(', ')}`); detected = true }
  if (stack.state.length > 0) { console.log(`✅ State        : ${stack.state.join(', ')}`); detected = true }
  if (stack.forms.length > 0) { console.log(`✅ Forms        : ${stack.forms.join(', ')}`); detected = true }
  if (stack.payment.length > 0) { console.log(`✅ Payment      : ${stack.payment.join(', ')}`); detected = true }
  if (!detected) console.log('ℹ️  Aucune dépendance connue détectée — config minimaliste générée.')

  // Refuse to overwrite an existing config
  if (existsSync(configPath)) {
    console.log('\n⚠️  aidoc.config.ts existe déjà — non écrasé.')
    console.log('   Supprime-le manuellement et relance init pour regénérer.\n')
    return
  }

  // Write config
  const config = generateConfig(rootDir, stack)
  writeFileSync(configPath, config, 'utf-8')
  console.log('\n📄 aidoc.config.ts généré à la racine')

  // Add .codemod/ to .gitignore if missing
  const gitignorePath = join(rootDir, '.gitignore')
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8')
    if (!gitignore.includes('.codemod')) {
      appendFileSync(gitignorePath, '\n# aidoc-kit\n.codemod/\n')
      console.log('📝 .codemod/ ajouté au .gitignore')
      console.log('   (retire cette ligne si tu veux committer le contexte IA)')
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ aidoc-kit initialisé avec succès !')
  console.log('')
  console.log('Prochaines étapes :')
  console.log('  1. npx aidoc-kit scan --dry     ← prévisualiser les blocs générés')
  console.log('  2. npx aidoc-kit scan --write   ← écrire les blocs @ai-* sur chaque fichier')
  console.log('  3. npx aidoc-kit chunk          ← résumer les gros fichiers pour les agents')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}
