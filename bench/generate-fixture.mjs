#!/usr/bin/env node
// Generates "shopfront", a Next.js App Router style shop used as the benchmark
// target. Deterministic: the same command always produces the same project.
// Usage: node bench/generate-fixture.mjs <outDir>

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const out = process.argv[2]
if (!out) {
  console.error('Usage: node bench/generate-fixture.mjs <outDir>')
  process.exit(1)
}

const files = new Map()
const put = (path, content) => files.set(path, content.replace(/^\n/, ''))

const cap = s => s[0].toUpperCase() + s.slice(1)

// name, plural, money field, owned by a customer, extra fields
const ENTITIES = [
  { name: 'product', plural: 'products', money: 'price', owned: false, fields: { title: 'string', sku: 'string', stock: 'number', categoryId: 'string' } },
  { name: 'category', plural: 'categories', money: null, owned: false, fields: { label: 'string', slug: 'string', parentId: 'string | null' } },
  { name: 'cart', plural: 'carts', money: 'subtotal', owned: true, fields: { itemCount: 'number', updatedAt: 'string' } },
  { name: 'order', plural: 'orders', money: 'total', owned: true, fields: { status: "'pending' | 'paid' | 'shipped' | 'cancelled'", placedAt: 'string' } },
  { name: 'invoice', plural: 'invoices', money: 'amount', owned: true, fields: { orderId: 'string', number: 'string', issuedAt: 'string' } },
  { name: 'customer', plural: 'customers', money: null, owned: false, fields: { email: 'string', displayName: 'string', marketingOptIn: 'boolean' } },
  { name: 'coupon', plural: 'coupons', money: 'discount', owned: false, fields: { code: 'string', expiresAt: 'string', maxUses: 'number' } },
  { name: 'review', plural: 'reviews', money: null, owned: true, fields: { productId: 'string', rating: 'number', body: 'string' } },
  { name: 'shipment', plural: 'shipments', money: 'cost', owned: true, fields: { orderId: 'string', carrier: 'string', trackingNumber: 'string' } },
  { name: 'refund', plural: 'refunds', money: 'amount', owned: true, fields: { orderId: 'string', reason: 'string', approved: 'boolean' } },
  { name: 'notification', plural: 'notifications', money: null, owned: true, fields: { channel: "'email' | 'sms'", subject: 'string', read: 'boolean' } },
  { name: 'wishlist', plural: 'wishlists', money: null, owned: true, fields: { productIds: 'string[]', shared: 'boolean' } },
]

// Services that read the session themselves instead of receiving it.
const DIRECT_SESSION_SERVICES = new Set(['wishlist', 'review', 'notification'])

// ─── Project root ──────────────────────────────────────────────────────────

put('package.json', JSON.stringify({
  name: 'shopfront',
  private: true,
  version: '0.1.0',
  scripts: {
    dev: 'next dev',
    build: 'next build',
    typecheck: 'tsc --noEmit',
    audit: 'node scripts/audit-files.mjs',
  },
}, null, 2) + '\n')

put('tsconfig.json', JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM'],
    module: 'commonjs',
    moduleResolution: 'node',
    strict: true,
    jsx: 'preserve',
    baseUrl: '.',
    paths: { '@/*': ['./src/*'] },
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src/**/*'],
}, null, 2) + '\n')

put('.gitignore', 'node_modules\n.next\n.codegraph\n.codemod\n')

put('CLAUDE.md', `
# shopfront

Online shop built with the Next.js App Router (route handlers in \`src/app/api\`,
pages in \`src/app/(shop)\`). Business logic lives in \`src/lib/<domain>/\`.

- Typecheck: \`npx tsc --noEmit\`
- File audit (CI): \`npm run audit\`
- Imports use the \`@/\` alias for \`src/\`.
`)

put('docs/ARCHITECTURE.md', `
# Architecture

- Money is always handled through \`src/lib/money.ts\` (integer cents, never floats).
- Every API route authenticates with \`requireSession\` from \`src/lib/auth/session.ts\`.
- Payments go through \`src/lib/payments/stripe.ts\`; the platform keeps a fee on
  each payment, computed by \`computeApplicationFee\`.
- API routes are declared in \`config/routes.json\`, which the gateway reads at deploy time.
`)

put('config/feature-flags.json', JSON.stringify({
  reviews: true,
  wishlistSharing: false,
  smsNotifications: true,
  newCheckout: false,
}, null, 2) + '\n')

