# TPT Code Command Center — Task Checklist

## Phase 1 — Foundation (Complete)

- [x] Scaffold TypeScript VS Code extension (`package.json`, `tsconfig.json`, `src/extension.ts`)
- [x] Local HTTP proxy server — dynamic port binding starting at 7331
- [x] Session token security — random token per activation, required as `X-TPT-Token` header
- [x] Inject `ANTHROPIC_BASE_URL` into VS Code terminal environments (all platforms)
- [x] Pipeline middleware chain (`proxy/pipeline.ts`)
- [x] Status bar item — Green / Yellow / Red shield icon
- [x] Quick Pick toggle menu — per-module on/off + suite toggle
- [x] Token Ledger — `sql.js` database, token counting, cost estimation
- [x] WebView dashboard — stats, 7-day chart, module status

## Phase 2 — Modules (Complete)

- [x] **TPT Vault** — regex redaction (AWS, Stripe, GitHub PAT, JWT, .env, SSH keys, custom patterns)
- [x] **TPT Smart Context** — `web-tree-sitter` AST outline extraction for large file tool results
- [x] **TPT Token Shield** — SHA-256 hash-based exact-match prompt cache backed by `sql.js`
- [x] **TPT Memory Weaver** — conversation summarisation via Ollama → proxy LLM → extractive (configurable)
- [x] **TPT Router** — heuristic model/provider rewriting based on token count, keywords, file extensions
- [x] **TPT Silent Edit** — JSON edit schema injection + `WorkspaceEdit` API application
- [x] **TPT Forge** — GitHub-backed community config registry with Quick Pick browser
- [x] **TPT Terminal** — Output Channel live logs, verbose mode toggle

## Phase 3 — Developer Experience (Pending)

- [x] Add `.vscode/launch.json` — F5 Extension Development Host configuration
- [x] Add `.vscode/tasks.json` — build/watch tasks
- [x] Create `media/icon.png` — 128×128 marketplace icon (currently placeholder SVG only)
- [x] Add `.vscode/settings.json` example for Cline setup (base URL + `X-TPT-Token` header)
- [x] Write unit tests (`src/test/`) — Vault regex, hash normalisation, router rule matching
- [x] Add integration test — proxy pass-through with a mock upstream server

## Phase 4 — Streaming & Edge Cases (Pending)

- [x] Handle **streaming responses** (`stream: true`) — detects and routes to streaming path
- [x] Handle **Anthropic streaming** (`text/event-stream` SSE format)
- [x] Handle **OpenAI streaming** (`data: [DONE]` SSE format)
- [x] Token counting from streaming chunks (accumulate for ledger)
- [x] Silent Edit interception for streamed responses
- [x] Graceful proxy error page — consistent `sendErrorJson` helper with descriptive messages

## Phase 5 — Smart Context Enhancements (Pending)

- [x] Bundle tree-sitter language WASM files for TypeScript, JavaScript, Python, Go, Rust
  - These must ship with the extension (not fetched at runtime) for offline/air-gapped use
  - Add to `package.json` files array and `.vscodeignore` whitelist
- [x] Support outline extraction for additional languages (C#, Java, PHP, Ruby)
- [x] Detect file extension from tool call `path` argument rather than content heuristic

## Phase 6 — Router & Cost Tracking (Pending)

- [x] Seed Router with built-in default rules (`maxTokens: 2000` → `gpt-4o-mini`, code extensions → `gpt-4o`)
- [x] Pull live model pricing from OpenRouter API and cache locally (refresh daily)
- [x] Display per-model cost breakdown in the dashboard
- [x] Add "cost budget" alert — warn when daily spend exceeds a threshold

## Phase 7 — Forge Registry (Pending)

- [x] Create the `tpt-forge/registry` GitHub repository with `index.json` and example entries
- [x] Publish initial community configs:
  - [x] Default router rules set
  - [x] Common Vault patterns (internal company key formats)
  - [x] System prompt templates for Silent Edit schema

## Phase 8 — Packaging & Release (Pending)

- [x] Install `vsce` and run `vsce package` — verify `.vsix` builds cleanly
- [x] Test `.vsix` install on clean Windows machine
- [ ] Test `.vsix` install on macOS
- [ ] Test `.vsix` install on Linux
- [x] Create `media/icon.png` 128×128 and 256×256 versions
- [ ] Fill in `package.json` `publisher` field — register at https://marketplace.visualstudio.com/manage then update `"publisher"` in package.json
- [ ] Add marketplace screenshots to `media/` and reference them in README.md
- [ ] Publish to VS Code Marketplace via `vsce publish`
- [x] Tag v0.1.0 release on GitHub
- [x] Write `CHANGELOG.md` v0.1.0 entry

## Phase 9 — Future Ideas (Backlog)

- [x] Semantic cache upgrade — Ollama embedding similarity in Token Shield (opt-in via `tpt.tokenShield.semanticCache.*`); uses `nomic-embed-text` model, cosine similarity threshold configurable
- [x] Cline auto-configuration — `TPT: Auto-Configure Cline` command detects Cline extension and sets `cline.apiProvider`, `cline.openAiBaseUrl`, and `cline.openAiHeaders` automatically
- [x] Multi-workspace support — VS Code runs one extension host per window; module singletons are already window-scoped; `.tpt/` data path uses `workspaceFolders[0]` (inherently per-workspace)
- [x] Token budget per project — `tpt.costBudget.hardStop: true` rejects requests with HTTP 429 when daily limit is exceeded (existing `dailyLimitUsd` setting still controls the threshold)
- [x] Prompt diff view — `TPT: Show Prompt Diff` opens a side-by-side WebView comparing original client body vs post-pipeline body with module actions and router override listed
- [x] TPT Inspect command — `TPT: Inspect Last Request` dumps the processed body, module actions, and router override to the Output Channel for the most recent proxied request
- [x] Export ledger to CSV — `TPT: Export Ledger to CSV` prompts for a save path and writes all ledger rows as CSV
