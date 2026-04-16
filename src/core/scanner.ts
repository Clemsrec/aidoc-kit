/**
 * @ai-agent general-expert
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : buildReverseImportMap, scanProject, extractAiDocs, walkDir
 * Importé dans : src/core/fixer.ts, src/cli.ts
 *
 * @ai-when-modifying
 * 1. Vérifier les fichiers en cascade ci-dessous avant de modifier
 * 2. Après modification, indiquer au développeur de lancer @ai-validate
 * 3. Si tu n'as pas accès au terminal, signaler la commande à exécuter
 *
 * @ai-cascade
 * - src/core/fixer.ts
 * - src/cli.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import * as ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative, resolve, dirname } from 'node:path'
import type { AiDocBlock, ScanResult } from '../types'

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'out', 'build', '.codemod', 'coverage',
])

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Build a map from each file (absolute path) - the set of files that import it.
 * Resolves relative imports (./foo, ../bar) and @/ alias imports common in Next.js projects.
 * Pass `rootDir` to enable @/ alias resolution (mapped to `<rootDir>/src/`).
 */
export function buildReverseImportMap(files: string[], rootDir?: string): Map<string, string[]> {
  // forward: absPath - [absPath of each resolved import]
  const forward = new Map<string, string[]>()

  for (const file of files) {
    let source: string
    try {
      source = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const deps: string[] = []
    ts.forEachChild(sf, node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text
        let resolved: string | null = null

        if (spec.startsWith('.')) {
          // Relative import: ./foo or ../bar
          resolved = resolveImport(dirname(file), spec)
        } else if (rootDir && spec.startsWith('@/')) {
          // @/ alias - <rootDir>/src/<rest>  (standard Next.js / Vite convention)
          const rest = spec.slice(2) // strip '@/'
          resolved =
            resolveImport(join(rootDir, 'src'), rest) ??
            resolveImport(rootDir, rest)
        }

        if (resolved) deps.push(resolved)
      }
    })
    forward.set(file, deps)
  }

  // reverse: absPath - [absPath of files that import it] (deduplicated)
  const reverse = new Map<string, string[]>()
  for (const file of files) reverse.set(file, [])

  for (const [importer, deps] of forward) {
    for (const dep of deps) {
      if (!reverse.has(dep)) reverse.set(dep, [])
      const existing = reverse.get(dep)!
      if (!existing.includes(importer)) existing.push(importer)
    }
  }

  return reverse
}

/**
 * Resolve a relative import specifier to an absolute file path.
 * Tries `.ts`, `.tsx`, `.js`, `.jsx` extensions and `index.*` variants.
 */
function resolveImport(fromDir: string, spec: string): string | null {
  const base = resolve(fromDir, spec)
  // try exact extensions first
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = base + ext
    try { statSync(candidate); return candidate } catch { /* not found */ }
  }
  // try as directory index
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = join(base, 'index' + ext)
    try { statSync(candidate); return candidate } catch { /* not found */ }
  }
  return null
}

export function scanProject(rootDir: string): ScanResult {
  const allFiles = walkDir(rootDir)
  const docs: AiDocBlock[] = []
  const filesWithoutDocs: string[] = []

  for (const file of allFiles) {
    const block = extractAiDocs(file, rootDir)
    if (block) {
      docs.push(block)
    } else {
      filesWithoutDocs.push(relative(rootDir, file))
    }
  }

  return { docs, filesWithoutDocs, totalScanned: allFiles.length }
}

export function extractAiDocs(filePath: string, rootDir = ''): AiDocBlock | null {
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  if (!source.includes('@ai-agent')) return null

  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true)
  const firstToken = sourceFile.getFirstToken()
  if (!firstToken) return null

  const ranges = ts.getLeadingCommentRanges(source, 0)
  if (!ranges) return null

  for (const range of ranges) {
    const comment = source.slice(range.pos, range.end)
    if (!comment.includes('@ai-agent')) continue

    return {
      file: rootDir ? relative(rootDir, filePath) : filePath,
      agent: extractTag(comment, 'ai-agent'),
      related: extractTag(comment, 'ai-agents-related')
        .split(',').map(s => s.trim()).filter(Boolean),
      runtime: extractTag(comment, 'ai-runtime'),
      context: extractTag(comment, 'ai-context'),
      whenModifying: extractTagLines(comment, 'ai-when-modifying'),
      cascade: extractTagLines(comment, 'ai-cascade'),
      validate: extractTag(comment, 'ai-validate'),
      neverDo: extractTagLines(comment, 'ai-never'),
      patterns: extractCodeBlocks(comment, 'ai-pattern'),
    }
  }

  return null
}

// ─── File walker ───────────────────────────────────────────────────────────

export function walkDir(dir: string): string[] {
  const results: string[] = []
  let entries: string[]

  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue
    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath))
    } else if (EXTENSIONS.has(extname(entry))) {
      results.push(fullPath)
    }
  }

  return results
}

// ─── Comment parsers ───────────────────────────────────────────────────────

/** Extract single-line tag value: `@tag Some text` */
function extractTag(comment: string, tag: string): string {
  const match = comment.match(new RegExp(`@${tag}\\s+([^\\n@*][^\\n]*)`, ''))
  return match?.[1]?.trim() ?? ''
}

/** Extract multi-line tag content (until next @ or end of block) */
function extractTagLines(comment: string, tag: string): string[] {
  const match = comment.match(new RegExp(`@${tag}([\\s\\S]*?)(?=\\s*\\*\\s*@|\\*\\/)`))
  if (!match) return []
  return match[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
}

/** Extract fenced code blocks after a given tag */
function extractCodeBlocks(comment: string, tag: string): string[] {
  const blocks: string[] = []
  const regex = new RegExp(`@${tag}[\\s\\S]*?\`\`\`tsx?([\\s\\S]*?)\`\`\``, 'g')
  let m
  while ((m = regex.exec(comment)) !== null) {
    blocks.push(m[1].trim())
  }
  return blocks
}