const routes = ENTITIES.map(e => ({
  path: `/api/${e.plural}`,
  methods: ['GET', 'POST'],
  handler: `src/app/api/${e.plural}/route.ts`,
  auth: true,
}))
routes.push({ path: '/api/orders/[id]', methods: ['GET'], handler: 'src/app/api/orders/[id]/route.ts', auth: true })
routes.push({ path: '/api/payments/webhook', methods: ['POST'], handler: 'src/app/api/payments/webhook/route.ts', auth: false })
put('config/routes.json', JSON.stringify({ guard: 'src/lib/auth/session.ts', routes }, null, 2) + '\n')

put('config/audit.json', JSON.stringify({
  description: 'Files holding money or auth logic. CI fails if one disappears or stops exporting.',
  files: [
    'src/lib/money.ts',
    'src/lib/auth/session.ts',
    'src/lib/payments/stripe.ts',
    'src/lib/order/service.ts',
    'src/lib/refund/service.ts',
  ],
}, null, 2) + '\n')

put('scripts/audit-files.mjs', `
#!/usr/bin/env node
// CI guard: every audited file must exist and export something.
import { existsSync, readFileSync } from 'node:fs'

const { files } = JSON.parse(readFileSync('config/audit.json', 'utf-8'))
let failed = 0
for (const file of files) {
  if (!existsSync(file)) {
    console.error(\`audit: missing \${file}\`)
    failed++
  } else if (!/\\bexport\\b/.test(readFileSync(file, 'utf-8'))) {
    console.error(\`audit: \${file} exports nothing\`)
    failed++
  }
}
if (failed > 0) process.exit(1)
console.log(\`audit: \${files.length} file(s) ok\`)
`)

// ─── Ambient types (no node_modules in the fixture) ────────────────────────

put('src/types/jsx.d.ts', `
declare namespace JSX {
  type Element = { type: unknown; props: Record<string, unknown> }
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>
  }
  interface ElementChildrenAttribute {
    children: unknown
  }
  interface IntrinsicAttributes {
    key?: string | number
  }
}
`)

// ─── Core libraries ────────────────────────────────────────────────────────

put('src/lib/money.ts', `
export type Currency = 'EUR' | 'USD'

/** Amounts are integer cents. Never store money as a float. */
export interface Money {
  cents: number
  currency: Currency
}

export function money(cents: number, currency: Currency = 'EUR'): Money {
  if (!Number.isInteger(cents)) throw new Error(\`money: \${cents} is not an integer amount of cents\`)
  return { cents, currency }
}

export function zero(currency: Currency = 'EUR'): Money {
  return { cents: 0, currency }
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error('addMoney: currency mismatch')
  return { cents: a.cents + b.cents, currency: a.currency }
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error('subtractMoney: currency mismatch')
  return { cents: a.cents - b.cents, currency: a.currency }
}

export function multiplyMoney(a: Money, factor: number): Money {
  return { cents: Math.round(a.cents * factor), currency: a.currency }
}

export function sumMoney(items: Money[], currency: Currency = 'EUR'): Money {
  return items.reduce(addMoney, zero(currency))
}

export function formatMoney(m: Money, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.cents / 100)
}
`)

put('src/lib/logger.ts', `
type Level = 'debug' | 'info' | 'warn' | 'error'

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, message, ...meta, at: new Date().toISOString() })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => write('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
}
`)

put('src/lib/db.ts', `
export interface Row {
  id: string
}

export interface Table<T extends Row> {
  all(): T[]
  find(id: string): T | undefined
  where(predicate: (row: T) => boolean): T[]
  insert(row: T): T
  update(id: string, patch: Partial<T>): T | undefined
  remove(id: string): boolean
}

const store = new Map<string, Map<string, Row>>()

export function table<T extends Row>(name: string): Table<T> {
  if (!store.has(name)) store.set(name, new Map())
  const rows = store.get(name) as Map<string, T>
  return {
    all: () => [...rows.values()],
    find: id => rows.get(id),
    where: predicate => [...rows.values()].filter(predicate),
    insert: row => { rows.set(row.id, row); return row },
    update: (id, patch) => {
      const current = rows.get(id)
      if (!current) return undefined
      const next = { ...current, ...patch }
      rows.set(id, next)
      return next
    },
    remove: id => rows.delete(id),
  }
}

let counter = 0
export function newId(prefix: string): string {
  counter++
  return \`\${prefix}_\${Date.now().toString(36)}\${counter}\`
}
`)

