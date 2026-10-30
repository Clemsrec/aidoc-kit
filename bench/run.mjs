#!/usr/bin/env node
// Runs every (task, condition, repetition) with `claude -p` in a fresh copy of
// the matching template, then checks the result. One JSON file per run.
// Usage: node bench/run.mjs <workDir> [--tasks a,b] [--conditions A,B,C] [--reps 3]
//        [--concurrency 3] [--model claude-sonnet-5-5] [--budget 1] [--tasks-file path]
//
// <workDir>/conditions.json, when present, maps each condition to its template
// and MCP server: {"C": {"template": "C", "mcp": []}} (null for no server; the
// array holds extra `aidoc-kit mcp` arguments). Without it: A plain, B files,
// C files + MCP, as prepared by bench/prepare.mjs.

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

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

const tasksFile = resolve(opt('tasks-file', join(dirname(fileURLToPath(import.meta.url)), 'tasks.mjs')))
const { TASKS } = await import(pathToFileURL(tasksFile).href)
const conditionsFile = join(work, 'conditions.json')
const CONDITIONS = existsSync(conditionsFile)
  ? JSON.parse(readFileSync(conditionsFile, 'utf-8'))
  : { A: { template: 'A', mcp: null }, B: { template: 'B', mcp: null }, C: { template: 'B', mcp: [] } }

const taskIds = opt('tasks', TASKS.map(t => t.id).join(',')).split(',')
const conditions = opt('conditions', Object.keys(CONDITIONS).join(',')).split(',')
const reps = Number(opt('reps', '3'))
const concurrency = Number(opt('concurrency', '3'))
const model = opt('model', 'claude-sonnet-5-5')
const budget = opt('budget', '1')

const resultsDir = join(work, 'results')
mkdirSync(resultsDir, { recursive: true })

// One MCP config file per condition: no server, or aidoc-kit with its arguments.
function mcpConfigFor(condition) {
  const file = join(work, `mcp-${condition}.json`)
  const extra = CONDITIONS[condition].mcp
  const servers = extra === null ? {} : { 'aidoc-kit': { command: process.execPath, args: [join(repo, 'dist/cli.js'), 'mcp', ...extra] } }
  writeFileSync(file, JSON.stringify({ mcpServers: servers }))
  return file
}

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

// Repetition-major order: conditions alternate, so none runs on a prompt cache
// warmed by its own previous sessions more than the others.
for (const c of conditions) if (!CONDITIONS[c]) throw new Error(`unknown condition ${c}`)
const jobs = []
for (let rep = 1; rep <= reps; rep++) {
  for (const taskId of taskIds) {
    const task = TASKS.find(t => t.id === taskId)
    if (!task) throw new Error(`unknown task ${taskId}`)
    for (const condition of conditions) jobs.push({ task, condition, rep })
  }
}

async function runJob({ task, condition, rep }) {
  const runId = `${task.id}__${condition}__${rep}`
  const outFile = join(resultsDir, `${runId}.json`)
  if (existsSync(outFile)) return `${runId} (cached)`
  const template = join(work, 'templates', CONDITIONS[condition].template)
  const dir = join(work, 'runs', runId)
  rmSync(dir, { recursive: true, force: true })
  cpSync(template, dir, { recursive: true, verbatimSymlinks: true })

  const started = Date.now()
  const { code, stdout, stderr } = await runClaude(dir, task.prompt, mcpConfigFor(condition))
  const wall = Date.now() - started
  const { tools, final, mcpServers } = parseStream(stdout)
  const answer = typeof final?.result === 'string' ? final.result : ''
  let check
  try {
    check = await task.check(dir, template, answer)
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
