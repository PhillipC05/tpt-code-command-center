# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**What is TPT Code Command Center?**

A VS Code extension that acts as a local HTTP proxy between AI coding tools (Cline, Claude Code) and LLM providers. It intercepts requests to optimize token usage, redact secrets, cache identical prompts, and intelligently route traffic—all running locally inside VS Code with zero external dependencies.

**Build Commands**

```bash
npm install              # Install dependencies
npm run compile          # Compile TypeScript to out/
npm run watch            # Watch mode — recompile on save
npm run lint             # Run ESLint on src/
npm test                 # Run all tests (vault, hash, router, integration)
```

**Run Single Test**

```bash
node --test out/test/vault.test.js      # Vault redaction tests
node --test out/test/hash.test.js       # Hash/prompt caching tests
node --test out/test/router.test.js     # Router heuristics tests
node --test out/test/integration/proxy.integration.test.js  # End-to-end pipeline
```

**Development**

Press `F5` in VS Code to launch the **Extension Development Host**. The proxy will start, print its URL and session token to the Output Channel, and all VS Code configuration changes trigger an instant update without reloading.

---

## Architecture Overview

The extension is structured as a **request middleware pipeline** with modular token-optimization stages.

### Request Flow

1. **HTTP Server** (`src/proxy/server.ts`)
   - Listens on port 7331 (or first available port >= 7331)
   - Detects request format (Anthropic `/v1/messages` vs OpenAI `/v1/chat/completions`)
   - Validates session token (`X-TPT-Token` header)
   - Forwards upstream to configured provider and streams responses back

2. **Pipeline** (`src/proxy/pipeline.ts`)
   - Runs 6 ordered middleware stages on the request body
   - Each stage is a pure function that returns a modified copy
   - Collects action strings for logging and ledger
   - Returns early on cache hit (Token Shield)

3. **Pipeline Stages** (in order)
   - **Vault**: Redacts secrets (AWS keys, Stripe, GitHub PAT, JWT, private IPs, `.env` patterns, SSH keys, custom regex)
   - **Token Shield**: SHA-256 cache lookup on messages array — returns cached response if hash matches, skipping upstream
   - **Memory Weaver**: Summarizes conversation if token count exceeds threshold (default 50,000)
   - **Smart Context**: Replaces large file content in tool results with compact AST outlines (tree-sitter WASM)
   - **Silent Edit**: Injects schema into system prompt so LLMs output edits as JSON blocks instead of markdown
   - **Router**: Rewrites model and provider based on heuristic rules (token count, keywords, file extensions)

### Data Storage

Three SQLite databases in `.tpt/` (git-ignored):

- **`ledger.db`** (`src/ledger/ledger.ts`): Tracks all requests — model, tokens in/out, cost, cache hits, module actions
- **`cache.db`** (`src/modules/tokenShield.ts`): Stores prompt hash → response mapping for caching
- **`memory.json`**: Memory Weaver conversation summaries (JSON, not SQL)
- **`pricing.json`**: Cached model pricing from OpenRouter (24-hour TTL, falls back to built-in table)

### Type System

Core request/response types in `src/proxy/types.ts`:

- **`ProxyRequest`**: method, path, headers, body (Anthropic or OpenAI format), format, sessionToken
- **`ProxyResponse`**: statusCode, headers, body, tokensIn, tokensOut, cacheHit, moduleActions
- **`AnthropicRequest` / `OpenAIRequest`**: model, messages, system, max_tokens, tools, stream
- **`Message`**: role (system/user/assistant/tool), content (string or ContentBlock[])

---

## Module Details

### Vault (`src/modules/vault.ts`)

Recursively redacts secrets from messages and system prompt. Built-in patterns:

- AWS access keys (`AKIA...` and `aws_secret_access_key=...`)
- Stripe keys (`sk_live_*`, `rk_live_*`)
- GitHub PAT (`ghp_*`, `github_pat_*`)
- JWT (3-part base64url)
- Generic API keys/tokens
- Private IP URLs
- `.env` style secrets
- SSH/PEM private key headers

Custom regex patterns can be added via `tpt.vault.customRegex` setting.

**Key function**: `runVault(body, customRegex)` → `{ body, redacted: count }`

### Token Shield (`src/modules/tokenShield.ts`)

Prompt caching via SHA-256 hash of normalized messages. Cache hit returns buffered response immediately without hitting upstream.

