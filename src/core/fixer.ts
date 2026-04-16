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
 * Replaces legacy arrow characters in @ai-* blocks across the project:
 * - Unicode arrow \u2192 (\u2192) — injected by aidoc-kit < 0.3.1, crashes Turbopack
 * - ASCII arrow => — injected by aidoc-kit 0.3.1-1.0.2, crashes SWC in .tsx (JSX >)
 * Both are replaced with a plain dash (-), safe for all parsers.
 */
export function fixArrows(rootDir: string): void {
  const files = walkDir(rootDir)
  let fixed = 0

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    // Match either form, but only on @ai-cascade lines inside JSDoc blocks
    const hasUnicode = content.includes('\u2192')
    const hasAsciiArrow = / \* => /.test(content)
    if (!hasUnicode && !hasAsciiArrow) continue

    let updated = content
    if (hasUnicode) updated = updated.split('\u2192').join('-')
    if (hasAsciiArrow) updated = updated.split(' * => ').join(' * - ')
    writeFileSync(file, updated, 'utf-8')
    fixed++
    console.log(`  \u2713 ${relative(rootDir, file)}`)
  }

  if (fixed === 0) {
    console.log('Aucun caractere fleche detecte dans les fichiers du projet.')
  } else {
    console.log(`\n\u2713 ${fixed} fichier(s) corrige(s)`)
  }
}
