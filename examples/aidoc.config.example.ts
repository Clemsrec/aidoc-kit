/**
 * @ai-agent general-expert
 * @ai-runtime SERVER UNIQUEMENT
 *
 * @ai-context
 * [GÉNÉRÉ] Ce fichier exporte : aidoc.config.example.ts
 * 
 *
 * @ai-when-modifying
 * 1. Vérifier les fichiers en cascade ci-dessous avant de modifier
 * 2. Après modification, indiquer au développeur de lancer @ai-validate
 * 3. Si tu n'as pas accès au terminal, signaler la commande à exécuter
 *
 * @ai-cascade
 * (aucun détecté)
 *
 * @ai-validate
 * npm run typecheck
 */
/**
 * aidoc-kit — Example configuration for a Next.js + Firebase + Stripe project
 *
 * Rename this file to `aidoc.config.js` (or `aidoc.config.json`) at your project root.
 * TypeScript configs require ts-node / tsx to be executed by the CLI.
 *
 * @see https://github.com/Clemsrec/aidoc-kit#configuration
 */

import type { AidocConfig } from 'aidoc-kit'

const config: AidocConfig = {

  // ─── Agent inference overrides ─────────────────────────────────────────
  //
  // Map any import substring - agent name.
  // Rules are checked BEFORE the built-in heuristics, most specific wins.
  //
  agents: {
    // Firebase
    'firebase-admin':            'firebase-admin-expert',
    'firebase/auth':             'firebase-auth-expert',
    'firebase/firestore':        'firebase-db-expert',
    'firebase/storage':          'firebase-storage-expert',
    'firebase/functions':        'firebase-functions-expert',

    // Stripe
    'stripe':                    'billing-expert',
    '@stripe/stripe-js':         'billing-expert',
    '@stripe/react-stripe-js':   'billing-expert',

    // Next.js specifics
    'next/navigation':           'routing-expert',
    'next/headers':              'server-expert',
    'next/server':               'server-expert',
    'next-auth':                 'auth-expert',

    // Your own aliases (adjust to your tsconfig paths)
    '@/lib/permissions':         'permissions-expert',
    '@/lib/analytics':           'analytics-expert',
    '@/components/ui':           'design-system-expert',
  },

  // ─── Files / directories to ignore ────────────────────────────────────
  //
  // Supports:
  //   'src/generated/'   - any file under that directory
  //   '*.test.ts'        - any file ending in .test.ts
  //   'src/foo/bar.ts'   - exact relative path
  //
  ignore: [
    // auto-generated code — never needs @ai-* blocks
    'src/generated/',
    'src/lib/prisma-client/',
    'src/__mocks__/',

    // test files
    '*.test.ts',
    '*.test.tsx',
    '*.spec.ts',
    '*.spec.tsx',

    // storybook
    '*.stories.ts',
    '*.stories.tsx',

    // config files at root
    'next.config.ts',
    'tailwind.config.ts',
    'postcss.config.js',
  ],

  // ─── Default @ai-validate command ─────────────────────────────────────
  //
  // Written into every generated @ai-validate block.
  // Use a command that catches type errors AND runtime issues quickly.
  //
  validate: 'npm run typecheck && npm run lint',

  // ─── LLM enrichment ───────────────────────────────────────────────────
  //
  // Used by `npx aidoc-kit enrich` to replace [GENERE] placeholders
  // with real LLM-generated descriptions.
  //
  enrich: {
    provider: 'anthropic',

    // API key — never hardcode a real key here.
    // aidoc-kit reads from process.env automatically.
    // Load your .env before running:
    //   source .env && npx aidoc-kit enrich
    // Or use dotenv-cli:
    //   npx dotenv -e .env.local -- aidoc-kit enrich
    key: process.env.ANTHROPIC_API_KEY,

    // model — optional, resolved dynamically via provider API if omitted.
    // Set explicitly only if dynamic resolution fails.
    // Anthropic models: https://docs.anthropic.com/en/docs/about-claude/models
    // model: 'claude-haiku-4-5-20251001',
  },
}
