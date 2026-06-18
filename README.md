# TPT Code Command Center

A VS Code extension that acts as a local HTTP proxy between your AI coding tools (Cline, Claude Code) and any LLM provider — intercepting every request to optimise token usage, redact secrets, cache identical prompts, and route traffic intelligently.

**Zero DevOps. No hosted backend. No Docker. Everything runs locally inside VS Code.**

---

## Features

| Module | What it does |
|--------|-------------|
| **TPT Vault** | Redacts AWS keys, Stripe tokens, GitHub PATs, JWTs, `.env` secrets, and custom patterns before any LLM sees them |
| **TPT Smart Context** | Replaces large file contents in tool calls with compact AST outlines — dramatically reduces tokens sent per request |
| **TPT Token Shield** | Caches identical prompts locally (SHA-256 hash match) — zero cost on repeated queries |
| **TPT Memory Weaver** | Automatically summarises conversation history when it grows too large — keeps context costs in check |
| **TPT Router** | Rewrites the target model and provider based on configurable heuristics — send simple tasks to cheap local models |
| **TPT Silent Edit** | Intercepts AI JSON edit instructions and applies them as native undoable VS Code diffs |
| **TPT Forge** | Install community-maintained router rules, vault patterns, and system prompts from a GitHub registry |
| **TPT Terminal** | Live pipeline logs in the VS Code Output Channel |

---

## Quick Start

### 1. Install the extension

From the `.vsix` file:

```
Extensions panel → ⋯ → Install from VSIX…
```

Or install from the VS Code Marketplace (coming soon).

### 2. Set your API key

Open VS Code Settings (`Ctrl+,`) and search for `tpt`:

```json
"tpt.upstreamProvider": "openrouter",
"tpt.openrouterApiKey": "sk-or-..."
```

**Supported providers:**

| Setting value | Routes to |
|---------------|-----------|
| `openrouter` (default) | [OpenRouter](https://openrouter.ai) — access all models with one key |
| `anthropic` | Anthropic API directly |
| `openai` | OpenAI API directly |
| `local` | Ollama, LM Studio, or any local OpenAI-compatible server |
| `custom` | Any base URL you specify |

### 3. Connect your AI tools

When the extension activates, it starts a local proxy and prints the URL and session token in the **TPT Command Center** Output Channel.

**Claude Code** — the `ANTHROPIC_BASE_URL` environment variable is injected into all new VS Code terminals automatically. Open a new terminal and run Claude Code as normal.

**Cline** — open Cline settings and set:
- Provider: `OpenAI Compatible`
- Base URL: `http://localhost:7331` (or whatever port is shown in the Output Channel)
- Add header: `X-TPT-Token: <token shown in Output Channel>`

**Any other OpenAI-compatible tool** — point the base URL to `http://localhost:7331/v1`.

---

## Configuration Reference

All settings are under the `tpt.*` namespace in VS Code settings (`Ctrl+,` → search `tpt`).

### Core

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.enabled` | `true` | Master switch — bypass all modules when `false` |
| `tpt.upstreamProvider` | `openrouter` | Default upstream provider |
| `tpt.openrouterApiKey` | `""` | OpenRouter API key |
| `tpt.anthropicApiKey` | `""` | Anthropic API key |
| `tpt.openaiApiKey` | `""` | OpenAI API key |
| `tpt.localBaseUrl` | `http://localhost:11434/v1` | Local model server URL (Ollama default) |
| `tpt.customBaseUrl` | `""` | Custom upstream base URL |
| `tpt.customApiKey` | `""` | API key for custom upstream |

### TPT Vault

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.vault.enabled` | `true` | Enable secret redaction |
| `tpt.vault.customRegex` | `[]` | Additional regex patterns to redact |

### TPT Smart Context

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.smartContext.enabled` | `true` | Enable AST outline extraction |
| `tpt.smartContext.maxFileSize` | `512000` | Files larger than this (bytes) are outlined |

### TPT Token Shield

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.tokenShield.enabled` | `true` | Enable prompt caching |
| `tpt.tokenShield.maxCacheSizeMB` | `256` | Maximum local cache size |

### TPT Memory Weaver

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.memoryWeaver.enabled` | `true` | Enable context summarisation |
| `tpt.memoryWeaver.tokenThreshold` | `50000` | Token count that triggers summarisation |
| `tpt.memoryWeaver.fallbackOrder` | `["ollama","proxy","extractive"]` | Summarisation backend priority |

### TPT Router

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.router.enabled` | `false` | Enable heuristic routing |
| `tpt.router.rules` | `[]` | Array of routing rules (see below) |

**Router rule format:**
```json
{
  "match": {
    "maxTokens": 2000,
    "keywords": ["fix typo", "rename"],
    "extensions": ["md", "txt"]
  },
  "model": "gpt-4o-mini",
  "provider": "openai"
}
```

Rules are evaluated in order. The first match wins.

### TPT Silent Edit

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.silentEdit.enabled` | `false` | Enable JSON-based silent edits |

### TPT Forge

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.forge.autoUpdate` | `true` | Auto-check for community config updates |

### TPT Terminal

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.terminal.verboseLogging` | `false` | Show per-request pipeline detail in Output Channel |

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type `TPT`:

| Command | Description |
|---------|-------------|
| `TPT: Toggle Entire Suite On/Off` | Also accessible by clicking the status bar icon |
| `TPT: Show Dashboard` | Open the token stats WebView panel |
| `TPT: Show Token Stats` | Quick stats notification |
| `TPT: Copy Proxy URL to Clipboard` | Copy `http://localhost:<port>` for manual tool setup |
| `TPT: Clear Local Cache` | Wipe the Token Shield prompt cache |
| `TPT: Force Memory Weaver Prune` | Manually trigger context summarisation |
| `TPT: Browse Forge` | Install community configs from the registry |

---

## Status Bar

The shield icon in the bottom-right of VS Code shows the current state:

- **Green** `🛡 TPT` — all modules active
- **Yellow** `🛡 TPT (4/6)` — some modules active
- **Red** `🛡 TPT` — suite bypassed

Click to open the toggle menu.

---

## Security

The proxy generates a random session token on every activation. All requests must include this token as the `X-TPT-Token` header. This prevents other local processes from routing traffic (and your API keys) through the proxy without your knowledge.

The token is printed to the **TPT Command Center** Output Channel on startup and is automatically injected into new VS Code terminal sessions.

---

## Local Files

TPT stores its data in a `.tpt/` folder at the workspace root:

```
.tpt/
  ledger.db      — token/cost history (sql.js SQLite)
  cache.db       — Token Shield prompt cache (sql.js SQLite)
  memory.json    — Memory Weaver conversation summaries
  forge/         — Installed Forge community configs
```

Add `.tpt/` to your `.gitignore` to avoid committing local data.

---

## Building from Source

```bash
git clone https://github.com/<your-org>/tpt-code-command-center
cd tpt-code-command-center
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

To package a `.vsix`:

```bash
npm install -g @vscode/vsce
vsce package
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
