/**
 * @ai-agent general-expert
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : fixArrows
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
import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { walkDir } from './scanner'

/**
 * Replaces Unicode arrow → (U+2192) with ASCII => in all @ai-* blocks
 * across the project. Fixes compatibility issue with Turbopack / Next.js 16
 * which fails to parse non-ASCII characters in JSDoc comments.
 */
export function fixArrows(rootDir: string): void {
  const files = walkDir(rootDir)
  let fixed = 0

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    if (!content.includes('\u2192')) continue

    const updated = content.split('\u2192').join('=>')
    writeFileSync(file, updated, 'utf-8')
    fixed++
    console.log(`  \u2713 ${relative(rootDir, file)}`)
  }

  if (fixed === 0) {
    console.log('Aucun caractere → detecte dans les fichiers du projet.')
  } else {
    console.log(`\n\u2713 ${fixed} fichier(s) corrige(s)`)
  }
}
