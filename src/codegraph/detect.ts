/**
 * @ai-agent general-expert
 * @ai-agent-hint If you are not the general-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GENERATED] This file exports: CODEGRAPH_PACKAGE, CodegraphInstall, detectCodegraph, codegraphInstallHint
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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CODEGRAPH_PACKAGE = '@colbymchenry/codegraph'

export interface CodegraphInstall {
  /** Absolute path to the codegraph executable */
  binPath: string
  version: string | null
}

/**
 * Locate CodeGraph in the target project's node_modules.
 * Falls back to aidoc-kit's own node_modules (useful when aidoc-kit is
 * installed globally alongside CodeGraph). Returns null when not found —
 * CodeGraph is an optional peer dependency, never assumed present.
 */
export function detectCodegraph(projectRoot: string): CodegraphInstall | null {
  const binName = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph'
  const candidates = [projectRoot, join(__dirname, '..', '..')]

  for (const root of candidates) {
    const binPath = join(root, 'node_modules', '.bin', binName)
    if (!existsSync(binPath)) continue

    let version: string | null = null
    try {
      const pkgPath = join(root, 'node_modules', CODEGRAPH_PACKAGE, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
      version = pkg.version ?? null
    } catch {
      // bin exists but package.json unreadable — version stays unknown
    }
    return { binPath, version }
  }

  return null
}

/** Actionable message shown when CodeGraph is missing. */
export function codegraphInstallHint(): string {
  return [
    `CodeGraph is not installed in this project.`,
    ``,
    `The \`index\` command uses ${CODEGRAPH_PACKAGE} as its low-level indexing engine.`,
    `Install it as a dev dependency (indexing only — never part of your app's runtime):`,
    ``,
    `  npm install -D ${CODEGRAPH_PACKAGE}`,
    ``,
    `Then run \`npx aidoc-kit index\` again.`,
  ].join('\n')
}