put('src/lib/http.ts', `
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400)
}

export function unauthorized(): Response {
  return json({ error: 'unauthorized' }, 401)
}

export function notFound(what: string): Response {
  return json({ error: \`\${what} not found\` }, 404)
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
`)

put('src/lib/store.ts', `
type Listener<T> = (value: T) => void

export interface Store<T> {
  get(): T
  set(value: T): void
  subscribe(listener: Listener<T>): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<Listener<T>>()
  return {
    get: () => value,
    set: next => { value = next; listeners.forEach(l => l(next)) },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  }
}
`)

put('src/lib/auth/roles.ts', `
export type Role = 'customer' | 'staff' | 'admin'

const RANK: Record<Role, number> = { customer: 0, staff: 1, admin: 2 }

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required]
}
`)

put('src/lib/auth/session.ts', `
import { hasRole, type Role } from './roles'

export interface Session {
  userId: string
  role: Role
  expiresAt: number
}

export class AuthError extends Error {
  constructor(readonly reason: 'missing session' | 'expired' | 'forbidden') {
    super(\`auth: \${reason}\`)
  }
}

const COOKIE = 'sf_session'

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function decode(token: string): Session {
  const [userId, role, expiresAt] = Buffer.from(token, 'base64').toString('utf-8').split(':')
  return { userId, role: role as Role, expiresAt: Number(expiresAt) }
}

/** Session of the current request. Throws AuthError when there is none. */
export function getSession(req: Request): Session {
  const token = readCookie(req, COOKIE)
  if (!token) throw new AuthError('missing session')
  const session = decode(token)
  if (session.expiresAt < Date.now()) throw new AuthError('expired')
  return session
}

/** Session with at least the given role, for API routes. */
export function requireSession(req: Request, role: Role = 'customer'): Session {
  const session = getSession(req)
  if (!hasRole(session.role, role)) throw new AuthError('forbidden')
  return session
}

export function encodeSession(session: Session): string {
  return Buffer.from(\`\${session.userId}:\${session.role}:\${session.expiresAt}\`).toString('base64')
}
`)

put('src/middleware.ts', `
import { getSession, AuthError } from '@/lib/auth/session'

const PUBLIC_PREFIXES = ['/api/payments/webhook', '/login', '/']

export function middleware(req: Request): Response | undefined {
  const { pathname } = new URL(req.url)
  if (PUBLIC_PREFIXES.some(p => p === pathname || (p !== '/' && pathname.startsWith(p)))) return undefined
  try {
    const session = getSession(req)
    if (pathname.startsWith('/admin') && session.role === 'customer') {
      return Response.redirect(new URL('/', req.url))
    }
    return undefined
  } catch (err) {
    if (err instanceof AuthError) return Response.redirect(new URL('/login', req.url))
    throw err
  }
}
`)

// ─── Payments: one large file ──────────────────────────────────────────────

const webhookCases = [
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
  'invoice.paid', 'invoice.payment_failed', 'customer.created', 'customer.deleted',
  'payout.paid', 'payout.failed',
].map(type => `    case '${type}':
      logger.info('stripe webhook', { type: event.type, id: event.id })
      handled.push(event.type)
      return { handled: true, type: event.type }`).join('\n')

