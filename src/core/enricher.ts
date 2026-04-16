/**
 * @ai-agent general-expert
 * @ai-runtime UNIVERSEL
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : Provider, EnrichOptions, buildPrompt, resolveModel, callLLM, readSourceLines
 * Importé dans : src/cli.ts
 *
 * @ai-when-modifying
 * 1. Vérifier les fichiers en cascade ci-dessous avant de modifier
 * 2. Après modification, indiquer au développeur de lancer @ai-validate
 * 3. Si tu n'as pas accès au terminal, signaler la commande à exécuter
 *
 * @ai-cascade
 * - src/cli.ts
 *
 * @ai-validate
 * npm run typecheck
 */
import { readFileSync } from 'node:fs'

// ─── Types ─────────────────────────────────────────────────────────────────

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'ollama'

export interface EnrichOptions {
  provider: Provider
  /** Model name. If omitted, resolved dynamically via resolveModel(). */
  model?: string
  apiKey?: string
  /** Custom base URL for Ollama (default: http://localhost:11434) */
  host?: string
  dryRun: boolean
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Build the LLM prompt for a given file.
 * Prompt is in English to maximise quality across all models.
 */
export function buildPrompt(
  filePath: string,
  exportNames: string[],
  importedBy: string[],
  sourceLines: string[],
): string {
  const first50 = sourceLines.slice(0, 50).join('\n')
  const exportsStr = exportNames.length > 0 ? exportNames.join(', ') : '(none detected)'
  const importedByStr = importedBy.length > 0 ? importedBy.join(', ') : '(none detected)'

  return [
    'You are a code documentation expert.',
    'Analyze this TypeScript/JavaScript file and write a SHORT description (2-3 lines max)',
    'of what this file does, its role in the application, and what it exposes.',
    'Reply ONLY with the description. No introduction, no conclusion, no markdown.',
    '',
    `File: ${filePath}`,
    `Exports: ${exportsStr}`,
    `Imported by: ${importedByStr}`,
    'First 50 lines:',
    first50,
  ].join('\n')
}

/**
 * Resolve the best available model for a provider.
 * - User-specified model always wins.
 * - Anthropic: queries /v1/models, picks the latest haiku variant.
 * - Gemini: queries /v1beta/models, picks the latest flash variant.
 * - Others: returns a safe static default.
 * Falls back to static defaults silently on any network error.
 */
// ─── Provider docs URLs (used in error messages) ──────────────────────────

const DOCS_URLS: Record<Provider, string> = {
  openai:    'https://platform.openai.com/docs/models',
  anthropic: 'https://docs.anthropic.com/models',
  gemini:    'https://ai.google.dev/gemini-api/docs/models',
  groq:      'https://console.groq.com/docs/models',
  mistral:   'https://docs.mistral.ai/getting-started/models',
  ollama:    'https://ollama.com/library  (run: ollama list)',
}

export async function resolveModel(
  provider: Provider,
  apiKey: string,
  userModel?: string,
): Promise<string> {
  // 1. User-specified model always wins
  if (userModel) return userModel

  // 2. Dynamic resolution via provider API (anthropic + gemini)
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (res.ok) {
        const data = await res.json() as { data?: Array<{ id: string }> }
        const found = data.data?.find(m => m.id.includes('haiku'))?.id
          ?? data.data?.[0]?.id
        if (found) {
          console.log(`🤖 Modèle résolu dynamiquement : ${found}`)
          return found
        }
      }
    }

    if (provider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      )
      if (res.ok) {
        const data = await res.json() as { models?: Array<{ name: string }> }
        const found = data.models
          ?.find(m => m.name.includes('flash') && m.name.includes('generateContent'))
          ?.name.replace('models/', '')
          ?? data.models?.[0]?.name.replace('models/', '')
        if (found) {
          console.log(`🤖 Modèle résolu dynamiquement : ${found}`)
          return found
        }
      }
    }
  } catch {
    // API unavailable — fall through to explicit error
  }

  // 3. No fallback — fail loud
  throw new Error(
    `\nAucun modèle configuré pour le provider "${provider}".\n` +
    `\nAjoute \`model\` dans aidoc.config.ts ou passe --model en argument :\n` +
    `\n  enrich: {\n    provider: '${provider}',\n    model: '...',   // consulter les modèles disponibles\n  }\n` +
    `\nModèles disponibles : ${DOCS_URLS[provider]}\n`,
  )
}

