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
 * => src/cli.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AidocConfig } from '../types'

// ─── Config loader ─────────────────────────────────────────────────────────

/**
 * Load `aidoc.config.js` or `aidoc.config.json` from the project root.
 * Returns an empty object if no config file is found or if it fails to parse.
 *
 * TypeScript config (`aidoc.config.ts`) is supported when the CLI is run via
 * `ts-node` or `tsx`; otherwise compile it to `.js` first.
 */
export function loadConfig(rootDir: string): AidocConfig {
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
 * - `src/generated/`   → prefix match (anything under that directory)
 * - `src/generated/**` → same, with explicit glob syntax
 * - `*.test.ts`        → suffix match (any file ending in .test.ts)
 * - `src/foo/bar.ts`   → exact relative path match
 */
export function isIgnored(relPath: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const pattern = raw.replace(/\\/g, '/')
    const normalized = relPath.replace(/\\/g, '/')

    if (pattern.endsWith('/**')) {
      // prefix: `src/generated/**` → starts with `src/generated/`
      const prefix = pattern.slice(0, -3)
      if (normalized === prefix || normalized.startsWith(prefix + '/')) return true
    } else if (pattern.startsWith('**/')) {
      // suffix after `**/`
      const suffix = pattern.slice(3)
      if (suffix.startsWith('*')) {
        // `**/*.test.ts` → `*.test.ts` → ends with `.test.ts`
        if (normalized.endsWith(suffix.slice(1))) return true
      } else {
        // `**/foo.ts` → any segment equals `foo.ts`
        if (normalized === suffix || normalized.endsWith('/' + suffix)) return true
      }
    } else if (pattern.startsWith('*')) {
      // `*.test.ts` → ends with `.test.ts`
      if (normalized.endsWith(pattern.slice(1))) return true
    } else {
      // exact relative path
      if (normalized === pattern) return true
    }
  }
  return false
}