put('src/lib/payments/stripe.ts', `
import { money, multiplyMoney, subtractMoney, type Money } from '@/lib/money'
import { logger } from '@/lib/logger'

// Thin wrapper around the payment provider. The real HTTP client is injected
// in production; tests and local dev use the in-memory fake below.

export interface PaymentIntent {
  id: string
  amount: Money
  applicationFee: Money
  status: 'requires_payment' | 'processing' | 'succeeded' | 'canceled'
  customerId: string
  createdAt: number
  metadata: Record<string, string>
}

export interface RefundResult {
  id: string
  intentId: string
  amount: Money
  status: 'pending' | 'succeeded' | 'failed'
}

export interface WebhookEvent {
  id: string
  type: string
  data: Record<string, unknown>
}

export interface PaymentClient {
  createIntent(input: { amount: Money; fee: Money; customerId: string; metadata: Record<string, string> }): Promise<PaymentIntent>
  capture(intentId: string): Promise<PaymentIntent>
  cancel(intentId: string): Promise<PaymentIntent>
  refund(intentId: string, amount: Money): Promise<RefundResult>
}

/** Platform fee rate, in percent of the payment amount. */
export const PLATFORM_FEE_PERCENT = 2.5
export const MIN_FEE_CENTS = 30
export const MAX_RETRIES = 3

/**
 * Fee kept by the platform on a payment: feePercent % of the amount,
 * never below MIN_FEE_CENTS and never above the amount itself.
 */
export function computeApplicationFee(amount: Money, feePercent: number = PLATFORM_FEE_PERCENT): Money {
  const raw = Math.round((amount.cents * feePercent) / 10)
  const bounded = Math.min(Math.max(raw, MIN_FEE_CENTS), amount.cents)
  return money(bounded, amount.currency)
}

/** What the merchant receives once the platform fee is deducted. */
export function netAmount(amount: Money, feePercent: number = PLATFORM_FEE_PERCENT): Money {
  return subtractMoney(amount, computeApplicationFee(amount, feePercent))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      logger.warn('stripe call failed', { label, attempt })
      await sleep(50 * attempt)
    }
  }
  throw lastError
}

// ─── In-memory fake ─────────────────────────────────────────────────────────

const intents = new Map<string, PaymentIntent>()
let sequence = 0

export const fakeClient: PaymentClient = {
  async createIntent({ amount, fee, customerId, metadata }) {
    sequence++
    const intent: PaymentIntent = {
      id: \`pi_\${sequence}\`,
      amount,
      applicationFee: fee,
      status: 'requires_payment',
      customerId,
      createdAt: Date.now(),
      metadata,
    }
    intents.set(intent.id, intent)
    return intent
  },
  async capture(intentId) {
    const intent = intents.get(intentId)
    if (!intent) throw new Error(\`unknown intent \${intentId}\`)
    intent.status = 'succeeded'
    return intent
  },
  async cancel(intentId) {
    const intent = intents.get(intentId)
    if (!intent) throw new Error(\`unknown intent \${intentId}\`)
    intent.status = 'canceled'
    return intent
  },
  async refund(intentId, amount) {
    const intent = intents.get(intentId)
    if (!intent) throw new Error(\`unknown intent \${intentId}\`)
    return { id: \`re_\${intentId}\`, intentId, amount, status: 'succeeded' }
  },
}

let client: PaymentClient = fakeClient

export function setPaymentClient(next: PaymentClient): void {
  client = next
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function createPayment(amount: Money, customerId: string, metadata: Record<string, string> = {}): Promise<PaymentIntent> {
  if (amount.cents <= 0) throw new Error('createPayment: amount must be positive')
  const fee = computeApplicationFee(amount)
  logger.info('creating payment', { customerId, cents: amount.cents, feeCents: fee.cents })
  return withRetries('createIntent', () => client.createIntent({ amount, fee, customerId, metadata }))
}

export async function capturePayment(intentId: string): Promise<PaymentIntent> {
  return withRetries('capture', () => client.capture(intentId))
}

export async function cancelPayment(intentId: string): Promise<PaymentIntent> {
  return withRetries('cancel', () => client.cancel(intentId))
}

export async function refundPayment(intentId: string, amount: Money): Promise<RefundResult> {
  if (amount.cents <= 0) throw new Error('refundPayment: amount must be positive')
  return withRetries('refund', () => client.refund(intentId, amount))
}

/** Partial refunds give back the fee pro rata. */
export function refundedFee(intent: PaymentIntent, refunded: Money): Money {
  if (intent.amount.cents === 0) return money(0, intent.amount.currency)
  return multiplyMoney(intent.applicationFee, refunded.cents / intent.amount.cents)
}

export function isFinal(intent: PaymentIntent): boolean {
  return intent.status === 'succeeded' || intent.status === 'canceled'
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  let hash = 0
  for (const ch of payload + secret) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return signature === \`v1=\${(hash >>> 0).toString(16)}\`
}

export function parseEvent(payload: string): WebhookEvent | null {
  try {
    const parsed = JSON.parse(payload) as Partial<WebhookEvent>
    if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') return null
    return { id: parsed.id, type: parsed.type, data: (parsed.data ?? {}) as Record<string, unknown> }
  } catch {
    return null
  }
}

const handled: string[] = []

export function handledEvents(): readonly string[] {
  return handled
}

export function handleWebhookEvent(event: WebhookEvent): { handled: boolean; type: string } {
  switch (event.type) {
${webhookCases}
    default:
      logger.debug('stripe webhook ignored', { type: event.type })
      return { handled: false, type: event.type }
  }
}
`)

