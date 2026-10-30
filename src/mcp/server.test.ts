import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface RpcResponse {
  id: number | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** Spawn the built CLI in MCP mode, send messages, collect one response per expected id. */
function exchange(messages: string[], expected: number): Promise<{ responses: RpcResponse[]; stderr: string }> {
  const root = mkdtempSync(join(tmpdir(), 'aidoc-mcp-e2e-'))
  writeFileSync(join(root, 'index.ts'), 'export const a = 1\n')
  const child = spawn(process.execPath, [join(__dirname, '..', 'cli.js'), 'mcp', '--path', root], { stdio: 'pipe' })
  let stdout = ''
  let stderr = ''
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout; stdout=${stdout} stderr=${stderr}`)) }, 10000)
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
      const lines = stdout.split('\n').filter(Boolean)
      if (lines.length >= expected) {
        clearTimeout(timer)
        child.stdin.end()
        child.on('close', () => resolvePromise({ responses: lines.map(l => JSON.parse(l) as RpcResponse), stderr }))
      }
    })
    for (const m of messages) child.stdin.write(m + '\n')
  })
}

test('mcp server: initialize, tools/list and tools/call over stdio', async () => {
  const { responses, stderr } = await exchange([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_symbol', arguments: { name: 'a' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_chunk', arguments: { path: '../x' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'nope' }),
    '{not json',
    JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }),
  ], 7)

  const byId = new Map(responses.map(r => [r.id, r]))
  const init = byId.get(1)?.result
  assert.equal(init?.protocolVersion, '2025-06-18')
  assert.deepEqual((init?.serverInfo as { name: string }).name, 'aidoc-kit')

  const tools = (byId.get(2)?.result?.tools as { name: string }[]).map(t => t.name)
  assert.ok(tools.includes('context_for_edit'))

  const status = byId.get(3)?.result as { content: { text: string }[]; isError: boolean }
  assert.equal(status.isError, false)
  assert.match(status.content[0].text, /No CodeGraph index/)

  const refused = byId.get(4)?.result as { content: { text: string }[]; isError: boolean }
  assert.equal(refused.isError, true)
  assert.match(refused.content[0].text, /outside the project root/)

  assert.equal(byId.get(5)?.error?.code, -32601)
  assert.equal(byId.get(null)?.error?.code, -32700)
  assert.deepEqual(byId.get(6)?.result, {})
  assert.match(stderr, /serving/)
})

test('mcp server: unknown protocol version falls back to the newest supported one', async () => {
  const { responses } = await exchange([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }),
  ], 1)
  assert.equal(responses[0].result?.protocolVersion, '2025-11-25')
})
