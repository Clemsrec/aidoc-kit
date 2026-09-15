import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferRole, inferTags, computeCriticality, criticalityLevel } from './basicEnricher'

test('inferRole: explicit directives win over everything', () => {
  assert.equal(inferRole('app/page.tsx', `'use client'\nexport default function P() {}`).role, 'client')
  assert.equal(inferRole('components/Foo.tsx', `"use server"\nexport async function act() {}`).role, 'server')
})

test('inferRole: App Router entry files are server by default (RSC)', () => {
  for (const file of [
    'app/page.tsx',
    'src/app/layout.tsx',
    'src/app/(legal)/mentions/page.tsx',
    'app/sitemap.ts',
    'app/robots.ts',
    'app/opengraph-image.tsx',
    'app/blog/[slug]/route.ts',
  ]) {
    const { role, reason } = inferRole(file, 'export default function X() {}')
    assert.equal(role, 'server', `${file} should be server (got ${role})`)
    assert.match(reason, /RSC default/)
  }
})

test('inferRole: shared components under app/ stay universal without a signal', () => {
  assert.equal(inferRole('src/app/SearchBar.tsx', 'export function SearchBar() {}').role, 'universal')
})

test('inferRole: server paths and content heuristics', () => {
  assert.equal(inferRole('src/app/api/auth/route.ts', '').role, 'server')
  assert.equal(inferRole('lib/db.ts', `import admin from 'firebase-admin'`).role, 'server')
  assert.equal(inferRole('lib/mail.server.ts', '').role, 'server')
  assert.equal(inferRole('components/Counter.tsx', 'const [n, setN] = useState(0)').role, 'client')
  assert.equal(inferRole('lib/utils.ts', 'export const x = 1').role, 'universal')
})

test('criticality: fan-in cap and sensitive-domain bonuses', () => {
  assert.equal(computeCriticality(0, []), 0)
  assert.equal(computeCriticality(20, []), 60)
  assert.equal(computeCriticality(5, ['auth']), 55)
  assert.equal(computeCriticality(10, ['api', 'billing']), 100)
  assert.equal(criticalityLevel(55), 'high')
  assert.equal(criticalityLevel(80), 'critical')
  assert.deepEqual(inferTags('app/api/billing/route.ts'), ['api', 'billing'])
})