put('src/app/api/payments/webhook/route.ts', `
import { handleWebhookEvent, parseEvent, verifySignature } from '@/lib/payments/stripe'
import { badRequest, json } from '@/lib/http'

export async function POST(req: Request): Promise<Response> {
  const payload = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''
  if (!verifySignature(payload, signature, process.env.STRIPE_WEBHOOK_SECRET ?? '')) return badRequest('bad signature')
  const event = parseEvent(payload)
  if (!event) return badRequest('bad payload')
  return json(handleWebhookEvent(event))
}
`)

// ─── Entities ──────────────────────────────────────────────────────────────

for (const e of ENTITIES) {
  const E = cap(e.name)
  const fieldLines = Object.entries(e.fields).map(([k, t]) => `  ${k}: ${t}`)
  if (e.money) fieldLines.push(`  ${e.money}: Money`)
  if (e.owned) fieldLines.push('  customerId: string')

  // Order is built in several places: give it its own type with line items.
  if (e.name === 'order') {
    put('src/types/order.ts', `
import type { Money } from '@/lib/money'

export interface OrderLine {
  productId: string
  quantity: number
  unitPrice: Money
}

export interface Order {
  id: string
  customerId: string
  lines: OrderLine[]
  total: Money
  status: 'pending' | 'paid' | 'shipped' | 'cancelled'
  placedAt: string
  paymentIntentId: string | null
}
`)
  } else {
    put(`src/types/${e.name}.ts`, `
${e.money ? "import type { Money } from '@/lib/money'\n\n" : ''}export interface ${E} {
  id: string
${fieldLines.join('\n')}
}
`)
  }

  put(`src/lib/${e.name}/repository.ts`, `
import { table, newId } from '@/lib/db'
import type { ${E} } from '@/types/${e.name}'

const ${e.plural} = table<${E}>('${e.plural}')

export function list${cap(e.plural)}(): ${E}[] {
  return ${e.plural}.all()
}

export function find${E}(id: string): ${E} | undefined {
  return ${e.plural}.find(id)
}
${e.owned ? `
export function list${cap(e.plural)}For(customerId: string): ${E}[] {
  return ${e.plural}.where(row => row.customerId === customerId)
}
` : ''}
export function save${E}(input: Omit<${E}, 'id'>): ${E} {
  return ${e.plural}.insert({ ...input, id: newId('${e.name.slice(0, 3)}') } as ${E})
}

export function update${E}(id: string, patch: Partial<${E}>): ${E} | undefined {
  return ${e.plural}.update(id, patch)
}

export function delete${E}(id: string): boolean {
  return ${e.plural}.remove(id)
}
`)

  const validatorChecks = Object.entries(e.fields)
    .filter(([, t]) => ['string', 'number', 'boolean'].includes(t))
    .map(([k, t]) => `  if (typeof input.${k} !== '${t}') return { ok: false, error: '${k} must be a ${t}' }`)
  put(`src/lib/${e.name}/validators.ts`, `
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ${E}Input {
${Object.entries(e.fields).map(([k, t]) => `  ${k}: ${t}`).join('\n')}${e.money ? `\n  ${e.money}Cents: number` : ''}
}

export function parse${E}Input(raw: unknown): Validation<${E}Input> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' }
  const input = raw as Record<string, unknown>
${validatorChecks.join('\n')}${e.money ? `\n  if (!Number.isInteger(input.${e.money}Cents) || (input.${e.money}Cents as number) < 0) return { ok: false, error: '${e.money}Cents must be a positive integer' }` : ''}
  return { ok: true, value: input as unknown as ${E}Input }
}
`)

  put(`src/lib/${e.name}/mappers.ts`, `
${e.money ? "import { formatMoney } from '@/lib/money'\n" : ''}import type { ${E} } from '@/types/${e.name}'

export interface ${E}Dto {
  id: string
${e.money ? `  ${e.money}Label: string\n` : ''}  raw: ${E}
}

export function to${E}Dto(${e.name}: ${E}): ${E}Dto {
  return {
    id: ${e.name}.id,
${e.money ? `    ${e.money}Label: formatMoney(${e.name}.${e.money}),\n` : ''}    raw: ${e.name},
  }
}
`)

  if (e.name === 'order') continue // hand-written below

  const directSession = DIRECT_SESSION_SERVICES.has(e.name)
  put(`src/lib/${e.name}/service.ts`, `
${directSession ? "import { getSession } from '@/lib/auth/session'\n" : ''}import { logger } from '@/lib/logger'
${e.money ? "import { money } from '@/lib/money'\n" : ''}import { find${E}, list${cap(e.plural)}${e.owned ? `, list${cap(e.plural)}For` : ''}, save${E} } from './repository'
import type { ${E}Input } from './validators'
import type { ${E} } from '@/types/${e.name}'

export function get${E}(id: string): ${E} | undefined {
  return find${E}(id)
}
${directSession ? `
/** ${cap(e.plural)} of the signed-in customer. */
export function my${cap(e.plural)}(req: Request): ${E}[] {
  const session = getSession(req)
  return list${cap(e.plural)}For(session.userId)
}
` : ''}
export function browse${cap(e.plural)}(${e.owned ? 'customerId?: string' : ''}): ${E}[] {
  return ${e.owned ? `customerId ? list${cap(e.plural)}For(customerId) : ` : ''}list${cap(e.plural)}()
}

export function create${E}(input: ${E}Input${e.owned ? ', customerId: string' : ''}): ${E} {
${e.money ? `  const { ${e.money}Cents, ...rest } = input\n  const created = save${E}({ ...rest, ${e.money}: money(${e.money}Cents)${e.owned ? ', customerId' : ''} })` : `  const created = save${E}({ ...input${e.owned ? ', customerId' : ''} })`}
  logger.info('${e.name} created', { id: created.id })
  return created
}
`)

  put(`src/app/api/${e.plural}/route.ts`, `
import { requireSession, AuthError } from '@/lib/auth/session'
import { badRequest, json, readJson, unauthorized } from '@/lib/http'
import { browse${cap(e.plural)}, create${E} } from '@/lib/${e.name}/service'
import { parse${E}Input } from '@/lib/${e.name}/validators'
import { to${E}Dto } from '@/lib/${e.name}/mappers'

export async function GET(req: Request): Promise<Response> {
  try {
    ${e.owned ? 'const session = requireSession(req)' : "requireSession(req)"}
    return json(browse${cap(e.plural)}(${e.owned ? 'session.userId' : ''}).map(to${E}Dto))
  } catch (err) {
    if (err instanceof AuthError) return unauthorized()
    throw err
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    ${e.owned ? 'const session = requireSession(req)' : "requireSession(req, 'staff')"}
    const parsed = parse${E}Input(await readJson(req))
    if (!parsed.ok) return badRequest(parsed.error)
    return json(to${E}Dto(create${E}(parsed.value${e.owned ? ', session.userId' : ''})), 201)
  } catch (err) {
    if (err instanceof AuthError) return unauthorized()
    throw err
  }
}
`)
}

