#!/usr/bin/env node
// Runs every (task, condition, repetition) with `claude -p` in a fresh copy of
// the matching template, then checks the result. One JSON file per run.
// Usage: node bench/run.mjs <workDir> [--tasks a,b] [--conditions A,B,C] [--reps 3]
//        [--concurrency 3] [--model claude-sonnet-5-5] [--budget 1]

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TASKS } from './tasks.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [work, ...rest] = process.argv.slice(2)
if (!work) {
  console.error('Usage: node bench/run.mjs <workDir> [options]')
  process.exit(1)
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i === -1 ? fallback : rest[i + 1]
}

const taskIds = opt('tasks', TASKS.map(t => t.id).join(',')).split(',')
const conditions = opt('conditions', 'A,B,C').split(',')
const reps = Number(opt('reps', '3'))
const concurrency = Number(opt('concurrency', '3'))
const model = opt('model', 'claude-sonnet-5-5')
const budget = opt('budget', '1')

const resultsDir = join(work, 'results')
mkdirSync(resultsDir, { recursive: true })

const mcpConfigs = {
  none: join(work, 'mcp-none.json'),
  aidoc: join(work, 'mcp-aidoc.json'),
}
writeFileSync(mcpConfigs.none, JSON.stringify({ mcpServers: {} }))
writeFileSync(mcpConfigs.aidoc, JSON.stringify({
  mcpServers: { 'aidoc-kit': { command: process.execPath, args: [join(repo, 'dist/cli.js'), 'mcp'] } },
}))

const ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'mcp__aidoc-kit']
const DISALLOWED = ['Agent', 'Task', 'WebFetch', 'WebSearch']

function runClaude(cwd, prompt, mcpConfig) {
  const args = [
    '-p', prompt,
    '--model', model,
    '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence',
    '--setting-sources', 'project',
    '--strict-mcp-config', '--mcp-config', mcpConfig,
    '--allowedTools', ...ALLOWED,
    '--disallowedTools', ...DISALLOWED,
    '--max-budget-usd', budget,
  ]
  return new Promise(resolvePromise => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000)
    child.on('close', code => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }) })
  })
}

function parseStream(stdout) {
  const tools = {}
  let final = null
  let mcpServers = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'tool_use') tools[block.name] = (tools[block.name] ?? 0) + 1
      }
    }
    if (msg.type === 'system' && msg.subtype === 'init') mcpServers = msg.mcp_servers ?? []
    if (msg.type === 'result') final = msg
  }
  return { tools, final, mcpServers }
}

const jobs = []
for (const taskId of taskIds) {
  const task = TASKS.find(t => t.id === taskId)
  if (!task) throw new Error(`unknown task ${taskId}`)
  for (const condition of conditions) {
    for (let rep = 1; rep <= reps; rep++) jobs.push({ task, condition, rep })
  }
}

async function runJob({ task, condition, rep }) {
  const runId = `${task.id}__${condition}__${rep}`
  const outFile = join(resultsDir, `${runId}.json`)
  if (existsSync(outFile)) return `${runId} (cached)`
  const template = join(work, 'templates', condition === 'A' ? 'A' : 'B')
  const dir = join(work, 'runs', runId)
  rmSync(dir, { recursive: true, force: true })
  cpSync(template, dir, { recursive: true, verbatimSymlinks: true })

  const started = Date.now()
  const { code, stdout, stderr } = await runClaude(dir, task.prompt, condition === 'C' ? mcpConfigs.aidoc : mcpConfigs.none)
  const wall = Date.now() - started
  const { tools, final, mcpServers } = parseStream(stdout)
  const answer = typeof final?.result === 'string' ? final.result : ''
  let check
  try {
    check = task.check(dir, template, answer)
  } catch (err) {
    check = { pass: false, details: { checkError: String(err) } }
  }
  const usage = final?.usage ?? {}
  const record = {
    runId, task: task.id, condition, rep, model,
    exitCode: code,
    subtype: final?.subtype ?? null,
    isError: final?.is_error ?? true,
    costUsd: final?.total_cost_usd ?? null,
    durationMs: final?.duration_ms ?? wall,
    turns: final?.num_turns ?? null,
    inputTokens: usage.input_tokens ?? null,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? null,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    tools,
    mcpServers,
    pass: check.pass,
    checks: check.details,
    answer: answer.slice(0, 2000),
    stderr: stderr.slice(-1000),
  }
  writeFileSync(outFile, JSON.stringify(record, null, 2))
  rmSync(dir, { recursive: true, force: true })
  return `${runId} ${record.pass ? 'PASS' : 'FAIL'} $${record.costUsd?.toFixed(3)} ${record.turns} turns ${(record.durationMs / 1000).toFixed(0)}s`
}

let next = 0
let done = 0
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++]
    const line = await runJob(job)
    done++
    console.log(`[${done}/${jobs.length}] ${line}`)
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker))
console.log('done')
