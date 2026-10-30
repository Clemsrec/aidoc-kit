import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { ToolInputError, callTool, isKnownTool, toolDefinitions } from './tools'

// Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0, tools only.
// Implemented by hand to keep aidoc-kit free of runtime dependencies.

/** Newest first; the first one is answered when the client asks for an unknown version. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const MAX_MESSAGE_BYTES = 1024 * 1024

const INSTRUCTIONS =
  'aidoc-kit indexes this codebase. To locate code or follow a flow, call find_symbol and trace ' +
  'before Grep: one call replaces several searches. All tools are read-only.'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') return false
  const id = value.id
  return id === undefined || id === null || typeof id === 'string' || typeof id === 'number'
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
}

export interface McpServerOptions {
  projectRoot: string
  version: string
  input?: Readable
  output?: Writable
  /** Expose every tool instead of the default four. */
  allTools?: boolean
  /** Diagnostics only; never receives tool arguments or file contents. */
  log?: (message: string) => void
}

export function handleRequest(req: JsonRpcRequest, opts: Pick<McpServerOptions, 'projectRoot' | 'version' | 'allTools'>): unknown {
  const params = req.params === undefined ? {} : req.params
  if (!isRecord(params)) throw new RpcError(INVALID_PARAMS, 'params must be an object')

  switch (req.method) {
    case 'initialize': {
      const requested = params.protocolVersion
      const protocolVersion = typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0]
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'aidoc-kit', version: opts.version },
        instructions: INSTRUCTIONS,
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: toolDefinitions(opts.allTools ?? false) }
    case 'tools/call': {
      const { name } = params
      const args = params.arguments === undefined ? {} : params.arguments
      if (typeof name !== 'string' || !isKnownTool(name) || !toolDefinitions(opts.allTools ?? false).some(t => t.name === name)) {
        throw new RpcError(INVALID_PARAMS, `Unknown tool: ${String(name)}`)
      }
      if (!isRecord(args)) throw new RpcError(INVALID_PARAMS, 'arguments must be an object')
      try {
        return { content: [{ type: 'text', text: callTool(opts.projectRoot, name, args) }], isError: false }
      } catch (err: unknown) {
        // Tool-level failures are reported to the model, which can fix its call.
        if (err instanceof ToolInputError) return { content: [{ type: 'text', text: err.message }], isError: true }
        throw err
      }
    }
    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${req.method}`)
  }
}

/** Serve MCP on stdin/stdout until the input stream closes. */
export function runMcpServer(options: McpServerOptions): Promise<void> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const log = options.log ?? ((m: string) => process.stderr.write(`[aidoc-kit mcp] ${m}\n`))

  const send = (message: unknown): void => {
    output.write(JSON.stringify(message) + '\n')
  }
  const sendError = (id: JsonRpcId, code: number, message: string): void => {
    send({ jsonrpc: '2.0', id, error: { code, message } })
  }

  const rl = createInterface({ input, crlfDelay: Infinity })
  rl.on('line', line => {
    if (line.trim() === '') return
    if (Buffer.byteLength(line, 'utf-8') > MAX_MESSAGE_BYTES) {
      sendError(null, INVALID_REQUEST, 'Message too large')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      sendError(null, PARSE_ERROR, 'Parse error')
      return
    }
    if (!isRequest(parsed)) {
      const id = isRecord(parsed) && (typeof parsed.id === 'string' || typeof parsed.id === 'number') ? parsed.id : null
      // Responses from the client (no method) need no answer.
      if (isRecord(parsed) && parsed.method === undefined && ('result' in parsed || 'error' in parsed)) return
      sendError(id, INVALID_REQUEST, 'Invalid request')
      return
    }
    const isNotification = parsed.id === undefined
    try {
      const result = handleRequest(parsed, options)
      if (!isNotification) send({ jsonrpc: '2.0', id: parsed.id, result })
    } catch (err: unknown) {
      if (isNotification) return
      if (err instanceof RpcError) {
        sendError(parsed.id ?? null, err.code, err.message)
      } else {
        log(`internal error on ${parsed.method}: ${err instanceof Error ? err.message : String(err)}`)
        sendError(parsed.id ?? null, INTERNAL_ERROR, 'Internal error')
      }
    }
  })

  return new Promise(resolvePromise => {
    rl.on('close', () => resolvePromise())
  })
}
