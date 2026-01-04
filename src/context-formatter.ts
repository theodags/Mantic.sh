import { ContextResult } from './types.js';
import chalk from 'chalk';

/**
 * Format context result as JSON (for programmatic access)
 */
export function formatAsJSON(context: ContextResult): string {
    return JSON.stringify(context, null, 2);
}

/**
 * Format context result as simple file list (for piping)
 */
export function formatAsFileList(context: ContextResult): string {
    return context.files.map(f => f.path).join('\n');
}

/**
 * Format context result as Markdown (for documentation)
 */
export function formatAsMarkdown(context: ContextResult): string {
    const lines: string[] = [];

    lines.push(`# Context for: "${context.query}"`);
    lines.push('');

    // Intent section
    lines.push(`## Intent: ${context.intent.category}`);
    lines.push(`**Confidence**: ${Math.round(context.intent.confidence * 100)}%`);
    lines.push(`**Keywords**: ${context.intent.keywords.join(', ')}`);
    lines.push('');

    // Files section
    lines.push(`## Relevant Files (${context.files.length})`);
    lines.push('');

    context.files.forEach((file, index) => {
        lines.push(`### ${index + 1}. \`${file.path}\``);
        lines.push(`**Score**: ${file.relevanceScore}`);
        lines.push(`**Why**: ${file.matchReasons.join(', ')}`);

        if (file.excerpts && file.excerpts.length > 0) {
            lines.push('');
            lines.push('**Relevant sections:**');
            file.excerpts.forEach(excerpt => {
                lines.push(`- Line ${excerpt.line}: \`${excerpt.content}\``);
            });
        }
        lines.push('');
    });

    // Metadata section
    lines.push('## Project Metadata');
    lines.push(`- **Type**: ${context.metadata.projectType}`);
    lines.push(`- **Tech Stack**: ${context.metadata.techStack}`);
    lines.push(`- **Scanned**: ${context.metadata.totalScanned} files in ${context.metadata.timeMs}ms`);

    if (context.gitState) {
        lines.push('');
        lines.push('## Git Changes');
        lines.push('```');
        lines.push(context.gitState);
        lines.push('```');
    }

    return lines.join('\n');
}

/**
 * Format context result for MCP (Model Context Protocol)
 */
export function formatAsMCP(context: ContextResult): any {
    return {
        type: 'resource',
        resource: {
            uri: `mantic://context/${encodeURIComponent(context.query)}`,
            name: context.query,
            mimeType: 'application/json',
            text: JSON.stringify({
                query: context.query,
                intent: context.intent,
                files: context.files.map(f => ({
                    path: f.path,
                    relevance: f.relevanceScore,
                    reasons: f.matchReasons,
                    excerpts: f.excerpts
                })),
                metadata: context.metadata
            }, null, 2)
        }
    };
}

/**
 * Format context result for human-readable terminal output (compact)
 */
export function formatForTerminal(context: ContextResult, showExcerpts: boolean = true): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push(chalk.cyan('⏺ Context Result'));
    lines.push(chalk.dim('⎿') + ' ' + chalk.gray(`Query: "${context.query}"`));
    lines.push(chalk.dim('⎿') + ' ' + chalk.gray(`Intent: ${context.intent.category} (${Math.round(context.intent.confidence * 100)}% confidence)`));
    lines.push('');

    // Files
    lines.push(chalk.cyan(`⏺ Relevant Files (${context.files.length})`));
    context.files.slice(0, 15).forEach((file, index) => {
        const score = file.relevanceScore;
        const scoreColor = score > 100 ? chalk.green : score > 50 ? chalk.yellow : chalk.dim;

        lines.push(chalk.dim('⎿') + '  ' + chalk.bold(file.path) + ' ' + scoreColor(`(${score})`));

        if (showExcerpts && file.excerpts && file.excerpts.length > 0) {
            file.excerpts.slice(0, 2).forEach(excerpt => {
                const preview = excerpt.content.length > 60
                    ? excerpt.content.substring(0, 60) + '...'
                    : excerpt.content;
                lines.push(chalk.dim('    ⎿') + ' ' + chalk.dim(`L${excerpt.line}: ${preview}`));
            });
        }
    });

    if (context.files.length > 15) {
        lines.push(chalk.dim(`... and ${context.files.length - 15} more files`));
    }

    lines.push('');

    // Metadata
    lines.push(chalk.dim(`Scanned ${context.metadata.totalScanned} files in ${context.metadata.timeMs}ms`));
    lines.push('');

    return lines.join('\n');
}
