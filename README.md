# Mantic
[![npm version](https://img.shields.io/npm/v/mantic.sh.svg?style=flat-square)](https://www.npmjs.com/package/mantic.sh)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=mantic&config=eyJ0eXBlIjogInN0ZGlvIiwgImNvbW1hbmQiOiAibnB4IiwgImFyZ3MiOiBbIi15IiwgIm1hbnRpYy5zaEBsYXRlc3QiLCAic2VydmVyIl19)
[![Install in VS Code](https://img.shields.io/badge/VS%20Code-Install-007ACC?style=flat-square&logo=visual-studio-code&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=mantic&config=%7B%22type%22%3A%20%22stdio%22%2C%20%22command%22%3A%20%22npx%22%2C%20%22args%22%3A%20%5B%22-y%22%2C%20%22mantic.sh%40latest%22%2C%20%22server%22%5D%7D)
[![Agent Rules](https://img.shields.io/badge/Agent%20Rules-Copy%20Config-8A2BE2?style=flat-square&logo=robot&logoColor=white)](https://github.com/marcoaapfortes/Mantic.sh/blob/main/AGENT_RULES.md)

**The reference implementation of cognitive code search.**

> "Embeddings are an expensive workaround for missing structure." — *The Mantic Manifesto*

Mantic is the infrastructure layer that removes unnecessary thinking from AI agents. It does not read your code; it infers intent from structure, enabling sub-300ms retrieval without heavy indexing or vector databases.

## 🤖 Agent Rules (Auto-Pilot)
Want Cursor or Claude to use Mantic automatically? [**Copy these Agent Rules**](https://github.com/marcoaapfortes/Mantic.sh/blob/main/AGENT_RULES.md).

## Why Mantic Exists

In 2026, AI agents write 40%+ of enterprise code. But they are bottlenecked by context retrieval:
- **Vector search is slow** (300-1000ms) and expensive ($0.003/query).
- **Grep is dumb**; it lacks ranking, causing agents to read 50+ irrelevant files.
- **Agents waste 80% of tokens** reading the wrong context.

Mantic fixes this by making context retrieval **faster than human reaction time** (sub-300ms) without sacrificing accuracy.

## Performance Comparison (Cal.com Monorepo)

| Tool | Search Time | Setup | Dependencies |
|------|------------|-------|--------------|
| **Mantic** | **72ms** | **None** | **Zero** |
| Sourcegraph Cody | 850ms | Vector DB | OpenAI API |
| Claude Context | 420ms | Embeddings | Vector DB |
| grep/ripgrep | 1200ms | None | Zero (no ranking) |

*Benchmarks run on a 9,621 file monorepo (M2 Max).*

## The 20-Watt Insight

The human brain does not brute force. It does not embed every line of code it sees. It triages, infers, and prunes aggressively based on structure **before** it even reads a single line.

Mantic formalizes this biological efficiency into deterministic infrastructure:
1.  **Structural Inference (72ms)**: We analyze file paths, names, and dependency graphs first.
2.  **Semantic Verification (Optional)**: We only read code when the structural signal is ambiguous.

This "metadata-first" approach is why Mantic is **6× faster** than embedding-based alternatives.

## Features

- **Mantic Signal Extraction** - Zero-read scoring that isolates signal from noise
- **Deterministic Axioms** - Guaranteed consistent outputs via stable sorting
- **Impact Verification** - Understand blast radius before generating code
- **Session Memory** - Context carryover across multi-turn conversations
- **Intent Detection** - Automatically categorizes queries (UI, backend, auth, etc.)
- **Progressive Disclosure** - Rich metadata including size, confidence, and modification dates
- **Model Context Protocol (MCP)** - Native integration with Claude Desktop and Cursor
- **Hallucination Detection** - Validates that referenced entities actually exist in your codebase

## Quick Start

### Installation

```bash
npm install
npm run build
```

### Basic Usage

```bash
# Search your codebase (The Mantic Way)
mantic "stripe payment integration"

# Filter by signal type
mantic "authentication logic" --code
mantic "environment variables" --config

# Verify impact
mantic "user service" --impact
```

## How It Works

### Architecture

```
User Query
    ↓
Intent Analyzer → Category (UI/backend/auth) + Keywords
    ↓
Brain Scorer → Ranks files using metadata (no file reads)
    ↓
File Classifier → Filters by type (code/config/test)
    ↓
Impact Analyzer → Calculates blast radius (optional)
    ↓
Output
```

### Brain-Inspired Scoring

Files are ranked using a multi-constraint scoring system that considers:

- **Intent matching** - How well the file matches the query intent
- **Path relevance** - File location and naming patterns
- **Business logic signals** - Boosts for `.service.ts`, `.handler.ts`, `.controller.ts`
- **Boilerplate penalties** - Reduces rank for `index.ts`, `page.tsx`, `layout.tsx`
- **Session context** - Boosts for previously viewed files

## CLI Reference

### Search Command

```bash
mantic <query> [options]
```

**Output Formats:**
- `--json` - Structured JSON with scores and metadata (default)
- `--files` - Newline-separated file paths
- `--mcp` - Model Context Protocol format

**Advanced Features:**
- `--impact` - Include dependency graph and blast radius analysis
- `--session <id>` - Use session for context carryover

## Model Context Protocol (MCP)

Mantic provides an MCP server for integration with Claude Desktop and other MCP clients.

### Setup
- [**Install on Cursor**](https://cursor.com/en/install-mcp?name=mantic&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1hbnRpYy5zaEBsYXRlc3QiLCJzZXJ2ZXIiXX0=)
- [**Install on VS Code**](https://vscode.dev/redirect/mcp/install?name=mantic&config=%7B%22type%22%3A%20%22stdio%22%2C%20%22command%22%3A%20%22npx%22%2C%20%22args%22%3A%20%5B%22-y%22%2C%20%22mantic.sh%40latest%22%2C%20%22server%22%5D%7D)

### Manual Setup (Claude Desktop)
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mantic": {
      "command": "npx",
      "args": ["-y", "mantic.sh@latest", "server"]
    }
  }
}
```

## Performance Optimization

Mantic is optimized for speed:
- **Metadata-only scoring** - No file reads during ranking
- **Parallel I/O** - Concurrent file stat operations
- **Smart caching** - Reuses previous scan results
- **Intent-based filtering** - Reduces search space based on query type

## Supported Project Types

Mantic automatically detects and optimizes for:
- TypeScript/JavaScript (Next.js, React, Node.js)
- Python, Go, Rust

## License

**AGPL-3.0**

Mantic is open source software.

- **Free for individuals**: You can use it freely for personal projects.
- **Free for internal business use**: Companies can use it internally without cost.
- **Commercial Usage**: If you embed Mantic in a commercial product (SaaS, AI agent, dev tool) or distribute it, you must either:
    1.  Open source your code under AGPL-3.0.
    2.  Purchase a commercial license (contact: license@mantic.sh).

## Built For

The machine-first era of coding. Built by developers, for AI agents.
