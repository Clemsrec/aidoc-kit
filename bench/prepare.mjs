#!/usr/bin/env node
// Builds the three starting points of the benchmark from the generated fixture:
//   A  plain project
//   B  A + everything aidoc-kit writes (@ai-* blocks, AGENTS.md, chunks, graph)
//   C  B + the aidoc-kit MCP server (wired by run.mjs)
// Usage: node bench/prepare.mjs <workDir>

import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = process.argv[2]
if (!work) {
  console.error('Usage: node bench/prepare.mjs <workDir>')
  process.exit(1)
}

const cli = join(repo, 'dist/cli.js')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' })
const commit = (dir, message) => {
  run('git', ['add', '-A'], dir)
  run('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@localhost', 'commit', '-q', '-m', message], dir)
}

rmSync(join(work, 'templates'), { recursive: true, force: true })
const A = join(work, 'templates/A')
const B = join(work, 'templates/B')
mkdirSync(A, { recursive: true })

run(process.execPath, [join(repo, 'bench/generate-fixture.mjs'), A], repo)
// typescript and codegraph come from the aidoc-kit checkout
symlinkSync(join(repo, 'node_modules'), join(A, 'node_modules'))
run('git', ['init', '-q'], A)
commit(A, 'initial')

cpSync(A, B, { recursive: true, verbatimSymlinks: true })
run(process.execPath, [cli, 'scan', '--write', '--yes'], B)
run(process.execPath, [cli, 'chunk'], B)
run(process.execPath, [cli, 'index'], B)
// A pointer, as the README recommends: an `@AGENTS.md` import would load the
// whole file into every session (measured: +2,260 tokens before the first turn).
appendFileSync(join(B, 'CLAUDE.md'), '\nBefore modifying code, read AGENTS.md (code map and rules for agents).\n')
commit(B, 'aidoc-kit')

console.log(`templates ready in ${join(work, 'templates')} (C reuses B with the MCP server)`)
