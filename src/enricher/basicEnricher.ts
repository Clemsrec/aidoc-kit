/**
 * @ai-agent general-expert
 * @ai-agent-hint If you are not the general-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GENERATED] This file exports: inferRole, inferTags, computeCriticality, criticalityLevel, enrichGraph
 * Imported by: src/cli.ts
 *
 * @ai-when-modifying
 * 1. Check cascade files below before modifying
 * 2. After modifying, ask the developer to run @ai-validate
 * 3. If you have no terminal access, report the command to run
 *
 * @ai-cascade
 * - src/cli.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CriticalityLevel,
  EnrichedFile,
  EnrichedGraph,
  FileRole,
  RawGraph,
} from '../graph/types'

// ─── Role inference ────────────────────────────────────────────────────────

const SERVER_PATH_PATTERN = /(^|\/)(app\/api|pages\/api|server|api)(\/|$)/
const CLIENT_HOOKS_PATTERN = /\buseState\b|\buseEffect\b|\buseRef\b|\buseReducer\b|\buseCallback\b|\buseMemo\b/
// App Router entry files are Server Components by default. Only entry files
// are safe to classify this way: a shared component under app/ can still be
// pulled into a client bundle when imported from a 'use client' boundary.
// error/global-error are excluded — Next.js requires the directive on them.
const APP_ENTRY_PATTERN =
  /(^|\/)app\/(?:.*\/)?(page|layout|template|loading|not-found|default|route|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.[jt]sx?$/

/**
 * Infer the execution role of a file. Explicit directives win, then path
 * conventions (Next.js API routes, server/ folders, .server/.client
 * suffixes), then content heuristics — same priority order as the
 * @ai-runtime detection in core/transformer.
 */
export function inferRole(relPath: string, source: string): { role: FileRole; reason: string } {
  const head = source.slice(0, 300)
  if (/^\s*(?:\/\/[^\n]*\n\s*)*['"]use client['"]/.test(head)) {
    return { role: 'client', reason: `'use client' directive` }
  }
  if (/^\s*(?:\/\/[^\n]*\n\s*)*['"]use server['"]/.test(head)) {
    return { role: 'server', reason: `'use server' directive` }
  }

  const normalized = relPath.replace(/\\/g, '/')
  if (/\.server\.[jt]sx?$/.test(normalized)) return { role: 'server', reason: '.server file suffix' }
  if (/\.client\.[jt]sx?$/.test(normalized)) return { role: 'client', reason: '.client file suffix' }
  const entryMatch = normalized.match(APP_ENTRY_PATTERN)
  if (entryMatch) return { role: 'server', reason: `App Router entry ${entryMatch[2]} (RSC default)` }
  const serverMatch = normalized.match(SERVER_PATH_PATTERN)
  if (serverMatch) return { role: 'server', reason: `server path (${serverMatch[2]}/)` }

  if (/['"]firebase-admin['"]/.test(source)) return { role: 'server', reason: 'firebase-admin import' }
  if (CLIENT_HOOKS_PATTERN.test(source)) return { role: 'client', reason: 'React hooks usage' }

  return { role: 'universal', reason: 'no client/server signal' }
}

// ─── Criticality ───────────────────────────────────────────────────────────

const TAG_PATTERNS: Array<[tag: string, pattern: RegExp]> = [
  ['api', /(^|\/)(app\/api|pages\/api|api)(\/|$)/],
  ['auth', /auth/i],
  ['billing', /billing|invoice/i],
  ['payment', /payment|stripe|checkout/i],
]

/** Tags carrying a criticality bonus beyond plain fan-in. */
const SENSITIVE_TAGS = new Set(['auth', 'billing', 'payment'])

export function inferTags(relPath: string): string[] {
  const normalized = relPath.replace(/\\/g, '/')
  return TAG_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([tag]) => tag)
}

/**
 * Criticality score, 0-100:
 * - fan-in: 6 points per dependent file, capped at 60 (10+ dependents saturate)
 * - +15 when the file is an API surface
 * - +25 when it belongs to a sensitive domain (auth, billing, payment)
 */
export function computeCriticality(inDegree: number, tags: string[]): number {
  let score = Math.min(60, inDegree * 6)
  if (tags.includes('api')) score += 15
  if (tags.some(t => SENSITIVE_TAGS.has(t))) score += 25
  return Math.min(100, score)
}

export function criticalityLevel(score: number): CriticalityLevel {
  if (score >= 80) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 25) return 'medium'
  return 'low'
}

// ─── Enrichment pass ───────────────────────────────────────────────────────

/**
 * Layer aidoc-kit's intelligence (roles, criticality, tags) on top of the
 * raw CodeGraph output. Pure function apart from reading file sources for
 * directive detection — a file that cannot be read falls back to path rules.
 */
export function enrichGraph(raw: RawGraph, projectRoot: string): EnrichedGraph {
  // Distinct dependents/dependencies per file, all edge kinds included
  const dependents = new Map<string, Set<string>>()
  const dependencies = new Map<string, Set<string>>()
  for (const edge of raw.fileEdges) {
    if (!dependents.has(edge.to)) dependents.set(edge.to, new Set())
    dependents.get(edge.to)!.add(edge.from)
    if (!dependencies.has(edge.from)) dependencies.set(edge.from, new Set())
    dependencies.get(edge.from)!.add(edge.to)
  }

  const files: EnrichedFile[] = raw.files.map(f => {
    let source = ''
    try {
      source = readFileSync(join(projectRoot, f.path), 'utf-8')
    } catch {
      // deleted since indexing, or unreadable — path rules still apply
    }
    const { role, reason } = inferRole(f.path, source)
    const tags = inferTags(f.path)
    const inDegree = dependents.get(f.path)?.size ?? 0
    const outDegree = dependencies.get(f.path)?.size ?? 0
    const criticality = computeCriticality(inDegree, tags)

    return {
      file: f.path,
      language: f.language,
      role,
      roleReason: reason,
      criticality,
      criticalityLevel: criticalityLevel(criticality),
      inDegree,
      outDegree,
      tags,
      symbolCount: f.symbolCount,
    }
  })

  const countRole = (role: FileRole) => files.filter(f => f.role === role).length

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    codegraph: { version: raw.codegraphVersion },
    stats: {
      files: files.length,
      edges: raw.fileEdges.length,
      client: countRole('client'),
      server: countRole('server'),
      universal: countRole('universal'),
    },
    files,
    edges: raw.fileEdges,
  }
}
