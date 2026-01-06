# Mantic

[![npm version](https://img.shields.io/npm/v/mantic.sh.svg?style=flat-square)](https://www.npmjs.com/package/mantic.sh)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=mantic&config=eyJ0eXBlIjogInN0ZGlvIiwgImNvbW1hbmQiOiAibnB4IiwgImFyZ3MiOiBbIi15IiwgIm1hbnRpYy5zaEBsYXRlc3QiLCAic2VydmVyIl19)
[![Install in VS Code](https://img.shields.io/badge/VS%20Code-Install-007ACC?style=flat-square&logo=visual-studio-code&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=mantic&config=%7B%22type%22%3A%20%22stdio%22%2C%20%22command%22%3A%20%22npx%22%2C%20%22args%22%3A%20%5B%22-y%22%2C%20%22mantic.sh%40latest%22%2C%20%22server%22%5D%7D)
[![Agent Rules](https://img.shields.io/badge/Agent%20Rules-Copy%20Config-8A2BE2?style=flat-square&logo=robot&logoColor=white)](https://github.com/marcoaapfortes/Mantic.sh/blob/main/AGENT_RULES.md)

A structural code search engine for AI agents. Provides sub-500ms file ranking across massive codebases without embeddings, vector databases, or external dependencies.

## What's New in v1.0.6 🚀

- **Git Accelerator**: Replaced file walker with direct `git ls-files` integration.
- **14x Performance Boost**: Chromium repo scan improved from ~6.6s to **0.46s**.
- **Smart Heuristics**: optimized untracked file scanning for massive repositories.

## Table of Contents

- [About the Project](#about-the-project)
- [Proprietary vs Mantic](#proprietary-vs-mantic-cost-analysis)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Agent Rules](#agent-rules-auto-pilot)
- [Performance](#performance)
- [How It Works](#how-it-works)
- [License](#license)

## About the Project

Mantic is an infrastructure layer designed to remove unnecessary context retrieval overhead for AI agents. It infers intent from file structure and metadata rather than brute-force reading content, enabling retrieval speeds faster than human reaction time.

### Key Benefits

- **Speed**: Retrieval is consistently under 500ms, even for large repositories.
- **Efficiency**: Reduces token usage by up to 63% by filtering irrelevant files before reading.
- **Privacy**: Runs entirely locally with zero data egress.

### Proprietary vs Mantic (Cost Analysis)

For a team of 100 developers performing 100 searches per day:

| Tool | Annual Cost | Per-Search Cost | Privacy |
|------|---|---|---|
| **Mantic** | **$0** | **$0** | **Local-First** |
| Vector Embeddings | $10,950 | $0.003 | Cloud |
| SaaS Alternatives | $109,500 | $0.003 | Cloud |

## Features

- **Sub-500ms retrieval** on large monorepos (Chromium: 480k files).
- **Zero external dependencies** (no API keys, no databases).
- **Git-native file scanning** (prioritizes tracked files).
- **Deterministic scoring** (consistent, predictable results).
- **Native MCP support** (works with Claude Desktop, Cursor).
- **Impact analysis** (identifies potential blast radius of changes).

## Installation

### Quick Start

```bash
# Run without installation
npx mantic.sh@latest "your search query"
```

**Install for Tools:**
- [Install in Cursor](https://cursor.com/en/install-mcp?name=mantic&config=eyJ0eXBlIjogInN0ZGlvIiwgImNvbW1hbmQiOiAibnB4IiwgImFyZ3MiOiBbIi15IiwgIm1hbnRpYy5zaEBsYXRlc3QiLCAic2VydmVyIl19)
- [Install in VS Code](https://vscode.dev/redirect/mcp/install?name=mantic&config=%7B%22type%22%3A%20%22stdio%22%2C%20%22command%22%3A%20%22npx%22%2C%20%22args%22%3A%20%5B%22-y%22%2C%20%22mantic.sh%40latest%22%2C%20%22server%22%5D%7D)

**From Source**:

```bash
git clone https://github.com/marcoaapfortes/Mantic.sh.git
cd Mantic.sh
npm install
npm run build
npm link
```

## Usage

### Basic Search

Find files matching your intent:

```bash
mantic "stripe payment integration"
```
*Returns JSON with ranked files, confidence scores, and token estimates.*

### CLI Options

```bash
mantic <query> [options]

Options:
  --code          Only search code files (.ts, .js, etc)
  --config        Only search config files
  --test          Only search test files
  --json          Output as JSON (default)
  --files         Output as newline-separated file paths
  --impact        Include dependency analysis
  --session <id>  Use session for context carryover
```

## Agent Rules (Auto-Pilot)

Want Cursor or Claude to use Mantic automatically?

1. Copy the [Agent Rules](AGENT_RULES.md).
2. Paste them into your AI tool's system prompt or "Rules for AI" section.
3. The Agent will now automatically use `mantic` to find context before writing code.

## Performance

### Latency Benchmarks (M1 Pro)

| Codebase | Files | Size | Mantic | Vector Search | Improvement |
|----------|-------|------|--------|---|---|
| Cal.com | 9,621 | ~500MB | 0.32s | 0.85s | **2.7x faster** |
| Chromium | 480,000 | 59GB | 0.46s | 5-10s | **11-22x faster** |

## How It Works

### Architecture Overview

```
User Query
    ↓
Intent Analyzer (categorizes: UI/backend/auth/etc)
    ↓
Brain Scorer (ranks files using metadata)
    ↓
File Classifier (filters by type: code/config/test)
    ↓
Impact Analyzer (calculates blast radius)
    ↓
Output (JSON/Files/Markdown/MCP)
```

### Core Algorithm

1. **Intent Recognition**: Analyzes query to determine code category (e.g., "auth", "ui").
2. **File Enumeration**: Uses `git ls-files` for tracked files (significantly faster than standard traversals).
3. **Structural Scoring**: Ranks files based on:
   - **Path relevance**: `packages/features/payments` indicates high signal.
   - **Filename matching**: `stripe.service.ts` > `stripe.txt`.
   - **Business logic awareness**: `.service.ts` boosted over `.test.ts`.
   - **Boilerplate penalties**: `index.ts` or `page.tsx` ranked lower to reduce noise.
4. **Confidence Scoring**: Assigns a relevance score to each result.

## Configuration

Mantic works out of the box with zero configuration for most projects.

### Environment Variables

```bash
MANTIC_MAX_FILES=5000        # Maximum files to scan
MANTIC_TIMEOUT=5000          # Search timeout in ms
MANTIC_IGNORE_PATTERNS=...   # Custom glob patterns to ignore
```

## License

Mantic is licensed under the **AGPL-3.0 License**.

### Usage Guidelines

- **Free for:** Individual developers, open source projects, and internal business use.
- **License required for:** Commercial embedding in products you sell or offering Mantic as a hosted service.

**Commercial Inquiries:** [license@mantic.sh](mailto:license@mantic.sh)

See [LICENSE](LICENSE) file for full details.
