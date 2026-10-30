// Benchmark tasks and their automatic checks. Each check receives the run
// directory after the agent finished, the base template it started from and
// the agent's final answer, and returns { pass, details }.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

function tsc(dir, extra = []) {
  const res = spawnSync(process.execPath, [join(dir, 'node_modules/typescript/bin/tsc'), '-p', dir, ...extra], { encoding: 'utf-8' })
  return { ok: res.status === 0, output: (res.stdout + res.stderr).trim().split('\n').slice(0, 5).join('\n') }
}

/** Compile the project to JS and evaluate `code` with `@/` mapped to the output. */
function evaluate(dir, code) {
  const outDir = mkdtempSync(join(tmpdir(), 'bench-emit-'))
  // Type errors are reported by the typecheck criterion; tsc still emits JS.
  tsc(dir, ['--noEmit', 'false', '--outDir', outDir])
  const prelude = `
    const Module = require('module'); const path = require('path')
    const orig = Module._resolveFilename
    Module._resolveFilename = function (req, ...rest) {
      if (req.startsWith('@/')) req = path.join(${JSON.stringify(outDir)}, req.slice(2))
      return orig.call(this, req, ...rest)
    }
    const load = p => require(path.join(${JSON.stringify(outDir)}, p))
  `
  const res = spawnSync(process.execPath, ['-e', prelude + code], { encoding: 'utf-8', cwd: outDir })
  if (res.status !== 0) return { ok: false, error: (res.stderr || res.stdout).trim().split('\n').slice(0, 4).join(' ') }
  try {
    return { ok: true, value: JSON.parse(res.stdout.trim().split('\n').pop()) }
  } catch {
    return { ok: false, error: `bad output: ${res.stdout.slice(0, 200)}` }
  }
}

function walk(dir, root = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', '.codegraph', '.codemod'].includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, root, acc)
    else acc.push(relative(root, full))
  }
  return acc
}

function grepFiles(dir, pattern, roots) {
  return walk(dir).filter(f => roots.some(r => f.startsWith(r)) && pattern.test(readFileSync(join(dir, f), 'utf-8')))
}

function gitChanged(dir) {
  return execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
}

function result(checks) {
  return { pass: Object.values(checks).every(Boolean), details: checks }
}

