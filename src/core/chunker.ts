/**
 * @ai-agent general-expert
 * @ai-runtime CLIENT UNIQUEMENT
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : FileChunk, chunkFile, writeChunk
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
import * as ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'

// ─── Constants ─────────────────────────────────────────────────────────────

/** Files with fewer lines than this threshold are not chunked. */
const CHUNK_THRESHOLD = 150

// ─── Interfaces ────────────────────────────────────────────────────────────

export interface FileChunk {
  filePath: string
  totalLines: number
  exports: ExportInfo[]
  imports: ImportInfo[]
  functions: FunctionInfo[]
  structure: StructureBlock[]
  importedBy: string[]
}

interface ExportInfo {
  name: string
  kind: 'function' | 'interface' | 'type' | 'const' | 'class'
  line: number
}

interface ImportInfo {
  from: string
  names: string[]
}

interface FunctionInfo {
  name: string
  startLine: number
  endLine: number
  params: string
  returnType: string
}

interface StructureBlock {
  description: string
  startLine: number
  endLine: number
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Parse a source file and return a structured chunk summary.
 * Returns null if the file has fewer lines than CHUNK_THRESHOLD.
 */
export function chunkFile(
  filePath: string,
  importedBy: string[],
  rootDir: string,
): FileChunk | null {
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  const lines = source.split('\n')
  if (lines.length < CHUNK_THRESHOLD) return null

  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)

  const exports: ExportInfo[] = []
  const imports: ImportInfo[] = []
  const functions: FunctionInfo[] = []

  ts.forEachChild(sourceFile, (node) => {
    // ── Imports ──────────────────────────────────────────────────────────
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text
      const names: string[] = []
      const clause = node.importClause
      if (clause) {
        if (clause.name) names.push(clause.name.text)
        if (clause.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            clause.namedBindings.elements.forEach(el => names.push(el.name.text))
          } else if (ts.isNamespaceImport(clause.namedBindings)) {
            names.push(`* as ${clause.namedBindings.name.text}`)
          }
        }
      }
      imports.push({ from, names })
      return
    }

    // ── Exported declarations ─────────────────────────────────────────────
    const hasExport = ts.canHaveModifiers(node)
      && (ts.getModifiers(node) ?? []).some(
        (m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword,
      )
    if (!hasExport) return

    const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1

    if (ts.isFunctionDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: 'function', line: startLine })
      functions.push({
        name: node.name.text,
        startLine,
        endLine,
        params: node.parameters.map(p => p.getText(sourceFile)).join(', '),
        returnType: node.type?.getText(sourceFile) ?? 'void',
      })
    } else if (ts.isInterfaceDeclaration(node)) {
      exports.push({ name: node.name.text, kind: 'interface', line: startLine })
    } else if (ts.isTypeAliasDeclaration(node)) {
      exports.push({ name: node.name.text, kind: 'type', line: startLine })
    } else if (ts.isClassDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: 'class', line: startLine })
    } else if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach(d => {
        if (ts.isIdentifier(d.name)) {
          exports.push({ name: d.name.text, kind: 'const', line: startLine })
          // Arrow functions counted as functions too
          if (d.initializer && (
            ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)
          )) {
            const fn = d.initializer
            functions.push({
              name: d.name.text,
              startLine,
              endLine,
              params: fn.parameters.map(p => p.getText(sourceFile)).join(', '),
              returnType: fn.type?.getText(sourceFile) ?? '',
            })
          }
        }
      })
    }
  })

  // ── Coarse structure blocks (every 50 lines) ──────────────────────────
  const structure: StructureBlock[] = []
  for (let i = 0; i < lines.length; i += 50) {
    const blockEnd = Math.min(i + 49, lines.length - 1)
    const blockLines = lines.slice(i, blockEnd + 1)
    structure.push({
      description: inferBlockDescription(blockLines, i + 1),
      startLine: i + 1,
      endLine: blockEnd + 1,
    })
  }

  return {
    filePath: relative(rootDir, filePath),
    totalLines: lines.length,
    exports,
    imports,
    functions,
    structure,
    importedBy: importedBy.map(f => relative(rootDir, f)),
  }
}

/**
 * Serialise a FileChunk to a Markdown file under `<outputDir>/chunks/<filePath>.md`.
 */
export function writeChunk(chunk: FileChunk, outputDir: string): void {
  const outputPath = join(outputDir, 'chunks', chunk.filePath + '.md')
  mkdirSync(dirname(outputPath), { recursive: true })

  const exportsSection = chunk.exports.length > 0
    ? chunk.exports.map(e => `- \`${e.name}\` (${e.kind}) — line ${e.line}`).join('\n')
    : '_No public export detected_'

  const importsSection = chunk.imports
    .filter(i => !i.from.startsWith('node:'))
    .map(i => `- ${i.from}${i.names.length > 0 ? ` (${i.names.join(', ')})` : ''}`)
    .join('\n') || '_No external imports_'

  const structureSection = chunk.structure
    .map(b => `- L. ${b.startLine}-${b.endLine} : ${b.description}`)
    .join('\n')

  const functionsTable = chunk.functions.length > 0
    ? [
        '| Name | Lines | Parameters | Return |',
        '|------|-------|------------|--------|',
        ...chunk.functions.map(f =>
          `| ${f.name} | ${f.startLine}-${f.endLine} | ${f.params || '—'} | ${f.returnType || '—'} |`,
        ),
      ].join('\n')
    : '_No exported function detected_'

  const importedBySection = chunk.importedBy.length > 0
    ? chunk.importedBy.map(f => `- \`${f}\``).join('\n')
    : '_Not imported (detected)_'

  const content = [
    `# Chunk — ${chunk.filePath}`,
    `> ${chunk.totalLines} lines — generated by aidoc-kit chunk`,
    '',
    '## Public exports',
    exportsSection,
    '',
    '## Key imports',
    importsSection,
    '',
    '## File structure',
    structureSection,
    '',
    '## Functions and methods',
    functionsTable,
    '',
    '## Imported by',
    importedBySection,
    '',
  ].join('\n')

  writeFileSync(outputPath, content, 'utf-8')
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function inferBlockDescription(blockLines: string[], startLine: number): string {
  const text = blockLines.join('\n')
  if (text.includes('export default') || text.match(/export\s+(function|const|class)/)) {
    return 'main exports'
  }
  if (text.match(/^import\s/m)) return 'imports'
  if (text.match(/\binterface\b|\btype\s+\w+\s*=/)) return 'types and interfaces'
  if (text.includes('useEffect') || text.includes('useState')) return 'React hooks'
  if (text.includes('async ') || text.includes('await ')) return 'async functions'
  if (text.match(/return\s*\(/)) return 'JSX render'
  return `lines ${startLine}–${startLine + blockLines.length - 1}`
}
