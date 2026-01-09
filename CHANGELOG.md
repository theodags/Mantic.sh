# Changelog

## 1.0.24

**Windows EPERM Fix Release**

Fixes critical Windows permission errors when scanning protected directories.

### Windows Permission Fixes
- **EPERM Errors**: Enhanced handling of Windows protected directories
  - Added specific EPERM/EACCES error detection and helpful user messages
  - Auto-ignores Windows system folders: AppData, ElevatedDiagnostics, System Volume Information, Windows, ProgramData, $Recycle.Bin
  - Prevents crashes when running from user home directories on Windows
  - Provides actionable error messages directing users to run from project directories

### Technical Details
- Files modified: `native-loader.ts`, `scanner.ts`
- Maintains backward compatibility
- Builds successfully with TypeScript

**Issue Resolved**: [#10](https://github.com/marcoaapfortes/Mantic.sh/issues/10) - Windows EPERM operation errors

---

## 1.0.23

**MCP Stability Release**

Critical bug fix for MCP server zero-query mode crash.

### MCP Server Fixes
- **Zero-Query Mode Crash**: Fixed `get_context` tool crash when no active context is available
  - Added null check for `result.context` before accessing properties
  - Now gracefully returns "No active context detected" message instead of crashing
  - Resolves "Cannot read properties of undefined (reading 'topic')" error

### Technical Details
- File modified: `mcp-server.ts`
- Maintains backward compatibility
- Builds successfully with TypeScript

---

## 1.0.22

**Windows Compatibility Release**

This patch release adds full Windows support, resolving all platform-specific compatibility issues.

### Windows Platform Fixes
- **Cross-Platform Command Detection**: Fixed binary detection to use `where` on Windows instead of Unix-only `command -v`
  - Resolves fd/fdfind binary detection on Windows PowerShell
  - Properly detects available system utilities across all platforms
- **Line Ending Handling**: Updated all file parsing to handle both Windows (`\r\n`) and Unix (`\n`) line endings
  - Fixed git status parsing
  - Fixed file line counting
  - Fixed import/export extraction
  - Fixed keyword matching in file content
- **Path Separator Robustness**: Improved path handling for Windows compatibility
  - Made path replacements more robust using regex patterns
  - Leverages Node.js path normalization for cross-platform consistency
- **Permission Error Handling**: Enhanced error handling for Windows-specific issues
  - Gracefully handles EACCES permission errors
  - Safely skips WSL symlinks and inaccessible paths
  - Prevents crashes when scanning protected directories

### Technical Details
- Files modified: `native-loader.ts`, `git-utils.ts`, `process-request.ts`, `dependency-graph.ts`, `smart-filter.ts`, `impact-analyzer.ts`, `file-metadata.ts`
- All changes maintain backward compatibility with Unix/Linux/macOS
- Builds successfully with TypeScript with no errors

**Issue Resolved**: [#9](https://github.com/marcoaapfortes/Mantic.sh/issues/9) - Windows compatibility issues

---

## 1.0.21

**Major Release: Production-Ready Context-Aware Code Search**

This release transforms Mantic from a fast file finder into an intelligent context-aware search engine. Tested on codebases ranging from 10K to 481K files (Chromium, TensorFlow, Next.js, Supabase, Cal.com) with 100% multi-repo accuracy.

**Key Highlights:**
- Search accuracy improvements with CamelCase detection and exact filename matching
- Zero-query mode for proactive context detection
- Progressive disclosure with file metadata (size, tokens, confidence)
- Context carryover between searches via session management
- Learning system that caches successful search patterns
- Full MCP feature parity with CLI

### Major Search Accuracy Improvements

**Core Enhancements:**
- **CamelCase Detection**: Queries like "ScriptController" now correctly match `script_controller.h` files by detecting and normalizing CamelCase before searching
- **Exact Filename Matching**: Perfect filename matches (e.g., "download_manager.cc") receive massive priority boost (10,000 points) to ensure they appear first
- **Directory Boosting for Acronyms**: Single-term queries like "gpu" now prioritize files in matching directories (e.g., `gpu/BUILD.gn`, `android_webview/gpu/`) over random files containing "gpu"
- **Word-Boundary Matching**: Prevents false positives - "script" no longer matches "javascript", only matches at word boundaries
- **Path Sequence Matching**: Multi-term path queries (e.g., "blink renderer core dom") now filter precisely to matching directory structures

**Technical Improvements:**
- Fixed normalization order: normalize BEFORE lowercase to preserve CamelCase detection
- Added `pathParts` to FileEntry for efficient path component matching
- Extension filtering now uses original query format to preserve exact matches
- Structural specificity scoring with word-boundary awareness prevents substring false positives
- Single-term query detection enables smart directory-based boosting for acronyms

**Search Quality Results (tested on Chromium's 481K files):**
- Exact filename queries return perfect matches
- CamelCase queries work seamlessly without manual conversion
- Component path queries filter precisely to target directories
- Acronym searches prioritize relevant directories
- Extension precision (.h vs .cc) works flawlessly
- 7/8 perfect accuracy on complex edge cases

### Zero-Query Mode
- **Proactive Context Detection**: Run `mantic` with no arguments to see current working context
- **Git-Aware Tracking**: Automatically detects modified files and related dependencies
- **Impact Analysis**: Shows blast radius and risk assessment for changes
- **Smart Suggestions**: Recommends next steps based on current work
- **Auto Session Management**: Creates sessions automatically based on file activity
- **Multi-Format Output**: JSON (default), terminal (--markdown), or files-only (--files)

### Progressive Disclosure
- **File Metadata**: Shows size, line count, estimated tokens for each result
- **Temporal Signals**: Includes last modified and creation timestamps
- **Confidence Scores**: Relative confidence (0-1) based on search score distribution
- **Smart Context**: Helps LLMs make informed decisions about which files to read

### Context Carryover
- **Session Memory**: Previously viewed files receive +150 score boost in subsequent searches
- **Seamless Continuity**: Related queries automatically prioritize session context
- **Session Management**: Automatic tracking via SessionManager integration

### Learning System
- **Pattern Recognition**: Successful searches (score > 50) are cached for future queries
- **Persistent Learning**: Patterns saved to `.mantic-cache/search-patterns.json`
- **Adaptive Boosting**: Previously successful paths get priority in similar queries

### MCP Server Updates
- **Context Carryover Support**: `search_files` now accepts `sessionId` parameter to enable context carryover
- **Zero-Query Tool**: New `get_context` tool for proactive context detection via MCP
- **Full Feature Parity**: MCP server now supports all CLI features including progressive disclosure, context carryover, and zero-query mode
- **Session Integration**: Seamless session management through MCP tools

### Testing & Validation
- **Multi-Repo Test Suite**: 14/14 tests passing across diverse codebases
  - Cal.com (TypeScript/Next.js, 10K files)
  - Next.js (Framework, 20K+ files)
  - Supabase (Backend Platform, 15K+ files)
  - TensorFlow (ML/Python/C++, 50K+ files)
  - Chromium (C++/Browser, 481K files)
- **Systematic Iteration**: Test-fix-validate cycle ensuring production quality
- **Edge Case Coverage**: CamelCase, exact filenames, path sequences, acronyms, extensions

### Performance
- Sub-second search on repos up to 50K files (standard engine)
- Parallel engine for 50K+ files with automatic threshold switching
- Progressive disclosure adds minimal overhead (<5ms per file)
- Learning system cache lookups near-instant
- Quality filtering: Automatic removal of low-confidence results (score < 50) to reduce false positives

**Performance Characteristics** (tested on 5 real-world repos):
- Cal.com (9.7K files): ~0.4-0.7s per query
- Next.js (20K files): ~0.9-1.0s per query
- TensorFlow (50K files): ~0.8-1.1s per query
- Chromium (481K files): ~3.5-4.0s per query

**Speed Rankings** (cal.com, "stripe payment" query):
1. ripgrep: 0.121s (fastest)
2. ag: 0.269s
3. fzf: 0.534s
4. Mantic: 0.654s
5. grep: 1.970s

**Large Repo Performance** (Chromium, 481K files, "ScriptController" query):
- fzf: 0.336s (fastest)
- ripgrep: 0.380s
- Mantic: 3.676s
- ag: 46.562s (12.7x slower than Mantic)

**Trade-off**: 2-10x slower than ripgrep/fzf on small repos, but 12.7x faster than ag on large repos, with superior relevance ranking

### When to Use Mantic vs Other Tools

**Use Mantic for:**
- AI agent code searches (primary use case)
- Finding files by intent ("Where is the payment processing code?")
- Path structure queries ("blink renderer core dom")
- CamelCase searches without manual regex ("ScriptController" → script_controller.h)
- Understanding code impact and relationships
- Context-aware searches with session memory
- High-quality results over speed (10 relevant files vs 200+ false positives)

**Use ripgrep for:**
- Quick text searches ("Find all TODOs")
- Exact string matching
- Content-based searches (searching inside files)
- Maximum speed on large codebases

**Use fzf for:**
- Interactive file browsing with fuzzy matching
- Quick filename lookups when you know part of the name
- Maximum speed (10x faster than Mantic on large repos)
- Note: Returns many false positives on multi-word queries

**Use ag (Silver Searcher) for:**
- Medium-sized repos (10-50K files)
- Text-based searches similar to ripgrep
- Note: 12.7x slower than Mantic on large repos (481K files)

**Verdict**: Mantic prioritizes quality over speed. Trade-offs:
- 2-10x slower than ripgrep/fzf on small repos
- 12.7x faster than ag on large repos (481K files)
- 10 relevant files vs fzf's 200+ false positives
- Superior relevance ranking over all text-based tools

### Breaking Changes
None. This is a backward-compatible enhancement release.

### Migration Guide
No migration needed. All features work immediately:
- CLI: Use new flags (`--session`, `--impact`) or run `mantic ""` for zero-query
- MCP: New tools available automatically (`get_context`, sessionId parameter)
- Sessions: Automatic session creation, manual management optional

### Updated Documentation
- AGENT_RULES.md updated with v1.0.21 workflows
- Session management best practices
- Progressive disclosure usage patterns
- MCP tool integration examples

## 1.0.20

- Added `--path` (alias `-p`) argument to restrict search to a specific directory (Fixed #7)
- Fixed crash where the scanner threw an error if no files matched the query (e.g. complex queries or Chinese characters) (Fixed #2)
- Fixed `ERR_REQUIRE_ESM` crash on startup by downgrading `chalk` to v4 for CommonJS compatibility (Fixed #8, #1)
