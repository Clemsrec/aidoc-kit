#!/usr/bin/env node
// Aggregates bench/run.mjs results into summary.json (per task and condition).
// Usage: node bench/analyze.mjs <workDir> [--tasks-file path]

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const work = process.argv[2]
if (!work) {
  console.error('Usage: node bench/analyze.mjs <workDir>')
  process.exit(1)
}

const tasksFlag = process.argv.indexOf('--tasks-file')
const tasksFile = resolve(tasksFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), 'tasks.mjs') : process.argv[tasksFlag + 1])
const { TASKS } = await import(pathToFileURL(tasksFile).href)

const runs = readdirSync(join(work, 'results'))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(work, 'results', f), 'utf-8')))

const mean = xs => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)
const sd = xs => {
  const m = mean(xs)
  return xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}
const totalInput = r => (r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheCreationTokens ?? 0)
const toolCalls = r => Object.values(r.tools).reduce((a, b) => a + b, 0)
const mcpCalls = r => Object.entries(r.tools).filter(([k]) => k.startsWith('mcp__')).reduce((a, [, v]) => a + v, 0)

function stats(group) {
  const pick = f => group.map(f)
  return {
    runs: group.length,
    successRate: mean(pick(r => (r.pass ? 1 : 0))),
    costUsd: mean(pick(r => r.costUsd ?? 0)),
    costSd: sd(pick(r => r.costUsd ?? 0)),
    inputTokens: mean(pick(totalInput)),
    uncachedInputTokens: mean(pick(r => (r.inputTokens ?? 0) + (r.cacheCreationTokens ?? 0))),
    cacheReadTokens: mean(pick(r => r.cacheReadTokens ?? 0)),
    outputTokens: mean(pick(r => r.outputTokens ?? 0)),
    turns: mean(pick(r => r.turns ?? 0)),
    durationS: mean(pick(r => r.durationMs / 1000)),
    toolCalls: mean(pick(toolCalls)),
    mcpCalls: mean(pick(mcpCalls)),
    mcpServers: [...new Set(group.flatMap(r => (r.mcpServers ?? []).map(s => `${s.name}:${s.status}`)))],
  }
}

const conditions = [...new Set(runs.map(r => r.condition))].sort()
const perTask = TASKS.map(t => ({
  id: t.id,
  title: t.title,
  byCondition: Object.fromEntries(conditions.map(c => [c, stats(runs.filter(r => r.task === t.id && r.condition === c))])),
  failures: runs.filter(r => r.task === t.id && !r.pass).map(r => ({ runId: r.runId, checks: r.checks, subtype: r.subtype })),
}))

const overall = Object.fromEntries(conditions.map(c => [c, stats(runs.filter(r => r.condition === c))]))

function srcBytes(dir) {
  let total = 0
  const walk = d => {
    for (const e of readdirSync(d)) {
      const full = join(d, e)
      if (statSync(full).isDirectory()) walk(full)
      else total += statSync(full).size
    }
  }
  walk(dir)
  return total
}
const sourceSize = Object.fromEntries(
  readdirSync(join(work, 'templates')).filter(t => existsSync(join(work, 'templates', t, 'src'))).map(t => [t, srcBytes(join(work, 'templates', t, 'src'))]),
)

const toolUsage = Object.fromEntries(conditions.map(c => {
  const totals = {}
  for (const r of runs.filter(x => x.condition === c)) for (const [k, v] of Object.entries(r.tools)) totals[k] = (totals[k] ?? 0) + v
  return [c, totals]
}))

const summary = {
  generatedAt: new Date().toISOString(),
  model: runs[0]?.model,
  totalRuns: runs.length,
  totalCostUsd: runs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
  overall,
  perTask,
  sourceSize,
  toolUsage,
}
writeFileSync(join(work, 'summary.json'), JSON.stringify(summary, null, 2))

const pct = (x, base) => (base ? `${(((x - base) / base) * 100).toFixed(0)}%` : 'n/a')
console.log(`${runs.length} runs, total $${summary.totalCostUsd.toFixed(2)}, model ${summary.model}`)
console.log(`source size ${Object.entries(sourceSize).map(([t, b]) => `${t} ${b}`).join(' ')}`)
for (const c of conditions) {
  const o = overall[c]
  console.log(`${c}: success ${(o.successRate * 100).toFixed(0)}% cost $${o.costUsd.toFixed(4)} (${pct(o.costUsd, overall.A.costUsd)}) input ${o.inputTokens.toFixed(0)} uncached ${o.uncachedInputTokens.toFixed(0)} out ${o.outputTokens.toFixed(0)} turns ${o.turns.toFixed(1)} tools ${o.toolCalls.toFixed(1)} mcp ${o.mcpCalls.toFixed(1)} ${o.durationS.toFixed(0)}s`)
}
for (const t of perTask) {
  console.log(`\n${t.id}`)
  for (const c of conditions) {
    const s = t.byCondition[c]
    if (!s.runs) continue
    console.log(`  ${c}: ${(s.successRate * 100).toFixed(0)}% $${s.costUsd.toFixed(4)}±${s.costSd.toFixed(4)} out ${s.outputTokens.toFixed(0)} turns ${s.turns.toFixed(1)} tools ${s.toolCalls.toFixed(1)} mcp ${s.mcpCalls.toFixed(1)} ${s.durationS.toFixed(0)}s`)
  }
  for (const f of t.failures) console.log(`  FAIL ${f.runId} ${f.subtype} ${JSON.stringify(f.checks)}`)
}
console.log('\ntool usage', JSON.stringify(toolUsage))