/** Files importing the session module, computed from the untouched template. */
function sessionImporters(templateDir) {
  return walk(templateDir)
    .filter(f => f.startsWith('src/') && f !== 'src/lib/auth/session.ts')
    .filter(f => /from ['"](@\/lib\/auth\/session|\.\/session)['"]/.test(readFileSync(join(templateDir, f), 'utf-8')))
    .sort()
}

export const TASKS = [
  {
    id: 'session-null',
    title: 'Change a critical function contract',
    prompt:
      'getSession in src/lib/auth/session.ts throws an AuthError when the request has no session cookie. ' +
      'Change it so it returns null in that case instead (an expired session must still throw). ' +
      'requireSession must keep throwing AuthError("missing session") when there is no session. ' +
      'Update every caller so the project typechecks and behaves the same for requests that have a session.',
    check(dir) {
      const types = tsc(dir)
      const run = evaluate(dir, `
        const s = load('lib/auth/session.js')
        const none = new Request('http://x/')
        let requireReason = null
        try { s.requireSession(none) } catch (e) { requireReason = e.reason }
        const token = s.encodeSession({ userId: 'u1', role: 'customer', expiresAt: Date.now() + 60000 })
        const ok = s.getSession(new Request('http://x/', { headers: { cookie: 'sf_session=' + encodeURIComponent(token) } }))
        console.log(JSON.stringify({ nullWhenMissing: s.getSession(none) === null, requireReason, userId: ok && ok.userId }))
      `)
      return result({
        typecheck: types.ok,
        returnsNull: run.ok && run.value.nullWhenMissing === true,
        requireStillThrows: run.ok && run.value.requireReason === 'missing session',
        validSessionWorks: run.ok && run.value.userId === 'u1',
      })
    },
  },
  {
    id: 'rename-money',
    title: 'Rename a widely used module',
    prompt:
      'Rename src/lib/money.ts to src/lib/currency.ts and update everything that refers to it. ' +
      'Nothing else should change.',
    check(dir) {
      const audit = spawnSync('node', ['scripts/audit-files.mjs'], { cwd: dir, encoding: 'utf-8' })
      return result({
        oldFileGone: !existsSync(join(dir, 'src/lib/money.ts')),
        newFileExists: existsSync(join(dir, 'src/lib/currency.ts')),
        typecheck: tsc(dir).ok,
        auditPasses: audit.status === 0,
        noStaleReference: grepFiles(dir, /lib\/money\b/, ['src/', 'config/', 'scripts/']).length === 0,
      })
    },
  },
  {
    id: 'order-currency',
    title: 'Add a required field to a shared type',
    prompt:
      "Add a required `currency: 'EUR' | 'USD'` field to the Order type in src/types/order.ts and fix every " +
      "place that builds an Order so the project typechecks. Take the currency from the order total when there is one, otherwise default to 'EUR'.",
    check(dir) {
      const type = readFileSync(join(dir, 'src/types/order.ts'), 'utf-8')
      return result({
        fieldAdded: /currency\s*:\s*['"](EUR|USD)['"]\s*\|\s*['"](EUR|USD)['"]|currency\s*:\s*Currency/.test(type) && !/currency\?\s*:/.test(type),
        typecheck: tsc(dir).ok,
      })
    },
  },
  {
    id: 'fee-bug',
    title: 'Find a bug in a large file',
    prompt:
      'Customers report that the platform fee taken on each payment is about ten times what our pricing page ' +
      'announces (2.5%). Find the bug and fix it.',
    check(dir) {
      const run = evaluate(dir, `
        const { computeApplicationFee } = load('lib/payments/stripe.js')
        const { money } = load(require('fs').existsSync(require('path').join(process.cwd(), 'lib/money.js')) ? 'lib/money.js' : 'lib/currency.js')
        console.log(JSON.stringify({ fee: computeApplicationFee(money(10000)).cents, min: computeApplicationFee(money(100)).cents, capped: computeApplicationFee(money(20)).cents }))
      `)
      return result({
        typecheck: tsc(dir).ok,
        feeIs2_5Percent: run.ok && run.value.fee === 250,
        minimumKept: run.ok && run.value.min === 30,
        capKept: run.ok && run.value.capped === 20,
      })
    },
  },
  {
    id: 'coupon-route',
    title: 'Add a feature following conventions',
    prompt:
      'Add an API route GET /api/coupons/[code] that returns the coupon with that code, or a 404 when there is none. ' +
      'Follow the conventions of the existing API routes.',
    check(dir) {
      const routeFile = join(dir, 'src/app/api/coupons/[code]/route.ts')
      const route = existsSync(routeFile) ? readFileSync(routeFile, 'utf-8') : ''
      let registered = false
      try {
        const cfg = JSON.parse(readFileSync(join(dir, 'config/routes.json'), 'utf-8'))
        registered = cfg.routes.some(r => r.path === '/api/coupons/[code]' && r.handler === 'src/app/api/coupons/[code]/route.ts')
      } catch { /* invalid JSON counts as not registered */ }
      return result({
        routeExists: route !== '',
        authenticated: /requireSession\(/.test(route),
        typecheck: tsc(dir).ok,
        registeredInRoutesJson: registered,
      })
    },
  },
  {
    id: 'impact-question',
    title: 'Answer an impact question',
    prompt:
      'Without modifying any file: list every source file that directly imports src/lib/auth/session.ts. ' +
      'Answer with one path per line, relative to the project root, and nothing else.',
    check(dir, templateDir, answer) {
      const truth = sessionImporters(templateDir)
      const listed = [...new Set((answer.match(/src\/[\w\-./()[\]]+\.tsx?/g) ?? []))]
      const found = listed.filter(f => truth.includes(f))
      const recall = found.length / truth.length
      const precision = listed.length === 0 ? 0 : found.length / listed.length
      return {
        pass: recall === 1 && precision >= 0.9 && gitChanged(dir).length === 0,
        details: { recall: Number(recall.toFixed(2)), precision: Number(precision.toFixed(2)), expected: truth.length, listed: listed.length, untouched: gitChanged(dir).length === 0 },
      }
    },
  },
]
