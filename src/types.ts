import type * as ts from 'typescript'

// ─── Core doc block ────────────────────────────────────────────────────────

export interface AiDocBlock {
  /** Relative path from project root */
  file: string
  /** @ai-agent */
  agent: string
  /** @ai-agents-related — comma-separated agent names */
  related: string[]
  /** @ai-runtime — e.g. "CLIENT UNIQUEMENT", "SERVER UNIQUEMENT", "UNIVERSEL" */
  runtime: string
  /** @ai-context — free-form description */
  context: string
  /** @ai-when-modifying — ordered rules */
  whenModifying: string[]
  /** @ai-cascade — files affected when this one changes */
  cascade: string[]
  /** @ai-validate — command to run after edits */
  validate: string
  /** @ai-never — hard prohibitions */
  neverDo: string[]
  /** @ai-pattern — embedded code snippets */
  patterns: string[]
}

// ─── Transformation rule ───────────────────────────────────────────────────

export interface Rule {
  name: string
  description?: string
  match: (node: ts.Node, sourceFile: ts.SourceFile) => boolean
  replace: (node: ts.Node, sourceFile: ts.SourceFile) => string | null
}

// ─── Scan result ───────────────────────────────────────────────────────────

export interface ScanResult {
  /** Files that already have @ai-* blocks */
  docs: AiDocBlock[]
  /** Relative paths of files without any @ai-* block */
  filesWithoutDocs: string[]
  totalScanned: number
}

// ─── Project config (aidoc.config.js / aidoc.config.json) ─────────────────

export interface AidocConfig {
  /**
   * Custom import-substring → agent-name mappings.
   * Checked before built-in rules.
   * @example { '@/lib/permissions': 'permissions-expert', 'stripe': 'billing-expert' }
   */
  agents?: Record<string, string>
  /**
   * Glob-style patterns for files to ignore during scan.
   * Supports prefix patterns (`src/generated/`), suffix patterns (`*.test.ts`)
   * and exact relative paths.
   * @example ['src/generated/', '*.test.ts', 'src/foo/bar.ts']
   */
  ignore?: string[]
  /**
   * Default @ai-validate command written into generated blocks.
   * @default 'npm run typecheck'
   */
  validate?: string
  /**
   * Default LLM provider config for `aidoc-kit enrich`.
   * All fields can be overridden by CLI flags.
   * Never hardcode API keys — use process.env.
   * @example { provider: 'gemini', model: 'gemini-2.0-flash', key: process.env.GEMINI_API_KEY }
   */
  enrich?: {
    provider?: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'ollama'
    model?: string
    key?: string
    /** Custom Ollama host. @default 'http://localhost:11434' */
    host?: string
  }
}

// ─── Knowledge base ────────────────────────────────────────────────────────

export interface KnowledgeBase {
  generatedAt: string
  agents: Record<string, {
    owns: string[]
    consultedBy: string[]
  }>
  cascadeGraph: Record<string, string[]>
  runtimeMap: Record<string, string[]>
  validationCommands: Record<string, string[]>
}
