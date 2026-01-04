import { ContextResult, ProjectContext, IntentAnalysis } from './types.js';
import { ScoredFile } from './smart-filter.js';
import { analyzeCanonicalDuplicates } from './canonical-analyzer.js';
import { extractEntities } from './entity-extractor.js';
import { validateEntities } from './entity-validator.js';

/**
 * Build a ContextResult from project scanning results
 * This is the universal output format for Mantic
 */
export function buildContextResult(
    query: string,
    intentAnalysis: IntentAnalysis,
    scoredFiles: ScoredFile[],
    projectContext: ProjectContext,
    scanTimeMs: number
): ContextResult {
    // Analyze for canonical duplicates
    const canonicalAnalysis = analyzeCanonicalDuplicates(
        scoredFiles.map(f => ({ path: f.path, score: f.score })),
        projectContext.fileStructure
    );

    // Extract and validate entities for hallucination detection
    const entities = extractEntities(query);
    const validation = validateEntities(
        entities,
        projectContext.fileStructure,
        null // TODO: Pass cache when available
    );

    // Combine canonical warnings with entity validation warnings
    const allWarnings = [
        ...canonicalAnalysis.warnings,
        ...validation.warnings.map(w => ({
            type: w.type,
            message: w.message,
            entity: w.entity,
            suggestions: w.suggestions
        }))
    ];

    // Calculate validation summary
    const totalEntities = entities.files.length + entities.functions.length +
        entities.classes.length + entities.components.length;
    const totalFound = validation.foundEntities.files.length +
        validation.foundEntities.functions.length +
        validation.foundEntities.classes.length +
        validation.foundEntities.components.length;

    return {
        query,
        intent: {
            category: intentAnalysis.category,
            confidence: intentAnalysis.confidence,
            keywords: intentAnalysis.keywords
        },
        files: scoredFiles.map(file => ({
            path: file.path,
            relevanceScore: file.score,
            matchReasons: file.matchedConstraints,
            excerpts: file.matchedLines?.map(line => ({
                line: line.line,
                content: line.content,
                matchedKeyword: line.keyword
            })),
            metadata: file.metadata // Pass through progressive disclosure metadata
        })),
        metadata: {
            projectType: projectContext.metadata?.projectType || 'unknown',
            techStack: projectContext.techStack,
            totalScanned: projectContext.fileStructure.length,
            filesReturned: scoredFiles.length,
            timeMs: scanTimeMs,
            hasGitChanges: (projectContext.gitState?.length || 0) > 0
        },
        gitState: projectContext.gitState,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
        validation: totalEntities > 0 ? {
            isValid: validation.isValid,
            entityCount: totalEntities,
            foundCount: totalFound
        } : undefined
    };
}