// Order: the type is built in several places (service, cart checkout, fixtures).
put('src/lib/order/service.ts', `
import { logger } from '@/lib/logger'
import { addMoney, multiplyMoney, zero, type Money } from '@/lib/money'
import { createPayment } from '@/lib/payments/stripe'
import { findOrder, listOrders, listOrdersFor, saveOrder, updateOrder } from './repository'
import type { OrderInput } from './validators'
import type { Order, OrderLine } from '@/types/order'

export function getOrder(id: string): Order | undefined {
  return findOrder(id)
}

export function browseOrders(customerId?: string): Order[] {
  return customerId ? listOrdersFor(customerId) : listOrders()
}

export function orderTotal(lines: OrderLine[]): Money {
  return lines.reduce((sum, line) => addMoney(sum, multiplyMoney(line.unitPrice, line.quantity)), zero())
}

export function createOrder(input: OrderInput, customerId: string): Order {
  const order = saveOrder({
    customerId,
    lines: [],
    total: zero(),
    status: input.status,
    placedAt: input.placedAt,
    paymentIntentId: null,
  })
  logger.info('order created', { id: order.id })
  return order
}

export function orderFromLines(customerId: string, lines: OrderLine[]): Order {
  return saveOrder({
    customerId,
    lines,
    total: orderTotal(lines),
    status: 'pending',
    placedAt: new Date().toISOString(),
    paymentIntentId: null,
  })
}

export async function payOrder(order: Order): Promise<Order> {
  const intent = await createPayment(order.total, order.customerId, { orderId: order.id })
  return updateOrder(order.id, { paymentIntentId: intent.id, status: 'paid' }) ?? order
}
`)

