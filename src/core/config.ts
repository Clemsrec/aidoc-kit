/**
 * @ai-agent general-expert
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : loadConfig, isIgnored
 * Importé dans : src/cli.ts
 *
 * @ai-when-modifying
 * 1. Vérifier les fichiers en cascade ci-dessous avant de modifier
 * 2. Après modification, indiquer au développeur de lancer @ai-validate
 * 3. Si tu n'as pas accès au terminal, signaler la commande à exécuter
 *
 * @ai-cascade
 * - src/cli.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { AidocConfig } from '../types'

// ─── Default ignore patterns ───────────────────────────────────────────────

/**
 * Patterns always excluded regardless of user config.
 * Prevents aidoc-kit from auto-documenting its own governance files.
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  'aidoc.config.ts',
  'aidoc.config.js',
  'aidoc.config.json',
]

// ─── Config loader ─────────────────────────────────────────────────────────

/**
 * Try to load a TypeScript config file by registering a CJS hook.
 * Requires `tsx` or `ts-node` to be available in the project's node_modules.
 * Returns null if no TS runtime is found or if the file fails to parse.
 */
function tryLoadTsConfig(tsPath: string): AidocConfig | null {
  const runtimes = ['tsx/cjs', 'ts-node/register']
  for (const runtime of runtimes) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(runtime)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(tsPath) as unknown
      const config = (mod as { default?: AidocConfig })?.default ?? (mod as AidocConfig)
      return config ?? null
    } catch {
      // runtime not installed or config malformed — try next
    }
  }
  return null
}

/**
 * Load `aidoc.config.ts`, `aidoc.config.js` or `aidoc.config.json` from the
 * project root. TypeScript configs are loaded via `tsx` or `ts-node` when
 * available in the project's node_modules.
 * Returns an empty object if no config file is found or if it fails to parse.
 */
export function loadConfig(rootDir: string): AidocConfig {
  // Try TS config first (requires tsx or ts-node in the project's node_modules)
  const tsCandidate = join(rootDir, 'aidoc.config.ts')
  if (existsSync(tsCandidate)) {
    const config = tryLoadTsConfig(tsCandidate)
    if (config !== null) return config
    console.warn(`[aidoc-kit] Found ${basename(tsCandidate)} but could not load it (no TS runtime detected).`)
    console.warn(`[aidoc-kit] Install tsx (npm install -D tsx) or compile to aidoc.config.js first.`)
  }

  const candidates = [
    join(rootDir, 'aidoc.config.js'),
    join(rootDir, 'aidoc.config.json'),
  ]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      // Dynamic require works for both .js (module.exports) and .json
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(candidate) as unknown
      const config = (mod as { default?: AidocConfig })?.default ?? (mod as AidocConfig)
      return config ?? {}
    } catch {
      // Malformed config — skip silently
    }
  }

  return {}
}

// ─── Ignore helper ─────────────────────────────────────────────────────────

/**
 * Test whether a workspace-relative file path matches any ignore pattern.
 *
 * Supported pattern forms (no external glob library needed):
 * - `src/generated/`   - prefix match (anything under that directory)
 * - `src/generated/**` - same, with explicit glob syntax
 * - `*.test.ts`        - suffix match (any file ending in .test.ts)
 * - `src/foo/bar.ts`   - exact relative path match
 */
export function isIgnored(relPath: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const pattern = raw.replace(/\\/g, '/')
    const normalized = relPath.replace(/\\/g, '/')

    if (pattern.endsWith('/**')) {
      // prefix: `src/generated/**` - starts with `src/generated/`
      const prefix = pattern.slice(0, -3)
      if (normalized === prefix || normalized.startsWith(prefix + '/')) return true
    } else if (pattern.startsWith('**/')) {
      // suffix after `**/`
      const suffix = pattern.slice(3)
      if (suffix.startsWith('*')) {
        // `**/*.test.ts` - `*.test.ts` - ends with `.test.ts`
        if (normalized.endsWith(suffix.slice(1))) return true
      } else {
        // `**/foo.ts` - any segment equals `foo.ts`
        if (normalized === suffix || normalized.endsWith('/' + suffix)) return true
      }
    } else if (pattern.startsWith('*')) {
      // `*.test.ts` - ends with `.test.ts`
      if (normalized.endsWith(pattern.slice(1))) return true
    } else {
      // exact relative path
      if (normalized === pattern) return true
    }
  }
  return false
}
