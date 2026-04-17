# DESIGN.md — aidoc-kit AI Provider Architecture

## Problem
LLM model identifiers are ephemeral. A model hardcoded in config or docs
becomes deprecated within months. aidoc-kit must never suggest or hardcode
a specific model name.

## User Profiles

### 1. Direct API User
- Has an API key (Anthropic, OpenAI, Gemini…) in `.env` or `.env.local`
- Variable name may be non-standard (CLAUDE_API_KEY, MY_OPENAI_KEY…)
- aidoc-kit detects the provider and fetches available models dynamically

### 2. Copilot / VS Code Agent User
- No API key in the project
- Uses GitHub Copilot Chat or a VS Code AI agent
- aidoc-kit generates ready-to-use prompts to paste into chat

### 3. Manual / No AI User
- No LLM access
- aidoc-kit generates empty @ai-context skeletons to fill manually

## Init Flow

`npx aidoc-kit init` must ask:
  ? How do you use AI in this project?
    ▸ API key (Anthropic, OpenAI, Gemini...)
      GitHub Copilot / VS Code Agent
      No AI — manual mode

### Branch 1 — API Key
1. Scan .env, .env.local, .env.production for patterns:
   - *ANTHROPIC*, *CLAUDE* → provider: anthropic
   - *OPENAI*, *GPT*       → provider: openai
   - *GEMINI*, *GOOGLE*    → provider: google
2. Call provider's /models endpoint with the detected key
3. Display available models → user picks one
4. Write aidoc.config.ts with provider + keyEnv reference (never the key value)

```typescript
export default {
  enrich: {
    provider: 'anthropic',
    keyEnv: 'CLAUDE_API_KEY', // reference, not value
    // model: not set — resolved at runtime
  }
}
```

### Branch 2 — Copilot / Agent
1. Detect .vscode/ folder
2. Generate .aidoc/prompts/enrich.md with structured prompt template
3. `npx aidoc-kit inject --input output.md` injects results into files

### Branch 3 — Manual
1. Generate empty @ai-context skeletons in all target files
2. Add inline comments guiding the developer

## Model Resolution Strategy

Priority order:
1. --model flag (CLI override)
2. aidoc.config.ts → model field (if explicitly set)
3. Provider /models API → prompt user to select
4. Fallback: error with helpful message (no model suggestions)

Add `npx aidoc-kit models` command:
- Lists currently available models for the configured provider
- Flags deprecated models if the API returns deprecation info
- Suggests updating aidoc.config.ts if current model is deprecated

## Notifications & Error Messages

NEVER:
  ❌ Provider not set. Pass --provider or --model (claude-*, gpt-*, gemini-*)
  ❌ Suggested model: claude-haiku-20240307

ALWAYS:
  ✅ No provider configured. Run `npx aidoc-kit init` to set up your AI source.
  ✅ Run `npx aidoc-kit models` to see available models for your provider.
  ✅ Your configured model may be deprecated. Run `npx aidoc-kit models` to update.

## Future: VS Code Extension
When aidoc-kit has a VS Code extension:
- Branch 2 becomes fully automated via vscode.lm.selectChatModels()
- No key needed — same config file, different runtime resolver

## Principles
- Never suggest a model name in docs, errors, or generated config
- Never hardcode a provider's model list — always fetch live
- Support projects with zero AI setup via manual mode
- Degrade gracefully — if API call fails, fall back to prompt-export mode

---

## Agent Routing (VSCode Copilot)

@ai-agent tags are not metadata — they are active routing hints.

When an agent reads a file tagged with @ai-agent, the generated @ai-agent-hint
instructs it to recommend switching to a specialized Copilot agent if needed.

`npx aidoc-kit agents` generates instruction files for each detected agent type:

```
.github/
  copilot/
    firebase-expert.md   <- Firestore, Firebase Auth, Cloud Functions
    types-expert.md      <- TypeScript types, Zod schemas, type guards
    hooks-expert.md      <- React hooks, state management, side effects
    utils-expert.md      <- Pure utility functions, formatting, normalization
```

Each file is auto-generated from the @ai-agent tags found in the project.
Users can customize them after generation.

---

## @ai-cascade as Architecture Map

@ai-cascade serves two purposes:
1. Regression prevention — check these files after any modification
2. Architecture mapping — cascade count signals file criticality

Cascade count thresholds:
- 10-19 dependents -> High-impact, prefer isolated changes
- 20+   dependents -> Critical file, discuss before modifying

These thresholds are automatically reflected in the generated @ai-context.
