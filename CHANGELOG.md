# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Streaming response support (SSE for both Anthropic and OpenAI formats)
- Tree-sitter language WASM bundles for TypeScript, JavaScript, Python, Go, Rust
- `.vscode/launch.json` for F5 development workflow
- GitHub Actions CI pipeline
- Unit tests for Vault regex, hash normalisation, and Router rule matching
- Built-in default Router rules
- Live model pricing from OpenRouter API (cached daily)

---

## [0.1.0] — 2026-06-18

### Added
- **Extension-hosted local HTTP proxy** — starts automatically on VS Code launch, shuts down on close. Dynamic port binding starting at 7331. Session token security on all requests.
- **ANTHROPIC_BASE_URL injection** — automatically injected into all VS Code terminal environments so Claude Code routes through the proxy without any manual setup.
- **Upstream provider support** — OpenRouter (default), Anthropic direct, OpenAI direct, local (Ollama/LM Studio), and custom base URL. All configurable via VS Code settings.
- **Both API formats** — handles Anthropic Messages format (`/v1/messages`) and OpenAI Chat Completions format (`/v1/chat/completions`).
- **TPT Vault** — regex-based redaction of AWS keys, Stripe tokens, GitHub PATs, JWTs, `.env` patterns, SSH private keys, and user-defined custom patterns.
- **TPT Smart Context** — replaces large file contents in AI tool results with compact AST outlines using `web-tree-sitter`. Falls back to regex-based outline extraction when no parser is available.
- **TPT Token Shield** — SHA-256 hash-based exact-match prompt cache backed by `sql.js`. Configurable size cap with LRU eviction.
- **TPT Memory Weaver** — summarises conversation history when token count exceeds a threshold. Supports Ollama, proxy LLM, and extractive fallback in a user-configurable priority order.
- **TPT Router** — rewrites the target model and upstream provider based on heuristic rules matching token count, keywords, and file extensions.
- **TPT Silent Edit** — injects a JSON edit schema into system prompts and applies matching AI responses as native undoable `WorkspaceEdit` diffs.
- **TPT Forge** — fetches and installs community router rules, vault patterns, and system prompts from a public GitHub registry.
- **TPT Terminal** — Output Channel with live pipeline logs. Verbose mode shows per-request detail.
- **Status bar item** — green/yellow/red shield icon with Quick Pick toggle menu for all modules.
- **WebView dashboard** — token ledger stats, 7-day cost chart, active module map.
- **Command Palette** — all functions accessible via `Ctrl+Shift+P` (`TPT: ...`).
- **Token Ledger** — records every request (model, tokens in/out, cost, cache hit, module actions) in a local `sql.js` database at `.tpt/ledger.db`.
- **No native modules** — uses `sql.js` (WASM) instead of `better-sqlite3`. Installs cleanly on Windows, macOS, and Linux without compilation.
