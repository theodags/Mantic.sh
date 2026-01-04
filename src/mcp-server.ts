#!/usr/bin/env node
/**
 * Mantic MCP Server
 * Exposes Mantic's fast file search as MCP tools for Claude Desktop
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import path from 'path';

// Zod schemas for tool inputs
const SearchFilesSchema = z.object({
  query: z.string().describe('Search query or intent (e.g., "authentication logic", "stripe payment")'),
  cwd: z.string().optional().describe('Working directory to search in (defaults to current directory)'),
  filter: z.enum(['code', 'config', 'test', 'all']).optional().default('code').describe('File type filter'),
  maxResults: z.number().optional().default(20).describe('Maximum number of files to return (default: 20)'),
  includeImpact: z.boolean().optional().default(false).describe('Include impact analysis (blast radius, dependents)'),
});

const AnalyzeIntentSchema = z.object({
  query: z.string().describe('Natural language query to analyze'),
});

const SessionStartSchema = z.object({
  name: z.string().optional().describe('Session name (auto-generated if not provided)'),
  intent: z.string().optional().describe('Session intent/goal (e.g., "fix authentication bug")'),
  cwd: z.string().optional().describe('Working directory (defaults to current directory)'),
});

const SessionListSchema = z.object({
  cwd: z.string().optional().describe('Working directory (defaults to current directory)'),
});

const SessionInfoSchema = z.object({
  sessionId: z.string().describe('Session ID to get info for'),
  cwd: z.string().optional().describe('Working directory (defaults to current directory)'),
});

const SessionEndSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to end (uses current session if not provided)'),
  cwd: z.string().optional().describe('Working directory (defaults to current directory)'),
});

const SessionRecordViewSchema = z.object({
  sessionId: z.string().describe('Session ID'),
  files: z.array(z.object({
    path: z.string(),
    viewed: z.boolean(),
    modified: z.boolean().optional(),
  })).describe('Files viewed or modified'),
  cwd: z.string().optional().describe('Working directory (defaults to current directory)'),
});

// Create MCP server instance
const server = new Server(
  {
    name: 'mantic',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const TOOLS = [
  {
    name: 'search_files',
    description:
      'Fast code search that finds the most relevant files for a given query. ' +
      'Uses brain-inspired scoring to prioritize business logic over boilerplate. ' +
      'Returns file paths with relevance scores, metadata, and optional impact analysis. ' +
      'Perfect for finding where specific functionality is implemented and understanding ' +
      'blast radius before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query or intent (e.g., "authentication logic", "stripe payment")',
        },
        cwd: {
          type: 'string',
          description: 'Working directory to search in (defaults to current directory)',
        },
        filter: {
          type: 'string',
          enum: ['code', 'config', 'test', 'all'],
          description: 'File type filter: code (default), config, test, or all',
          default: 'code',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of files to return (default: 20)',
          default: 20,
        },
        includeImpact: {
          type: 'boolean',
          description: 'Include impact analysis showing blast radius and dependents (default: false)',
          default: false,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'analyze_intent',
    description:
      'Analyze a natural language query to understand intent category and extract keywords. ' +
      'Returns the detected category (UI, backend, auth, etc.), confidence score, and extracted keywords. ' +
      'Useful for understanding what kind of code changes are being requested.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query to analyze',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'session_start',
    description:
      'Start a new agent session for tracking context across multiple queries. ' +
      'Sessions enable context carryover - files viewed in the session are boosted in future searches. ' +
      'Returns session ID and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Session name (auto-generated if not provided)',
        },
        intent: {
          type: 'string',
          description: 'Session intent/goal (e.g., "fix authentication bug")',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (defaults to current directory)',
        },
      },
    },
  },
  {
    name: 'session_list',
    description:
      'List all agent sessions in the current project. ' +
      'Returns session metadata including ID, name, intent, query count, and files viewed.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Working directory (defaults to current directory)',
        },
      },
    },
  },
  {
    name: 'session_info',
    description:
      'Get detailed information about a specific session. ' +
      'Returns full session data including viewed files, query history, and insights.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID to get info for',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (defaults to current directory)',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'session_end',
    description:
      'End an agent session and persist its data. ' +
      'Sessions should be ended when the task is complete to free up resources.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID to end (uses current session if not provided)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (defaults to current directory)',
        },
      },
    },
  },
  {
    name: 'session_record_view',
    description:
      'Record files viewed or modified during a session. ' +
      'This enables context carryover - viewed files will be boosted in subsequent searches.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              viewed: { type: 'boolean' },
              modified: { type: 'boolean' },
            },
            required: ['path', 'viewed'],
          },
          description: 'Files viewed or modified',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (defaults to current directory)',
        },
      },
      required: ['sessionId', 'files'],
    },
  },
];

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_files': {
        const { query, cwd, filter, maxResults, includeImpact } = SearchFilesSchema.parse(args);

        const workDir = cwd || process.cwd();

        // Build Mantic CLI command - use JSON mode for rich metadata
        const ppPath = path.join(__dirname, 'index.js');
        let cmd = `node "${ppPath}" "${query}" --json`;

        // Add filter flag
        if (filter === 'code') cmd += ' --code';
        else if (filter === 'config') cmd += ' --config';
        else if (filter === 'test') cmd += ' --test';

        // Add impact analysis flag
        if (includeImpact) cmd += ' --impact';

        // Execute and capture output
        const output = execSync(cmd, {
          cwd: workDir,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 30000, // 30s timeout
          env: { ...process.env, NO_COLOR: '1' }, // Disable colored output
        });

        // Parse JSON output
        const result = JSON.parse(output);
        const files = result.files.slice(0, maxResults);

        if (files.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No files found matching query: "${query}"`,
              },
            ],
          };
        }

        // Format results with progressive disclosure metadata
        const resultLines = [
          `Found ${files.length} relevant files for "${query}":`,
          '',
          `Intent: ${result.intent.category} (${Math.round(result.intent.confidence * 100)}% confidence)`,
          `Keywords: ${result.intent.keywords.join(', ')}`,
          '',
        ];

        // Add file results with rich metadata
        files.forEach((file: any, idx: number) => {
          resultLines.push(`${idx + 1}. ${file.path}`);
          resultLines.push(`   Score: ${file.relevanceScore}`);

          if (file.metadata) {
            const meta = file.metadata;
            resultLines.push(`   Size: ${meta.sizeBytes} bytes (~${meta.lines} lines, ~${meta.estimatedTokens} tokens)`);
            resultLines.push(`   Confidence: ${Math.round((meta.confidence || 0) * 100)}%`);
            resultLines.push(`   Modified: ${new Date(meta.lastModified).toLocaleString()}`);
          }

          if (file.matchReasons.length > 0) {
            resultLines.push(`   Reasons: ${file.matchReasons.join(', ')}`);
          }

          // Impact analysis (if requested)
          if (file.impact) {
            const imp = file.impact;
            resultLines.push(`   Impact: ${imp.blastRadius.toUpperCase()} (score: ${imp.score})`);
            resultLines.push(`   Dependents: ${imp.directDependents} direct, ${imp.indirectDependents} indirect`);
            if (imp.relatedTests > 0) {
              resultLines.push(`   Tests: ${imp.relatedTests} related`);
            }
            if (imp.warnings.length > 0) {
              resultLines.push(`   ⚠️  ${imp.warnings.join('; ')}`);
            }
          }

          resultLines.push('');
        });

        resultLines.push(`Filter: ${filter} | Working directory: ${workDir}`);
        resultLines.push(`Scanned ${result.metadata.totalScanned} files in ${result.metadata.timeMs}ms`);

        return {
          content: [
            {
              type: 'text',
              text: resultLines.join('\n'),
            },
          ],
        };
      }

      case 'analyze_intent': {
        const { query } = AnalyzeIntentSchema.parse(args);

        // Use Mantic's intent analyzer directly
        const { IntentAnalyzer } = await import('./intent-analyzer.js');
        const analyzer = new IntentAnalyzer();
        const result = await analyzer.analyze(query);

        const analysisText = [
          `Intent Analysis for: "${query}"`,
          '',
          `Category: ${result.category}`,
          `Confidence: ${Math.round(result.confidence * 100)}%`,
          `Keywords: ${result.keywords.join(', ')}`,
          result.subCategory ? `Sub-category: ${result.subCategory}` : '',
        ].filter(Boolean).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: analysisText,
            },
          ],
        };
      }

      case 'session_start': {
        const { name, intent, cwd } = SessionStartSchema.parse(args);
        const workDir = cwd || process.cwd();

        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(workDir);
        const session = await sm.startSession(name || `session-${Date.now()}`, intent);

        const resultText = [
          `Session started successfully!`,
          '',
          `Session ID: ${session.metadata.id}`,
          `Name: ${session.metadata.name}`,
          intent ? `Intent: ${session.metadata.intent}` : '',
          `Created: ${new Date(session.metadata.created).toLocaleString()}`,
          '',
          `Use this session ID in search_files queries to enable context carryover.`,
        ].filter(Boolean).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: resultText,
            },
          ],
        };
      }

      case 'session_list': {
        const { cwd } = SessionListSchema.parse(args);
        const workDir = cwd || process.cwd();

        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(workDir);
        const sessions = await sm.listSessions();

        if (sessions.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No sessions found.',
              },
            ],
          };
        }

        const resultLines = [`Found ${sessions.length} session(s):`, ''];
        sessions.forEach((s, idx) => {
          resultLines.push(`${idx + 1}. ${s.name} (${s.id})`);
          if (s.intent) resultLines.push(`   Intent: ${s.intent}`);
          resultLines.push(`   Created: ${new Date(s.created).toLocaleString()}`);
          resultLines.push(`   Queries: ${s.queryCount}`);
          resultLines.push('');
        });

        return {
          content: [
            {
              type: 'text',
              text: resultLines.join('\n'),
            },
          ],
        };
      }

      case 'session_info': {
        const { sessionId, cwd } = SessionInfoSchema.parse(args);
        const workDir = cwd || process.cwd();

        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(workDir);
        const session = await sm.loadSession(sessionId);

        if (!session) {
          return {
            content: [
              {
                type: 'text',
                text: `Session not found: ${sessionId}`,
              },
            ],
            isError: true,
          };
        }

        const resultLines = [
          `Session: ${session.metadata.name} (${session.metadata.id})`,
          '',
          `Created: ${new Date(session.metadata.created).toLocaleString()}`,
          `Last Active: ${new Date(session.metadata.lastActive).toLocaleString()}`,
          `Total Queries: ${session.metadata.queryCount}`,
          session.metadata.intent ? `Intent: ${session.metadata.intent}` : '',
          '',
          `Viewed Files (${session.viewedFiles.size}):`,
        ];

        Array.from(session.viewedFiles.entries()).forEach(([path, data]) => {
          resultLines.push(`  - ${path} (viewed ${data.viewCount}x, score: ${data.relevanceScore})`);
        });

        if (session.queryHistory.length > 0) {
          resultLines.push('', 'Query History:');
          session.queryHistory.forEach((q, idx) => {
            resultLines.push(`  ${idx + 1}. "${q.query}" (${q.filesReturned} files)`);
          });
        }

        if (session.insights.length > 0) {
          resultLines.push('', 'Insights:');
          session.insights.forEach((insight) => {
            resultLines.push(`  - ${insight}`);
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: resultLines.filter(Boolean).join('\n'),
            },
          ],
        };
      }

      case 'session_end': {
        const { sessionId, cwd } = SessionEndSchema.parse(args);
        const workDir = cwd || process.cwd();

        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(workDir);

        if (sessionId) {
          const session = await sm.loadSession(sessionId);
          if (!session) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Session not found: ${sessionId}`,
                },
              ],
              isError: true,
            };
          }
        }

        await sm.endSession();

        return {
          content: [
            {
              type: 'text',
              text: `Session ended: ${sessionId || 'current'}`,
            },
          ],
        };
      }

      case 'session_record_view': {
        const { sessionId, files, cwd } = SessionRecordViewSchema.parse(args);
        const workDir = cwd || process.cwd();

        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(workDir);
        const session = await sm.loadSession(sessionId);

        if (!session) {
          return {
            content: [
              {
                type: 'text',
                text: `Session not found: ${sessionId}`,
              },
            ],
            isError: true,
          };
        }

        // Transform files to include relevanceScore (default to 50 if not provided)
        const filesToRecord = files
          .filter(f => f.viewed)
          .map(f => ({
            path: f.path,
            relevanceScore: 50, // Default score for MCP-recorded views
            blastRadius: undefined as 'small' | 'medium' | 'large' | 'critical' | undefined,
          }));

        await sm.recordFileViews(filesToRecord);

        return {
          content: [
            {
              type: 'text',
              text: `Recorded ${filesToRecord.length} file view(s) in session ${sessionId}`,
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    // Log to stderr (safe for STDIO transport)
    console.error(`Error executing tool ${name}:`, error);

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
export async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (STDIO servers must use stderr for logging)
  console.error('Mantic MCP Server running on stdio');
  console.error('Available tools: search_files, analyze_intent, session_start, session_list, session_info, session_end, session_record_view');
}

// Only run if called directly
if (require.main === module) {
  runServer().catch((error) => {
    console.error('Fatal error in MCP server:', error);
    process.exit(1);
  });
}