put('src/lib/order/fixtures.ts', `
import { money } from '@/lib/money'
import type { Order } from '@/types/order'

export const SAMPLE_ORDERS: Order[] = [
  {
    id: 'ord_sample_1',
    customerId: 'cus_alice',
    lines: [{ productId: 'pro_mug', quantity: 2, unitPrice: money(1290) }],
    total: money(2580),
    status: 'paid',
    placedAt: '2026-09-01T10:00:00.000Z',
    paymentIntentId: 'pi_sample_1',
  },
  {
    id: 'ord_sample_2',
    customerId: 'cus_bob',
    lines: [{ productId: 'pro_tote', quantity: 1, unitPrice: money(2400) }],
    total: money(2400),
    status: 'pending',
    placedAt: '2026-09-03T15:30:00.000Z',
    paymentIntentId: null,
  },
]
`)

// Cart checkout builds an order from the cart lines.
put('src/lib/cart/checkout.ts', `
import { requireSession } from '@/lib/auth/session'
import { money } from '@/lib/money'
import { orderFromLines, payOrder } from '@/lib/order/service'
import type { Order, OrderLine } from '@/types/order'

export interface CheckoutLine {
  productId: string
  quantity: number
  unitPriceCents: number
}

export async function checkout(req: Request, lines: CheckoutLine[]): Promise<Order> {
  const session = requireSession(req)
  const orderLines: OrderLine[] = lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: money(l.unitPriceCents) }))
  const order = orderFromLines(session.userId, orderLines)
  return payOrder(order)
}

export function previewOrder(customerId: string, lines: CheckoutLine[]): Order {
  const orderLines: OrderLine[] = lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: money(l.unitPriceCents) }))
  const total = orderLines.reduce((cents, l) => cents + l.unitPrice.cents * l.quantity, 0)
  return {
    id: 'preview',
    customerId,
    lines: orderLines,
    total: money(total),
    status: 'pending',
    placedAt: new Date().toISOString(),
    paymentIntentId: null,
  }
}
`)

put('src/app/api/orders/route.ts', `
import { requireSession, AuthError } from '@/lib/auth/session'
import { badRequest, json, readJson, unauthorized } from '@/lib/http'
import { browseOrders, createOrder } from '@/lib/order/service'
import { parseOrderInput } from '@/lib/order/validators'
import { toOrderDto } from '@/lib/order/mappers'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = requireSession(req)
    return json(browseOrders(session.userId).map(toOrderDto))
  } catch (err) {
    if (err instanceof AuthError) return unauthorized()
    throw err
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = requireSession(req)
    const parsed = parseOrderInput(await readJson(req))
    if (!parsed.ok) return badRequest(parsed.error)
    return json(toOrderDto(createOrder(parsed.value, session.userId)), 201)
  } catch (err) {
    if (err instanceof AuthError) return unauthorized()
    throw err
  }
}
`)

put('src/app/api/orders/[id]/route.ts', `
import { requireSession, AuthError } from '@/lib/auth/session'
import { json, notFound, unauthorized } from '@/lib/http'
import { getOrder } from '@/lib/order/service'
import { toOrderDto } from '@/lib/order/mappers'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = requireSession(req)
    const order = getOrder(params.id)
    if (!order || (order.customerId !== session.userId && session.role === 'customer')) return notFound('order')
    return json(toOrderDto(order))
  } catch (err) {
    if (err instanceof AuthError) return unauthorized()
    throw err
  }
}
`)

