import * as ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Rule, AidocConfig } from '../types'

// ─── Writer — generate @ai-* block for undocumented files ─────────────────

export function generateAiDocBlock(
  filePath: string,
  cascadeDeps: string[] = [],
  config: AidocConfig = {},
): string {
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }

  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)

  const runtime = detectRuntime(source)
  const imports = extractImports(sourceFile)
  const agent = inferAgent(imports, filePath, config.agents ?? {})
  const exports = extractExports(sourceFile)
  const validateCmd = config.validate ?? 'npm run typecheck'

  const exportList = exports.length > 0 ? exports.join(', ') : basename(filePath)
  const importedIn = cascadeDeps.length > 0
    ? `Imported by: ${cascadeDeps.join(', ')}`
    : ''
  // IMPORTANT: generated @ai-* blocks must be 100% ASCII.
  // No Unicode characters — SWC, Turbopack, Babel, and esbuild all have
  // different tolerance levels. Plain dash is the only universally safe choice.
  const cascadeLines = cascadeDeps.length > 0
    ? cascadeDeps.map(f => ` * - ${f}`).join('\n')
    : ' * (none detected)'

  return `/**
 * @ai-agent ${agent}
 * @ai-runtime ${runtime}
 *
 * @ai-context
 * [GENERATED] This file exports: ${exportList}
 * ${importedIn}
 *
 * @ai-when-modifying
 * 1. Check cascade files below before modifying
 * 2. After modifying, ask the developer to run @ai-validate
 * 3. If you have no terminal access, report the command to run
 *
 * @ai-cascade
${cascadeLines}
 *
 * @ai-validate
 * ${validateCmd}
 */`
}

// ─── Transformer — apply rules to a file ──────────────────────────────────

export function applyRules(
  filePath: string,
  rules: Rule[],
): { changed: boolean; source: string } {
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch {
    return { changed: false, source: '' }
  }

  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const edits: Array<{ start: number; end: number; replacement: string }> = []

  ts.forEachChild(sourceFile, function visit(node) {
    for (const rule of rules) {
      if (rule.match(node, sourceFile)) {
        const replacement = rule.replace(node, sourceFile)
        if (replacement !== null) {
          edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), replacement })
        }
      }
    }
    ts.forEachChild(node, visit)
  })

  if (edits.length === 0) return { changed: false, source }

  // Apply in reverse order to preserve character positions
  edits.sort((a, b) => b.start - a.start)
  let result = source
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }

  return { changed: true, source: result }
}

// ─── AST helpers ──────────────────────────────────────────────────────────

function extractImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = []
  ts.forEachChild(sourceFile, node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text)
    }
  })
  return imports
}

function extractExports(sourceFile: ts.SourceFile): string[] {
  const exports: string[] = []
  ts.forEachChild(sourceFile, node => {
    const hasExport = (n: ts.Node) =>
      (n as ts.HasModifiers).modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false

    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && hasExport(node)) {
      if (node.name) exports.push(node.name.text)
    } else if (ts.isVariableStatement(node) && hasExport(node)) {
      node.declarationList.declarations.forEach(d => {
        if (ts.isIdentifier(d.name)) exports.push(d.name.text)
      })
    } else if (ts.isTypeAliasDeclaration(node) && hasExport(node)) {
      exports.push(node.name.text)
    } else if (ts.isInterfaceDeclaration(node) && hasExport(node)) {
      exports.push(node.name.text)
    }
  })
  return exports
}

/** Infer the responsible agent from import paths and file location */
function inferAgent(
  imports: string[],
  filePath: string,
  customRules: Record<string, string> = {},
): string {
  const importStr = imports.join(' ')

  // 1. Custom rules from aidoc.config — checked first so projects can override
  for (const [substring, agent] of Object.entries(customRules)) {
    if (importStr.includes(substring) || filePath.includes(substring)) return agent
  }

  // 2. Built-in import-based rules (most specific first)
  if (/firebase-admin/.test(importStr)) return 'firebase-admin-expert'
  if (/firebase\/auth/.test(importStr)) return 'auth-expert'
  if (/firebase/.test(importStr)) return 'firebase-expert'
  if (/next-auth|next\/auth/.test(importStr)) return 'auth-expert'
  if (/stripe/.test(importStr)) return 'billing-expert'
  if (/prisma|drizzle|sequelize|mongoose/.test(importStr)) return 'db-expert'
  if (/@tanstack\/react-query|react-query|swr/.test(importStr)) return 'data-fetching-expert'
  if (/zustand/.test(importStr)) return 'state-expert'
  if (/react-hook-form/.test(importStr)) return 'forms-expert'
  if (/next\/navigation|next\/router/.test(importStr)) return 'routing-expert'
  if (/next\/image|next\/link/.test(importStr)) return 'ui-expert'
  if (/context|provider/i.test(importStr)) return 'context-expert'

  // 3. File path heuristics
  if (/\/store\//i.test(filePath)) return 'state-expert'
  if (/\/auth\//i.test(filePath)) return 'auth-expert'
  if (/\/hooks\//i.test(filePath)) return 'hooks-expert'
  if (/\/api\//i.test(filePath)) return 'api-expert'
  if (/\/components?\//i.test(filePath)) return 'ui-expert'
  if (/\/lib\//i.test(filePath) || /\/utils?\//i.test(filePath)) return 'utils-expert'
  if (/\/types?\.?/i.test(filePath)) return 'types-expert'

  return 'general-expert'
}

// ─── Runtime detection ─────────────────────────────────────────────────────

/**
 * Detect the execution environment from source code.
 * Explicit directives (`'use client'`, `'use server'`) take priority,
 * then heuristics (React hooks - CLIENT, firebase-admin imports - SERVER).
 */
function detectRuntime(source: string): string {
  // Only inspect the file head for the directives to avoid false positives inside strings
  const head = source.slice(0, 300)

  if (/^\s*(?:\/\/[^\n]*\n\s*)*['"]use client['"]/.test(head)) return 'CLIENT UNIQUEMENT'
  if (/^\s*(?:\/\/[^\n]*\n\s*)*['"]use server['"]/.test(head)) return 'SERVER UNIQUEMENT'

  // Heuristics on full source
  if (/['"]firebase-admin['"]/.test(source)) return 'SERVER UNIQUEMENT'
  if (/\buseState\b|\buseEffect\b|\buseRef\b|\buseReducer\b|\buseCallback\b|\buseMemo\b/.test(source)) {
    return 'CLIENT UNIQUEMENT'
  }

  return 'UNIVERSEL'
}