**Key functions**:
- `runTokenShield(messages)` → cached response string or null
- `storeCachedResponse(messages, response, maxCacheSizeMB)` → stores in cache.db, enforces size limit
- `clearCache()` → wipes cache.db

**Note**: Streaming requests (`stream: true`) are never cached — returning buffered JSON to a streaming client would break SSE protocol.

### Memory Weaver (`src/modules/memoryWeaver.ts`)

Automatically summarizes conversation history when token count exceeds threshold. Tries summarization backends in priority order:

1. **Ollama** (local): POST to `http://localhost:11434/api/generate`
2. **Proxy** (route through upstream): Uses configured provider with `memoryWeaver.anthropicSummaryModel` or `openaiSummaryModel`
3. **Extractive** (drop oldest): Keep system + last N messages that fit threshold

**Key function**: `runMemoryWeaver(messages, config)` → `{ messages: summarized[], summarised: boolean }`

### Smart Context (`src/modules/smartContext.ts`)

Replaces large file content in tool results with AST outlines using tree-sitter WASM. Supports TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby.

**Fallback**: If WASM not bundled, uses regex-based outline extraction (first 50 lines + function/class declarations).

**Key function**: `runSmartContext(messages, maxFileSize)` → `{ messages, replaced: count }`

**Setup**: `setWasmDir(dir)` called in extension activation to point at bundled WASM files.

### Router (`src/modules/router.ts`)

Rewrites model and provider based on rules evaluated in order. First match wins.

**Rule format**:
```json
{
  "match": {
    "maxTokens": 2000,
    "keywords": ["fix typo"],
    "extensions": ["ts", "py"]
  },
  "model": "openai/gpt-4o-mini",
  "provider": "openrouter"
}
```

**Built-in defaults** (if router enabled but no rules configured):
- Short prompts (≤2000 tokens) → gpt-4o-mini
- Code-heavy contexts → gpt-4o

**Key function**: `runRouter(body, rules)` → `RouteOverride { baseUrl, apiKey, model? }` or undefined

### Silent Edit (`src/modules/silentEdit.ts`)

Injects JSON edit schema into system prompt so LLMs output file edits as:

```
```tpt-edit
{"file":"src/index.ts","startLine":10,"endLine":20,"newContent":"..."}
```
```

Server extracts these blocks and applies them as undoable VS Code diffs.

**Key function**: `runSilentEditInjection(body, format)` → modified body with schema prepended

### Forge (`src/modules/forge.ts`)

Community config registry. Three config types: router rules, vault patterns, system prompts. Downloaded from GitHub, cached in `.tpt/forge/`.

Built-in entries include default router rules, extended vault patterns (Azure, SendGrid, Twilio, etc.), and Silent Edit system prompt template.

---

## Configuration & Settings

All settings under `tpt.*` namespace in VS Code settings (`Ctrl+,` → search `tpt`).

**Core**:
- `tpt.enabled` (boolean): Master switch — disable to bypass all modules
- `tpt.upstreamProvider` (enum): openrouter, anthropic, openai, deepseek, qwen, kimi, grok, local, custom
- `tpt.{openrouter,anthropic,openai,...}ApiKey`: Provider-specific credentials

**Module toggles**:
- `tpt.vault.enabled`, `tpt.vault.customRegex`
- `tpt.smartContext.enabled`, `tpt.smartContext.maxFileSize`
- `tpt.tokenShield.enabled`, `tpt.tokenShield.maxCacheSizeMB`
- `tpt.memoryWeaver.enabled`, `tpt.memoryWeaver.tokenThreshold`, `tpt.memoryWeaver.fallbackOrder`, summarization model names
- `tpt.router.enabled`, `tpt.router.rules`
- `tpt.silentEdit.enabled`

**Other**:
- `tpt.terminal.verboseLogging`: Show per-request pipeline detail in Output Channel
- `tpt.costBudget.dailyLimitUsd`: Warn when daily spend exceeds threshold

See `package.json` (`contributes.configuration`) for full descriptions and defaults.

---

## Adding a New Module

1. Create `src/modules/yourModule.ts` exporting `run*(...): YourResult` function
2. Add toggle settings to `package.json` `contributes.configuration`
3. Add to `TptConfig` interface and `getConfig()` in `src/utils/config.ts`
4. Wire into `src/proxy/pipeline.ts` at appropriate position (before/after which other stages?)
5. Add toggle to Quick Pick menu in `src/ui/statusBar.ts`
6. Document in `README.md`

