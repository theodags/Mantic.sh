/**
 * File Type Classifier
 * Categorizes files for filtering and prioritization
 */

import path from 'path';
import { FileType } from './types.js';

// Test file patterns
const TEST_PATTERNS = [
    /\/test(s)?\//i,
    /\/e2e\//i,
    /\/__tests__\//i,
    /\/playwright\//i,
    /\/cypress\//i,
    /\.test\./i,
    /\.spec\./i,
    /\.e2e\./i,
    /\/__mocks__\//i,
    /\/\.storybook\//i,
];

// Documentation patterns
const DOCS_PATTERNS = [
    /\/docs?\//i,
    /\/documentation\//i,
    /\.mdx?$/i,
    /README/i,
    /CHANGELOG/i,
    /LICENSE/i,
];

// Configuration file patterns
const CONFIG_PATTERNS = [
    /package\.json$/,
    /tsconfig\.json$/,
    /\.eslintrc/,
    /\.prettierrc/,
    /\.config\.(js|ts|mjs)$/,
    /\.yml$/,
    /\.yaml$/,
    /\.toml$/,
    /\.env/,
    /Dockerfile/,
    /docker-compose/,
    /\.gitignore$/,
    /\.editorconfig$/,
];

// Generated file patterns
const GENERATED_PATTERNS = [
    /\.lock$/,
    /\.log$/,
    /\.map$/,
    /\/dist\//,
    /\/build\//,
    /\/\.next\//,
    /\/\.cache\//,
    /\/coverage\//,
    /\/node_modules\//,
    /\.min\.(js|css)$/,
    /\.generated\./,
    /\.d\.ts$/,
];

// Code file extensions (implementation files)
const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs',
    '.py', '.java', '.go', '.rs', '.c', '.cpp',
    '.rb', '.php', '.swift', '.kt',
]);

/**
 * Classify a file by its type
 */
export function classifyFile(filepath: string): FileType {
    // Check generated first (highest priority exclusion)
    for (const pattern of GENERATED_PATTERNS) {
        if (pattern.test(filepath)) {
            return 'generated';
        }
    }

    // Check test files
    for (const pattern of TEST_PATTERNS) {
        if (pattern.test(filepath)) {
            return 'test';
        }
    }

    // Check documentation
    for (const pattern of DOCS_PATTERNS) {
        if (pattern.test(filepath)) {
            return 'docs';
        }
    }

    // Check configuration
    for (const pattern of CONFIG_PATTERNS) {
        if (pattern.test(filepath)) {
            return 'config';
        }
    }

    // Check if it's a code file by extension
    const ext = path.extname(filepath).toLowerCase();
    if (CODE_EXTENSIONS.has(ext)) {
        return 'code';
    }

    return 'other';
}

/**
 * Get priority score for file type (higher = more important for logic queries)
 */
export function getFileTypePriority(fileType: FileType): number {
    switch (fileType) {
        case 'code':
            return 100; // Highest priority
        case 'config':
            return 50;
        case 'test':
            return 30;
        case 'docs':
            return 10;
        case 'generated':
            return 0; // Lowest priority
        case 'other':
            return 20;
        default:
            return 0;
    }
}

/**
 * Check if file should be excluded by default (generated files)
 */
export function shouldExcludeByDefault(filepath: string): boolean {
    return classifyFile(filepath) === 'generated';
}

/**
 * Check if a file is canonical (implementation) vs derivative (test/docs/generated)
 * Canonical files are the source of truth - the actual implementation
 */
export function isCanonical(filepath: string): boolean {
    const fileType = classifyFile(filepath);
    return fileType === 'code' || fileType === 'config';
}

/**
 * Extract the base name from a file path, removing test/spec/doc suffixes
 * Examples:
 *   auth.test.ts → auth
 *   Button.spec.tsx → Button
 *   api.e2e.ts → api
 */
export function getBaseName(filepath: string): string {
    const filename = path.basename(filepath);

    // Remove common test/spec/doc suffixes
    const withoutSuffix = filename
        .replace(/\.test\.(ts|tsx|js|jsx|mjs)$/, '.$1')
        .replace(/\.spec\.(ts|tsx|js|jsx|mjs)$/, '.$1')
        .replace(/\.e2e\.(ts|tsx|js|jsx|mjs)$/, '.$1')
        .replace(/\.stories\.(ts|tsx|js|jsx)$/, '.$1')
        .replace(/\.md$/, '');

    // Return filename without extension
    return withoutSuffix.replace(/\.[^.]+$/, '');
}

/**
 * Find potential canonical file paths for a given file
 * Examples:
 *   tests/auth.test.ts → [src/auth.ts, lib/auth.ts, auth.ts]
 *   docs/Button.md → [src/components/Button.tsx, components/Button.tsx]
 */
export function findCanonicalPaths(filepath: string, allFiles: string[]): string[] {
    if (isCanonical(filepath)) {
        return [filepath]; // Already canonical
    }

    const baseName = getBaseName(filepath);
    const ext = path.extname(filepath);

    // Common implementation directories
    const implDirs = ['src', 'lib', 'app', 'packages', 'components'];

    // Find files with matching base name in implementation directories
    const candidates: string[] = [];

    for (const file of allFiles) {
        if (!isCanonical(file)) continue; // Only look at canonical files

        const fileBaseName = getBaseName(file);
        if (fileBaseName === baseName) {
            candidates.push(file);
        }
    }

    // Sort by priority: prefer src/ over lib/ over root
    candidates.sort((a, b) => {
        const aParts = a.split('/');
        const bParts = b.split('/');

        // Prefer files in implementation directories
        const aInImpl = aParts.some(p => implDirs.includes(p));
        const bInImpl = bParts.some(p => implDirs.includes(p));

        if (aInImpl && !bInImpl) return -1;
        if (!aInImpl && bInImpl) return 1;

        // Prefer shorter paths (closer to root of impl dir)
        return aParts.length - bParts.length;
    });

    return candidates;
}
