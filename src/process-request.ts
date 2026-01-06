/**
 * Machine-first request processor
 * Supports JSON, file list, markdown, and MCP output formats
 */

import { scanProject } from './scanner.js';
import { buildContextResult } from './context-builder.js';
import { formatAsJSON, formatAsFileList, formatAsMarkdown, formatAsMCP } from './context-formatter.js';
import { classifyFile } from './file-classifier.js';
import { FileType } from './types.js';
import { buildDependencyGraph } from './dependency-graph.js';
import { analyzeMultipleImpacts } from './impact-analyzer.js';

export async function processRequest(userPrompt: string, options: any): Promise<string> {
    const startTime = Date.now();

    // Determine output format
    const outputFormat = options.json ? 'json'
        : options.files ? 'files'
            : options.markdown ? 'markdown'
                : options.mcp ? 'mcp'
                    : 'json'; // Default to JSON for machine-first

    try {
        // PHASE 1: Analyze Intent
        const { IntentAnalyzer } = await import('./intent-analyzer.js');
        const intentAnalyzer = new IntentAnalyzer();
        const intentAnalysis = await intentAnalyzer.analyze(userPrompt);

        // PHASE 2: Scan Project
        // Fast brain scorer (no semantic parsing for machine mode)
        const projectContext = await scanProject(process.cwd(), {
            intentAnalysis,
            parseSemantics: false,
            onProgress: undefined
        });

        const scanTimeMs = Date.now() - startTime;

        // Use real brain scorer scores if available, otherwise fallback
        let scoredFiles = projectContext.scoredFiles?.map((sf) => {
            const fileType = classifyFile(sf.path);
            return {
                path: sf.path,
                score: sf.score,
                matchedConstraints: sf.reasons,
                isImported: false,
                isExported: false,
                fileType,
                matchedLines: projectContext.fileLocations
                    ?.find(fl => fl.path === sf.path)
                    ?.lines?.map(l => ({ line: l.line, content: l.content, keyword: l.keyword })),
                metadata: sf.metadata // Pass through progressive disclosure metadata
            };
        });

        // If scoredFiles is missing, something went wrong in the scanner
        if (!scoredFiles || scoredFiles.length === 0) {
            throw new Error('Scanner failed to produce scored files. This is a bug.');
        }

        // Apply context filters
        const filterType: FileType | null = options.code ? 'code'
            : options.config ? 'config'
                : options.test ? 'test'
                    : null;

        if (filterType) {
            scoredFiles = scoredFiles.filter(f => f.fileType === filterType);
        }

        // Exclude generated files by default (unless --include-generated is specified)
        if (!options.includeGenerated) {
            scoredFiles = scoredFiles.filter(f => f.fileType !== 'generated');
        }

        const contextResult = buildContextResult(
            userPrompt,
            intentAnalysis,
            scoredFiles,
            projectContext,
            scanTimeMs
        );

        // PHASE 3: Impact Analysis (if requested)
        if (options.impact && contextResult.files.length > 0) {
            // Build dependency graph for all project files
            const allFiles = projectContext.fileStructure.filter(
                f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx')
            );

            const graph = await buildDependencyGraph(allFiles, process.cwd());

            // Analyze impact for top files (limit to top 10 to avoid slowdown)
            const topFilePaths = contextResult.files.slice(0, 10).map(f => f.path);
            const impactAnalyses = await analyzeMultipleImpacts(topFilePaths, graph, allFiles);

            // Attach impact analysis to each file in results
            contextResult.files = contextResult.files.map(file => {
                const impact = impactAnalyses.get(file.path);
                if (impact) {
                    return {
                        ...file,
                        impact: {
                            blastRadius: impact.blastRadius,
                            score: impact.score,
                            directDependents: impact.dependents.direct.length,
                            indirectDependents: impact.dependents.indirect.length,
                            relatedTests: impact.dependents.tests.length,
                            warnings: impact.warnings
                        }
                    };
                }
                return file;
            });
        }

        // PHASE 4: Session Recording (if active)
        if (options.session) {
            const { SessionManager } = await import('./session-manager.js');
            const sm = new SessionManager(process.cwd());
            // Try to load session (handles ID or name)
            const session = await sm.loadSession(options.session);
            if (session) {
                await sm.recordQuery(userPrompt, contextResult.files.length);

                // Record file views for context carryover
                await sm.recordFileViews(contextResult.files.map(f => ({
                    path: f.path,
                    relevanceScore: f.relevanceScore,
                    blastRadius: f.impact?.blastRadius
                })));
            }
        }

        // Output in requested format
        let output = '';
        switch (outputFormat) {
            case 'json':
                output = formatAsJSON(contextResult);
                console.log(output);
                return output;

            case 'files':
                output = formatAsFileList(contextResult);
                console.log(output);
                return output;

            case 'markdown':
                output = formatAsMarkdown(contextResult);
                console.log(output);
                return output;

            case 'mcp':
                output = JSON.stringify(formatAsMCP(contextResult), null, 2);
                console.log(output);
                return output;
        }

        return '';

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
