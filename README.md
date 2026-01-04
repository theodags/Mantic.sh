# Mantic

**The reference implementation of cognitive code search.**

> "Embeddings are an expensive workaround for missing structure." — *The Mantic Manifesto*

Mantic is the infrastructure layer that removes unnecessary thinking from AI agents. It does not read your code; it infers intent from structure, enabling sub-300ms retrieval without heavy indexing or vector databases.

## The 20-Watt Insight

The human brain does not brute force. It does not embed every line of code it sees. It triages, infers, and prunes aggressively based on structure.

Mantic formalizes this behavior into deterministic infrastructure.

## Features

- **Mantic Signal Extraction** - Zero-read scoring that isolates signal from noise
- **Deterministic Axioms** - Guaranteed consistent outputs via stable sorting
- **Impact Verification** - Understand blast radius before generating code
- **Session Memory** - Context carryover across multi-turn conversations
- **Intent Detection** - Automatically categorizes queries (UI, backend, auth, etc.)
- **Progressive Disclosure** - Rich metadata including size, confidence, and modification dates
- **Hallucination Detection** - Validates that referenced entities actually exist in your codebase
- **Model Context Protocol (MCP)** - Native integration with Claude Desktop and other MCP clients

## Performance

- **Sub-300ms P99 Latency** - Verified on large monorepos (Cal.com, 9k+ files)
- **Zero-Read Determinism** - Stable sorting with tie-breaking for consistent agent outputs
- **Zero external dependencies** - No API keys, no vector DB, no external services
- **6× faster** than embedding-based alternatives

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

# Agent mode (file paths only)
mantic "database models" --files
```

## CLI Reference

### Search Command

```bash
mantic <query> [options]
```

**Options:**

**Output Formats:**
- `--json` - Structured JSON with scores and metadata (default)
- `--files` - Newline-separated file paths
- `--markdown` - Human-readable markdown
- `--mcp` - Model Context Protocol format

**File Filters:**
- `--code` - Only code files (.ts, .js, .tsx, etc.)
- `--config` - Only configuration files
- `--test` - Only test files
- `--include-generated` - Include generated files (excluded by default)

**Advanced Features:**
- `--impact` - Include dependency graph and blast radius analysis
- `--session <id>` - Use session for context carryover

**Other:**
- `-q, --quiet` - Minimal output

### Session Management

Track context across multiple queries for more accurate results:

```bash
# Start a new session
mantic session start debugging-auth --intent "Fix OAuth login flow"

# List all sessions (shows status: active/ended)
mantic session list

# Get session details
mantic session info <session-id>

# End a session
mantic session end <session-id>
```

## Model Context Protocol (MCP)

Mantic provides an MCP server for integration with Claude Desktop and other MCP clients.

### Setup

- [**Install on Cursor**](https://cursor.com/en/install-mcp?name=mantic&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1hbnRpYy5zaCIsInNlcnZlciJdfQ==)
- [**Install on VS Code**](https://vscode.dev/redirect/mcp/install?name=mantic&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mantic.sh%22%2C%22server%22%5D%7D)

### Manual Setup

#### Claude Desktop

1.  **Add to Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
    ```json
    {
      "mcpServers": {
        "mantic": {
          "command": "npx",
          "args": ["-y", "mantic.sh", "server"]
        }
      }
    }
    ```
2.  **Restart Claude Desktop**.

### Cursor

1.  Go to **Cursor Settings** > **Features** > **MCP**.
2.  Click **+ Add New MCP Server**.
3.  Fill in the details:
    -   **Name**: `mantic`
    -   **Type**: `command`
    -   **Command**: `npx -y mantic.sh server`

### VS Code (via Cline or equivalent)

1.  Install the **Cline** extension (or any agent extension that supports MCP).
2.  Open **Cline Settings** > **MCP Servers**.
3.  Add the configured server:
    ```json
    {
      "mantic": {
        "command": "npx",
        "args": ["-y", "mantic.sh", "server"]
      }
    }
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
Formatter → JSON/Files/Markdown/MCP
    ↓
Output
```

### Brain-Inspired Scoring

Files are ranked using a multi-constraint scoring system that considers:

- **Intent matching** - How well the file matches the query intent
- **Path relevance** - File location and naming patterns
- **Business logic signals** - Boosts for `.service.ts`, `.handler.ts`, `.controller.ts`
- **Boilerplate penalties** - Reduces rank for `index.ts`, `page.tsx`, `layout.tsx`
- **File metadata** - Size, modification time, and confidence scores
- **Session context** - Boosts for previously viewed files

### Impact Analysis

When enabled with `--impact`, Mantic analyzes:

- **Direct dependents** - Files that directly import this file
- **Indirect dependents** - Transitive dependency chain
- **Related tests** - Test files that cover this code
- **Blast radius** - Small, Medium, Large, or Critical
- **Warnings** - Potential issues with modifications

### Session Memory

Sessions track file views and query history to provide better results over time:

1. Start a session with an intent
2. Search for files
3. Files you view are tracked
4. Subsequent searches boost previously viewed files
5. End the session when done

## Programmatic Usage

```typescript
import { processRequest } from 'mantic.sh';

// Search with options
const result = await processRequest('stripe payment', {
  json: true,
  code: true,
  impact: true
});

// Parse JSON output
const data = JSON.parse(result);
console.log(data.files); // Array of ranked files with metadata
```

## Project Structure

```
src/
├── index.ts                 # CLI entry point
├── mcp-server.ts           # MCP protocol server
├── process-request.ts      # Request processor
├── intent-analyzer.ts      # Query intent detection
├── brain-scorer.ts         # Brain-inspired ranking
├── impact-analyzer.ts      # Dependency & blast radius
├── session-manager.ts      # Session tracking
├── dependency-graph.ts     # Import/export graph builder
├── file-classifier.ts      # File type classification
├── entity-validator.ts     # Hallucination detection
├── canonical-analyzer.ts   # Canonical file detection
├── file-metadata.ts        # Progressive disclosure
└── types.ts                # TypeScript definitions
```

## Configuration

Mantic works out of the box with zero configuration. All settings are applied via CLI flags.

## Performance Optimization

Mantic is optimized for speed:

- **Metadata-only scoring** - No file reads during ranking
- **Parallel I/O** - Concurrent file stat operations
- **Smart caching** - Reuses previous scan results
- **Lazy parsing** - Only parses files when semantic analysis is needed
- **Intent-based filtering** - Reduces search space based on query type

## Supported Project Types

Mantic automatically detects and optimizes for:

- Next.js applications
- React SPAs
- Vue.js applications
- Node.js/Express APIs
- CLI tools
- TypeScript/JavaScript libraries
- Python projects
- Go projects
- Rust projects

## Requirements

- Node.js 18+
- TypeScript 5+

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

Business Source License 1.1 (BUSL-1.1)
Free for non-commercial use. Commercial use requires a license until 2030, at which point it becomes Apache 2.0.

## Built For

The machine-first era of coding. Built by developers, for AI agents.