// Refund service: money logic, audited.
put('src/lib/refund/service.ts', `
import { logger } from '@/lib/logger'
import { money, subtractMoney } from '@/lib/money'
import { refundPayment, refundedFee } from '@/lib/payments/stripe'
import { getOrder } from '@/lib/order/service'
import { findRefund, listRefunds, listRefundsFor, saveRefund, updateRefund } from './repository'
import type { RefundInput } from './validators'
import type { Refund } from '@/types/refund'

export function getRefund(id: string): Refund | undefined {
  return findRefund(id)
}

export function browseRefunds(customerId?: string): Refund[] {
  return customerId ? listRefundsFor(customerId) : listRefunds()
}

export function createRefund(input: RefundInput, customerId: string): Refund {
  const { amountCents, ...rest } = input
  const created = saveRefund({ ...rest, amount: money(amountCents), customerId })
  logger.info('refund created', { id: created.id })
  return created
}

export async function approveRefund(id: string): Promise<Refund | undefined> {
  const refund = findRefund(id)
  if (!refund) return undefined
  const order = getOrder(refund.orderId)
  if (!order?.paymentIntentId) throw new Error('approveRefund: order was never paid')
  if (subtractMoney(order.total, refund.amount).cents < 0) throw new Error('approveRefund: refund exceeds order total')
  await refundPayment(order.paymentIntentId, refund.amount)
  logger.info('refund approved', { id, feeBackCents: refundedFee({ id: order.paymentIntentId, amount: order.total, applicationFee: money(0), status: 'succeeded', customerId: order.customerId, createdAt: 0, metadata: {} }, refund.amount).cents })
  return updateRefund(id, { approved: true })
}
`)

// ─── UI: pages, components, hooks ──────────────────────────────────────────

for (const e of ENTITIES) {
  const E = cap(e.name)
  const moneyImport = e.money ? "import { formatMoney } from '@/lib/money'\n" : ''
  const label = Object.keys(e.fields)[0]

  put(`src/components/${e.name}/${E}Card.tsx`, `
${moneyImport}import type { ${E} } from '@/types/${e.name}'

export function ${E}Card({ ${e.name} }: { ${e.name}: ${E} }): JSX.Element {
  return (
    <article className="card" data-id={${e.name}.id}>
      <h3>{String(${e.name}.${e.name === 'order' ? 'status' : label})}</h3>
${e.money ? `      <p className="amount">{formatMoney(${e.name}.${e.money})}</p>\n` : ''}    </article>
  )
}
`)

  put(`src/components/${e.name}/${E}List.tsx`, `
import { ${E}Card } from './${E}Card'
import type { ${E} } from '@/types/${e.name}'

export function ${E}List({ items }: { items: ${E}[] }): JSX.Element {
  if (items.length === 0) return <p className="empty">No ${e.plural} yet.</p>
  return (
    <section className="list">
      {items.map(item => <${E}Card key={item.id} ${e.name}={item} />)}
    </section>
  )
}
`)

  put(`src/app/(shop)/${e.plural}/page.tsx`, `
import { browse${cap(e.plural)} } from '@/lib/${e.name}/service'
import { ${E}List } from '@/components/${e.name}/${E}List'

export const metadata = { title: '${cap(e.plural)}' }

export default function ${cap(e.plural)}Page(): JSX.Element {
  const items = browse${cap(e.plural)}()
  return (
    <main>
      <h1>${cap(e.plural)}</h1>
      <${E}List items={items} />
    </main>
  )
}
`)

  put(`src/hooks/use-${e.name}.ts`, `
'use client'

import { createStore } from '@/lib/store'
import type { ${E}Dto } from '@/lib/${e.name}/mappers'

const ${e.plural}Store = createStore<${E}Dto[]>([])

export async function refresh${cap(e.plural)}(): Promise<${E}Dto[]> {
  const res = await fetch('/api/${e.plural}', { credentials: 'include' })
  if (!res.ok) throw new Error(\`/api/${e.plural} answered \${res.status}\`)
  const items = (await res.json()) as ${E}Dto[]
  ${e.plural}Store.set(items)
  return items
}

export function use${cap(e.plural)}(): ${E}Dto[] {
  return ${e.plural}Store.get()
}
`)
}

put('src/app/(shop)/layout.tsx', `
export const metadata = { title: { default: 'Shopfront', template: '%s | Shopfront' } }

export default function ShopLayout({ children }: { children: unknown }): JSX.Element {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
`)

put('src/app/(shop)/page.tsx', `
import { browseProducts } from '@/lib/product/service'
import { ProductList } from '@/components/product/ProductList'

export default function HomePage(): JSX.Element {
  return (
    <main>
      <h1>Shopfront</h1>
      <ProductList items={browseProducts().slice(0, 8)} />
    </main>
  )
}
`)

// ─── Write ─────────────────────────────────────────────────────────────────

for (const [path, content] of files) {
  const full = join(out, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}
console.log(`shopfront: ${files.size} files written to ${out}`)
