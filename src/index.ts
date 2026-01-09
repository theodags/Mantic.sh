#!/usr/bin/env node
/**
 * Mantic - Machine-First Code Search
 * Fast context layer for AI agents
 */

import { Command } from 'commander';

const program = new Command();

program
    .name('mantic')
    .description('Mantic: The reference implementation of cognitive code search.')
    .version('1.0.24');

// Main search command (default)
program
    .argument('[query...]', 'Search query')
    .option('-p, --path <dir>', 'Restrict search to specific path')
    .option('-q, --quiet', 'Minimal output')
    .option('--json', 'Output as JSON (default)')
    .option('--files', 'Output file paths only')
    .option('--markdown', 'Output as Markdown')
    .option('--mcp', 'Output in MCP format')
    // Context Filters
    .option('--code', 'Only code files')
    .option('--config', 'Only config files')
    .option('--test', 'Only test files')
    .option('--include-generated', 'Include generated files (.lock, .log, dist/)')
    // Impact Analysis
    .option('--impact', 'Include impact analysis (blast radius, dependents)')
    // Session Memory
    .option('--session <id>', 'Use active session for context carryover')
    .action(async (queryParts, options) => {
        const query = queryParts.join(' ');

        // Allow empty query for zero-query mode
        // if (!query) {
        //     console.error('Error: Query required');
        //     console.error('Usage: mantic <query> [options]');
        //     console.error('Example: mantic "stripe payment" --code --json');
        //     console.error('Tip: Run "mantic" with no arguments to see your current context');
        //     process.exit(1);
        // }

        // Default to JSON output (machine-first)
        if (!options.json && !options.files && !options.markdown && !options.mcp) {
            options.json = true;
        }

        const { processRequest } = await import('./process-request.js');
        await processRequest(query, options);
        process.exit(0);
    });

// Session management commands
const session = program.command('session').description('Manage agent sessions');

session
    .command('start')
    .argument('[name]', 'Session name (optional)')
    .option('-i, --intent <text>', 'Session intent/goal')
    .description('Start a new session')
    .action(async (name, options) => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());
        const newSession = await sm.startSession(name || `session-${Date.now()}`, options.intent);
        console.log(JSON.stringify({
            sessionId: newSession.metadata.id,
            name: newSession.metadata.name,
            intent: newSession.metadata.intent,
            created: newSession.metadata.created
        }, null, 2));
    });

session
    .command('list')
    .description('List all sessions')
    .action(async () => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());
        const sessions = await sm.listSessions();

        if (sessions.length === 0) {
            console.log('No sessions found.');
            return;
        }

        console.log(JSON.stringify(sessions.map(s => ({
            sessionId: s.id,
            name: s.name,
            intent: s.intent,
            created: s.created,
            lastActive: s.lastActive,
            queryCount: s.queryCount,
            status: s.status
        })), null, 2));
    });

session
    .command('info')
    .argument('<sessionId>', 'Session ID')
    .description('Get session details')
    .action(async (sessionId) => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());
        const loadedSession = await sm.loadSession(sessionId);

        if (!loadedSession) {
            console.error(`Session not found: ${sessionId}`);
            process.exit(1);
        }

        console.log(JSON.stringify({
            metadata: loadedSession.metadata,
            viewedFiles: Array.from(loadedSession.viewedFiles.entries()).map(([path, data]) => ({
                path,
                viewCount: data.viewCount,
                lastViewed: data.lastViewed,
                relevanceScore: data.relevanceScore,
                blastRadius: data.blastRadius,
                notes: data.notes
            })),
            queryHistory: loadedSession.queryHistory,
            insights: loadedSession.insights
        }, null, 2));
    });

session
    .command('end')
    .argument('[sessionId]', 'Session ID (uses current if not specified)')
    .description('End a session')
    .action(async (sessionId) => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());

        if (sessionId) {
            const loadedSession = await sm.loadSession(sessionId);
            if (!loadedSession) {
                console.error(`Session not found: ${sessionId}`);
                process.exit(1);
            }
        }

        await sm.endSession();
        console.log(`Session ended: ${sessionId || 'current'}`);
    });

// MCP Server command
program
    .command('server')
    .description('Start the MCP server')
    .action(async () => {
        const { runServer } = await import('./mcp-server.js');
        await runServer();
    });

program.parse();
