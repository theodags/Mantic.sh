/**
 * Impact Analyzer
 * Calculates blast radius and change impact for files
 * Answers: "What breaks if I change this file?"
 */

import path from 'path';
import { DependencyGraph, FileNode } from './dependency-graph.js';
import { getBaseName } from './file-classifier.js';

export type BlastRadius = 'small' | 'medium' | 'large' | 'critical';

export interface ImpactAnalysis {
    primary: string;
    dependents: {
        direct: string[];       // Files that directly import the primary
        indirect: string[];     // Files that import the direct dependents
        tests: string[];        // Related test files
        config: string[];       // Related config files
    };
    blastRadius: BlastRadius;
    score: number;  // 0-100 impact score
    warnings: string[];
}

/**
 * Find related test files for a given file
 * Uses naming conventions:
 * - auth.ts → auth.test.ts, auth.spec.ts, __tests__/auth.ts
 * - Button.tsx → Button.test.tsx, Button.spec.tsx
 */
export function findRelatedTests(filepath: string, allFiles: string[]): string[] {
    const baseName = getBaseName(filepath);
    const dir = path.dirname(filepath);
    const ext = path.extname(filepath);

    const testPatterns = [
        // Same directory
        path.join(dir, `${baseName}.test${ext}`),
        path.join(dir, `${baseName}.spec${ext}`),
        path.join(dir, `${baseName}.e2e${ext}`),

        // __tests__ directory
        path.join(dir, '__tests__', `${baseName}${ext}`),
        path.join(dir, '__tests__', `${baseName}.test${ext}`),

        // tests directory (parallel structure)
        filepath.replace('/src/', '/tests/').replace(ext, `.test${ext}`),
        filepath.replace('/lib/', '/tests/').replace(ext, `.test${ext}`),

        // Root tests directory
        path.join('tests', path.basename(filepath, ext) + '.test' + ext),
    ];

    const relatedTests: string[] = [];
    for (const pattern of testPatterns) {
        if (allFiles.includes(pattern)) {
            relatedTests.push(pattern);
        }
    }

    // Also check for files with test in the name that match the base name
    const lowerBaseName = baseName.toLowerCase();
    for (const file of allFiles) {
        if (file.includes('test') || file.includes('spec')) {
            const testBase = getBaseName(file).toLowerCase();
            if (testBase === lowerBaseName || testBase.includes(lowerBaseName)) {
                if (!relatedTests.includes(file)) {
                    relatedTests.push(file);
                }
            }
        }
    }

    return relatedTests;
}

/**
 * Find related config files
 * Heuristic: config files that might reference the changed file
 */
export function findRelatedConfig(filepath: string, allFiles: string[]): string[] {
    const configs: string[] = [];
    const fileName = path.basename(filepath, path.extname(filepath));

    // Common config patterns
    const configPatterns = [
        '.env',
        '.env.example',
        'package.json',
        'tsconfig.json',
        'next.config',
        'vite.config',
        'webpack.config',
    ];

    for (const file of allFiles) {
        const lower = file.toLowerCase();
        // Include if it's a common config file
        if (configPatterns.some(pattern => lower.includes(pattern))) {
            configs.push(file);
        }
    }

    return configs.slice(0, 5);  // Limit to top 5 most relevant
}

/**
 * Calculate blast radius based on dependency metrics
 */
export function calculateBlastRadius(
    directCount: number,
    indirectCount: number,
    testCount: number
): { radius: BlastRadius; score: number } {
    // Weight factors
    const directWeight = 10;
    const indirectWeight = 3;
    const testWeight = 2;

    const score = Math.min(100,
        (directCount * directWeight) +
        (indirectCount * indirectWeight) +
        (testCount * testWeight)
    );

    let radius: BlastRadius;
    if (score < 20) {
        radius = 'small';
    } else if (score < 50) {
        radius = 'medium';
    } else if (score < 80) {
        radius = 'large';
    } else {
        radius = 'critical';
    }

    return { radius, score };
}

/**
 * Analyze impact of changing a file
 */
export function analyzeImpact(
    filepath: string,
    graph: DependencyGraph,
    allFiles: string[]
): ImpactAnalysis {
    const node = graph.nodes.get(filepath);
    const warnings: string[] = [];

    // Get direct dependents
    const direct = node?.dependents || [];

    // Get indirect dependents (one level deeper)
    const indirect: string[] = [];
    const seen = new Set(direct);
    for (const dep of direct) {
        const depNode = graph.nodes.get(dep);
        if (depNode) {
            for (const indirectDep of depNode.dependents) {
                if (!seen.has(indirectDep) && indirectDep !== filepath) {
                    indirect.push(indirectDep);
                    seen.add(indirectDep);
                }
            }
        }
    }

    // Find related tests
    const tests = findRelatedTests(filepath, allFiles);

    // Find related config
    const config = findRelatedConfig(filepath, allFiles);

    // Calculate blast radius
    const { radius, score } = calculateBlastRadius(
        direct.length,
        indirect.length,
        tests.length
    );

    // Generate warnings
    if (direct.length === 0 && !filepath.includes('test')) {
        warnings.push('No files import this - might be unused (dead code)');
    }

    if (direct.length > 20) {
        warnings.push(`High coupling: ${direct.length} files depend on this`);
    }

    if (tests.length === 0 && !filepath.includes('test') && radius !== 'small') {
        warnings.push('No tests found - changes are risky');
    }

    if (radius === 'critical') {
        warnings.push('CRITICAL: Changes will affect many files - proceed with caution');
    }

    return {
        primary: filepath,
        dependents: {
            direct: direct.slice(0, 20),  // Limit to top 20
            indirect: indirect.slice(0, 10),  // Limit to top 10
            tests,
            config: config.slice(0, 5)
        },
        blastRadius: radius,
        score,
        warnings
    };
}

/**
 * Analyze impact for multiple files at once
 */
export async function analyzeMultipleImpacts(
    filepaths: string[],
    graph: DependencyGraph,
    allFiles: string[]
): Promise<Map<string, ImpactAnalysis>> {
    const results = new Map<string, ImpactAnalysis>();

    for (const filepath of filepaths) {
        const analysis = analyzeImpact(filepath, graph, allFiles);
        results.set(filepath, analysis);
    }

    return results;
}