**Pattern**: Each module is a pure function (or async) that takes request body and returns modified copy. No side effects except ledger/cache writes.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point — activate/deactivate, command registration, status bar setup |
| `src/proxy/server.ts` | HTTP server, port binding, session token, upstream forwarding |
| `src/proxy/pipeline.ts` | Ordered middleware chain — core flow |
| `src/proxy/types.ts` | Shared Anthropic/OpenAI request/response types |
| `src/utils/config.ts` | VS Code settings retrieval and type definitions |
| `src/utils/hash.ts` | SHA-256 prompt normalization for Token Shield |
| `src/utils/logger.ts` | Output Channel logging with timestamps |
| `src/ledger/ledger.ts` | SQLite request ledger — queries, recording, stats |
| `src/ledger/pricing.ts` | Model pricing lookup (live from OpenRouter + built-in fallbacks) |
| `src/ui/statusBar.ts` | Status bar icon and toggle menu |
| `src/ui/dashboard.ts` | WebView panel — token stats, 7-day history, model breakdown, budget bar |

---

## Testing

**Test Philosophy**: No mocking of core logic — mocks are minimal (VS Code API stub in `src/test/helpers/mock-vscode.ts`).

**Test Files**:
- `vault.test.ts`: Redaction coverage (AWS, Stripe, GitHub, JWT, SSH, custom patterns)
- `hash.test.ts`: Prompt normalization (whitespace collapse, lowercasing)
- `router.test.ts`: Heuristic matching (token estimation, extension extraction, user content parsing)
- `proxy.integration.test.ts`: End-to-end pipeline with mock upstream HTTP server

**Run Tests**:
```bash
npm run compile && npm test
```

or individually (must compile first):
```bash
npm run compile
node --test out/test/vault.test.js
```

---

## Token Counting & Pricing

**Token estimation** (`estimateTokensInMessages`):
- String content: character count ÷ 4
- ContentBlock arrays: sum text blocks, same formula
- Used by Memory Weaver threshold check and Router heuristics

**Pricing** (`src/ledger/pricing.ts`):
- Fetches live from OpenRouter `/models` API once per day, caches in `pricing.json`
- Falls back to built-in table (Anthropic, OpenAI, DeepSeek, Grok, Qwen, Moonshot)
- Fuzzy model name matching (substring + heuristics for variants)
- Cost = `(tokensIn × promptPer1M + tokensOut × completionPer1M) / 1,000,000`

---

## Extension Development Host Workflow

1. **Launch**: `F5` to open Extension Development Host window
2. **Watch mode** (separate terminal): `npm run watch` recompiles on every save
3. **Reload**: `Ctrl+R` in Extension Development Host to reload extension
4. **Debug Output**: Output Channel shows proxy URL, session token, pipeline logs
5. **Config changes**: Instantly reflected — no reload needed (VS Code API triggers update)

---

## Package & Publish

**Pre-publish**:
```bash
npm run download-wasm    # Fetch tree-sitter language WASM files from GitHub
npm run compile          # Compile to out/
npm run lint             # Check for errors
npm test                 # Run test suite
```

**Package as .vsix**:
```bash
npm install -g @vscode/vsce
vsce package
```

Outputs `.vsix` file ready for VS Code extension marketplace or local install.

---

## Important Conventions

- **Strict TypeScript**: `"strict": true` in `tsconfig.json`
- **No compiled native modules**: Extension must install cleanly on all platforms
- **Output via VS Code APIs**: All user-facing strings through `vscode.window`, Output Channel, WebView
- **Pure functions in modules**: No side effects except logging to ledger/cache
- **Async/await**: Preferred over raw Promises
- **Session token**: Random UUID generated on activation, required in `X-TPT-Token` header to prevent local process hijacking
- **Format detection**: Automatic — `/v1/messages` → Anthropic, else → OpenAI

---

## Debugging Tips

- **Verbose logging**: Set `tpt.terminal.verboseLogging: true` to see per-request pipeline actions
- **Clear cache**: Command `TPT: Clear Local Cache` wipes Token Shield
- **Inspect ledger**: Query `.tpt/ledger.db` directly with SQL query tools
- **Mock upstream**: Integration tests include working example of mock HTTP server setup
- **Cache miss diagnostics**: Check normalized hash — whitespace and case matter
