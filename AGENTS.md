# AGENTS

> Généré par aidoc-kit le 2026-04-16
> 13 fichiers scannés — 8 avec docs @ai-*

## Agents et leurs domaines

### general-expert

**Fichiers :** 8
- `examples/aidoc.config.example.ts`
- `src/core/chunker.ts`
- `src/core/config.ts`
- `src/core/enricher.ts`
- `src/core/fixer.ts`
- `src/core/init.ts`
- `src/index.ts`
- `src/rules/index.ts`

## Runtime Map

### SERVER UNIQUEMENT (2 fichiers)

- `examples/aidoc.config.example.ts`
- `src/core/init.ts`

### CLIENT UNIQUEMENT (1 fichiers)

- `src/core/chunker.ts`

### UNIVERSEL (5 fichiers)

- `src/core/config.ts`
- `src/core/enricher.ts`
- `src/core/fixer.ts`
- `src/index.ts`
- `src/rules/index.ts`

## Fichiers sans documentation @ai-*

5 fichier(s) sans bloc `@ai-*` détecté(s).
Le développeur peut générer les blocs manquants avec :

```bash
npx aidoc-kit scan --write --yes
```

> **Note pour les agents IA** : ne pas exécuter cette commande toi-même.
> La signaler au développeur si tu constates des fichiers non documentés.

## Fichiers volumineux — lire le chunk avant de modifier

Les fichiers de plus de 150 lignes ont un résumé structuré dans `.codemod/chunks/`.
Avant de modifier un fichier volumineux, **lire le fichier `.md` correspondant** dans ce dossier.
Ne pas tenter de lire le fichier source en entier — utiliser le chunk.

Exemple : avant de modifier `src/contexts/auth-context.tsx`
=> Lire `.codemod/chunks/src/contexts/auth-context.tsx.md`

> Les chunks sont générés et maintenus par le développeur via `npx aidoc-kit chunk`.
> Si un chunk est manquant, demander au développeur de lancer cette commande.
> **Note pour les agents IA** : aidoc-kit doit être installé en dev dep (`npm install -D aidoc-kit`).
> Toutes les commandes aidoc-kit sont à confier au développeur, pas à exécuter directement.

## API keys — contrat de la librairie

aidoc-kit lit les clés API depuis `process.env` uniquement.
Elle ne lit **jamais** les fichiers `.env` directement — c'est intentionnel.

**Règles à respecter dans tout le code aidoc-kit :**
- Jamais de lecture de fichier `.env` dans le code source
- Jamais de clé hardcodée, même pour les tests
- Le message d'erreur "clé manquante" doit toujours proposer les 4 options de résolution :
  shell export, `source .env`, `dotenv-cli`, `aidoc.config.ts`
- La variable d'environnement lue doit être affichée dans le log :
  `Cle lue depuis $ANTHROPIC_API_KEY`

**Variables d'environnement standard par provider :**

| Provider  | Variable |
|-----------|----------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI    | `OPENAI_API_KEY` |
| Gemini    | `GEMINI_API_KEY` ou `GOOGLE_AI_API_KEY` |
| Groq      | `GROQ_API_KEY` |
| Mistral   | `MISTRAL_API_KEY` |
| Ollama    | Aucune clé requise |
