/**
 * Canonical File Analyzer
 * Detects when search results include both canonical (implementation) and derivative (test/docs) files
 * Provides warnings to help agents focus on the right files
 */

import { isCanonical, getBaseName, findCanonicalPaths, classifyFile } from './file-classifier.js';

export interface CanonicalWarning {
    type: 'duplicate_test' | 'duplicate_docs' | 'prefer_canonical';
    message: string;
    derivativeFile: string;
    canonicalFile?: string;
}

export interface CanonicalAnalysis {
    warnings: CanonicalWarning[];
    hasNonCanonical: boolean;
    canonicalCount: number;
    derivativeCount: number;
}

/**
 * Analyze a list of files for canonical duplicates
 * Returns warnings when both implementation and test/docs are present
 */
export function analyzeCanonicalDuplicates(
    files: Array<{ path: string; score: number }>,
    allFiles: string[]
): CanonicalAnalysis {
    const warnings: CanonicalWarning[] = [];
    const filesByBaseName = new Map<string, Array<{ path: string; score: number; isCanonical: boolean }>>();

    let canonicalCount = 0;
    let derivativeCount = 0;

    // Group files by base name
    for (const file of files) {
        const baseName = getBaseName(file.path);
        const canonical = isCanonical(file.path);

        if (canonical) {
            canonicalCount++;
        } else {
            derivativeCount++;
        }

        if (!filesByBaseName.has(baseName)) {
            filesByBaseName.set(baseName, []);
        }

        filesByBaseName.get(baseName)!.push({
            path: file.path,
            score: file.score,
            isCanonical: canonical
        });
    }

    // Detect duplicates and generate warnings
    for (const [baseName, group] of filesByBaseName.entries()) {
        if (group.length < 2) continue; // No duplicates

        const canonicalFiles = group.filter(f => f.isCanonical);
        const testFiles = group.filter(f => !f.isCanonical && classifyFile(f.path) === 'test');
        const docFiles = group.filter(f => !f.isCanonical && classifyFile(f.path) === 'docs');

        // Warn about test duplicates
        if (canonicalFiles.length > 0 && testFiles.length > 0) {
            for (const testFile of testFiles) {
                warnings.push({
                    type: 'duplicate_test',
                    message: `Found test file "${testFile.path}" with implementation in "${canonicalFiles[0].path}" - prefer implementation for logic queries`,
                    derivativeFile: testFile.path,
                    canonicalFile: canonicalFiles[0].path
                });
            }
        }

        // Warn about doc duplicates
        if (canonicalFiles.length > 0 && docFiles.length > 0) {
            for (const docFile of docFiles) {
                warnings.push({
                    type: 'duplicate_docs',
                    message: `Found documentation "${docFile.path}" with implementation in "${canonicalFiles[0].path}" - prefer implementation for code queries`,
                    derivativeFile: docFile.path,
                    canonicalFile: canonicalFiles[0].path
                });
            }
        }

        // Warn if only derivative files found (no canonical)
        if (canonicalFiles.length === 0 && (testFiles.length > 0 || docFiles.length > 0)) {
            const derivative = testFiles[0] || docFiles[0];
            const possibleCanonical = findCanonicalPaths(derivative.path, allFiles);

            if (possibleCanonical.length > 0) {
                warnings.push({
                    type: 'prefer_canonical',
                    message: `Found derivative file "${derivative.path}" - consider also checking "${possibleCanonical[0]}" for implementation`,
                    derivativeFile: derivative.path,
                    canonicalFile: possibleCanonical[0]
                });
            }
        }
    }

    return {
        warnings,
        hasNonCanonical: derivativeCount > 0,
        canonicalCount,
        derivativeCount
    };
}

/**
 * Filter out derivative files when canonical versions exist
 * Returns a deduplicated list with canonical files preferred
 */
export function deduplicateResults(
    files: Array<{ path: string; score: number }>
): Array<{ path: string; score: number; replacedBy?: string }> {
    const filesByBaseName = new Map<string, Array<{ path: string; score: number; isCanonical: boolean }>>();

    // Group by base name
    for (const file of files) {
        const baseName = getBaseName(file.path);
        const canonical = isCanonical(file.path);

        if (!filesByBaseName.has(baseName)) {
            filesByBaseName.set(baseName, []);
        }

        filesByBaseName.get(baseName)!.push({
            path: file.path,
            score: file.score,
            isCanonical: canonical
        });
    }

    const result: Array<{ path: string; score: number; replacedBy?: string }> = [];

    // For each group, prefer canonical files
    for (const group of filesByBaseName.values()) {
        const canonicalFiles = group.filter(f => f.isCanonical);
        const derivativeFiles = group.filter(f => !f.isCanonical);

        if (canonicalFiles.length > 0) {
            // Add canonical files
            for (const canonical of canonicalFiles) {
                result.push({ path: canonical.path, score: canonical.score });
            }

            // Mark derivative files as replaced
            for (const derivative of derivativeFiles) {
                result.push({
                    path: derivative.path,
                    score: derivative.score,
                    replacedBy: canonicalFiles[0].path
                });
            }
        } else {
            // No canonical files, keep all derivatives
            for (const derivative of derivativeFiles) {
                result.push({ path: derivative.path, score: derivative.score });
            }
        }
    }

    return result;
}
