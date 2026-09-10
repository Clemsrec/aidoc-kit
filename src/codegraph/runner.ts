/**
 * @ai-agent general-expert
 * @ai-agent-hint If you are not the general-expert specialist, consider switching to a specialized agent in Copilot Chat. Run `npx aidoc-kit agents` to generate agent instruction files.
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GENERATED] This file exports: codegraphDbPath, RunIndexOptions, runCodegraphIndex
 * Imported by: src/cli.ts, src/codegraph/loader.ts
 *
 * @ai-when-modifying
 * 1. Check cascade files below before modifying
 * 2. After modifying, ask the developer to run @ai-validate
 * 3. If you have no terminal access, report the command to run
 *
 * @ai-cascade
 * - src/cli.ts
 * - src/codegraph/loader.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Location of the CodeGraph SQLite index inside a project. */
export function codegraphDbPath(projectRoot: string): string {
  return join(projectRoot, '.codegraph', 'codegraph.db')
}

export interface RunIndexOptions {
  /** Map to `codegraph sync` (changes since last index) instead of a full rebuild */
  incremental: boolean
}

/**
 * Run CodeGraph indexing on the target project and verify the index exists.
 *
 * First run: `codegraph init --yes` (initializes .codegraph/ and builds the
 * initial index). Subsequent runs: `codegraph index` (full rebuild) or
 * `codegraph sync` when incremental.
 *
 * The binary is spawned directly (no shell) with inherited stdio so
 * CodeGraph's own progress output stays visible.
 */
export function runCodegraphIndex(
  projectRoot: string,
  binPath: string,
  opts: RunIndexOptions,
): void {
  const initialized = existsSync(codegraphDbPath(projectRoot))
  const subcommand = !initialized ? 'init' : opts.incremental ? 'sync' : 'index'
  const args = subcommand === 'init'
    ? ['init', '--yes', projectRoot]
    : [subcommand, projectRoot]

  const result = spawnSync(binPath, args, { stdio: 'inherit' })

  if (result.error) {
    throw new Error(`Failed to run codegraph ${subcommand}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`codegraph ${subcommand} exited with code ${result.status ?? 'unknown'}`)
  }
  if (!existsSync(codegraphDbPath(projectRoot))) {
    throw new Error(
      `codegraph ${subcommand} completed but ${codegraphDbPath(projectRoot)} was not created.`,
    )
  }
}
