import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { chunkFile, renderChunk } from '../core/chunker'

// Claude Code PreToolUse hook: a Read of a whole large source file is refused
// and answered with the file's structure, so the agent reads only the lines it
// needs. A Read with offset or limit always goes through.

export const DEFAULT_MIN_LINES = 400
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const MAX_FILE_BYTES = 2 * 1024 * 1024

interface HookInput {
  tool_name?: unknown
  tool_input?: { file_path?: unknown; offset?: unknown; limit?: unknown }
  cwd?: unknown
}

export interface HookDecision {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'deny'
    permissionDecisionReason: string
  }
}

/** The decision for one hook call, or null to let the Read run unchanged. */
export function readGuard(input: unknown, minLines = DEFAULT_MIN_LINES): HookDecision | null {
  if (typeof input !== 'object' || input === null) return null
  const { tool_name, tool_input, cwd } = input as HookInput
  if (tool_name !== 'Read' || !tool_input) return null
  if (tool_input.offset !== undefined || tool_input.limit !== undefined) return null
  const raw = tool_input.file_path
  if (typeof raw !== 'string' || !SOURCE_EXTENSIONS.has(extname(raw))) return null
  const root = typeof cwd === 'string' ? cwd : process.cwd()
  const file = isAbsolute(raw) ? raw : resolve(root, raw)
  if (!existsSync(file) || statSync(file).size > MAX_FILE_BYTES) return null

  const lines = readFileSync(file, 'utf-8').split('\n').length
  if (lines < minLines) return null
  const chunk = chunkFile(file, [], root)
  if (!chunk) return null
  const summary = renderChunk({ ...chunk, filePath: relative(root, file) })
    .replace(/\n## Imported by[\s\S]*$/, '')
    .trim()

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `${relative(root, file)} has ${lines} lines: here is its structure instead of the full file (aidoc-kit read guard).`,
        'Read only the part you need with offset and limit (for example offset=120 limit=80).',
        'If you really need the whole file, read it with offset=1 limit=' + lines + '.',
        '',
        summary,
      ].join('\n'),
    },
  }
}