/**
 * Route the prompt to the correct LLM provider.
 */
export async function callLLM(prompt: string, options: EnrichOptions): Promise<string> {
  const { provider, apiKey, host } = options
  const model = options.model ?? await resolveModel(provider, apiKey ?? '')

  switch (provider) {
    case 'openai':  return callOpenAI(prompt, model, requireKey(provider, apiKey))
    case 'anthropic': return callAnthropic(prompt, model, requireKey(provider, apiKey))
    case 'gemini':  return callGemini(prompt, model, requireKey(provider, apiKey))
    case 'groq':    return callGroq(prompt, model, requireKey(provider, apiKey))
    case 'mistral': return callMistral(prompt, model, requireKey(provider, apiKey))
    case 'ollama':  return callOllama(prompt, model, host ?? 'http://localhost:11434')
    default: throw new Error(`Unknown provider: ${provider as string}`)
  }
}

// ─── Provider implementations ──────────────────────────────────────────────

async function callOpenAI(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    }),
  }, 'OpenAI')

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message: string }
  }
  if (json.error) throw new Error(`OpenAI error: ${json.error.message}`)
  return json.choices?.[0]?.message?.content?.trim() ?? ''
}

async function callAnthropic(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, 'Anthropic')

  const json = await res.json() as {
    content?: Array<{ type: string; text?: string }>
    error?: { message: string }
  }
  if (json.error) throw new Error(`Anthropic error: ${json.error.message}`)
  const block = json.content?.find(b => b.type === 'text')
  return block?.text?.trim() ?? ''
}

async function callGemini(prompt: string, model: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 200 },
    }),
  }, 'Gemini')

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message: string }
  }
  if (json.error) throw new Error(`Gemini error: ${json.error.message}`)
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function callGroq(prompt: string, model: string, apiKey: string): Promise<string> {
  // Groq uses the same API shape as OpenAI
  const res = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    }),
  }, 'Groq')

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message: string }
  }
  if (json.error) throw new Error(`Groq error: ${json.error.message}`)
  return json.choices?.[0]?.message?.content?.trim() ?? ''
}

async function callMistral(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetchWithRetry('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    }),
  }, 'Mistral')

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message: string }
  }
  if (json.error) throw new Error(`Mistral error: ${json.error.message}`)
  return json.choices?.[0]?.message?.content?.trim() ?? ''
}

async function callOllama(prompt: string, model: string, host: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    })
  } catch {
    throw new Error(`Ollama not running. Start with: ollama serve\n  (tried ${host})`)
  }

  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
  }

  const json = await res.json() as { response?: string; error?: string }
  if (json.error) throw new Error(`Ollama error: ${json.error}`)
  return json.response?.trim() ?? ''
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireKey(provider: string, apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider}. Use --key YOUR_KEY or set it in aidoc.config.js (enrich.key).`,
    )
  }
  return apiKey
}

/**
 * Fetch with a single auto-retry on 429 (rate limit), after a 2s delay.
 * Throws a descriptive error on network failures.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  providerName: string,
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error(`Cannot reach ${providerName} API. Check your connection.`)
  }

  if (res.status === 429) {
    // Rate limit — wait 2s and retry once
    await new Promise(r => setTimeout(r, 2000))
    try {
      res = await fetch(url, init)
    } catch {
      throw new Error(`Cannot reach ${providerName} API. Check your connection.`)
    }
  }

  return res
}

// ─── Source preview helper ─────────────────────────────────────────────────

export function readSourceLines(filePath: string): string[] {
  try {
    return readFileSync(filePath, 'utf-8').split('\n')
  } catch {
    return []
  }
}
