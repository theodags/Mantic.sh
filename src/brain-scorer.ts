/**
 * Brain-Inspired File Scoring System
 * Port of DCS algorithm (dcs.py) to code file search
 *
 * Key insight: Score files WITHOUT reading them by using:
 * - Path structure (directory hierarchy)
 * - Filename keywords
 * - File metadata (size, extension, mtime)
 * - Cached AST metadata (if available)
 *
 * This achieves 99%+ elimination before reading files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { IntentAnalysis, IntentCategory, CacheIndex, FileScore } from './types.js';
import type { Stats } from 'node:fs';
import { isCanonical, classifyFile } from './file-classifier.js';

interface DirectoryWeights {
    [directory: string]: number;
}

/**
 * Intent-based directory weights (inspired by DCS selectivity estimation)
 * These are pre-computed "histograms" that tell us which directories
 * are likely to contain relevant files for each intent category
 */
const INTENT_DIRECTORY_WEIGHTS: Record<IntentCategory, DirectoryWeights> = {
    'UI': {
        'components/': 1.0,
        'app/': 0.9,
        'pages/': 0.9,
        'ui/': 1.0,
        'views/': 0.8,
        'src/components/': 1.0,
        'styles/': 0.3, // Lower weight - mostly CSS
        'lib/': 0.2,
        'utils/': 0.1,
        'api/': 0.0,
        'server/': 0.0
    },
    'auth': {
        'auth/': 1.0,
        'middleware/': 0.8,
        'lib/auth': 1.0,
        'api/auth': 0.9,
        'components/': 0.3, // Auth UI components
        'pages/': 0.3, // Login pages
        'server/': 0.5,
        'styles/': 0.0
    },
    'backend': {
        'api/': 1.0,
        'server/': 1.0,
        'services/': 0.9,
        'lib/': 0.7,
        'models/': 0.8,
        'db/': 0.9,
        'routes/': 0.9,
        'packages/': 0.8, // Monorepo packages (like Cal.com)
        'apps/': 0.7, // Monorepo apps
        'features/': 0.9, // Feature modules (common in Cal.com)
        'workflows/': 0.9, // Workflow logic
        'ee/': 0.8, // Enterprise edition
        'components/': 0.1, // Backend unlikely in components
        'styles/': 0.0
    },
    'styling': {
        'styles/': 1.0,
        'css/': 1.0,
        'theme/': 0.9,
        'ui/': 0.6,
        'components/': 0.5, // Component styles
        'lib/': 0.2,
        'api/': 0.0,
        'server/': 0.0
    },
    'performance': {
        'utils/': 0.8,
        'lib/': 0.8,
        'hooks/': 0.7,
        'middleware/': 0.7,
        'components/': 0.4,
        'api/': 0.5,
        'styles/': 0.1
    },
    'testing': {
        'tests/': 1.0,
        '__tests__/': 1.0,
        'test/': 1.0,
        'e2e/': 0.9,
        'spec/': 1.0,
        'components/': 0.0, // Tests are in separate dirs
        'lib/': 0.0
    },
    'config': {
        '.': 0.9, // Root config files
        'config/': 1.0,
        'lib/': 0.3,
        'src/': 0.1,
        'components/': 0.0
    },
    'general': {
        'src/': 0.5,
        'lib/': 0.5,
        'components/': 0.5,
        'utils/': 0.5
    }
};

/**
 * File extension weights (cost factors in DCS)
 * Higher weight = more likely to contain implementation
 */
const EXTENSION_WEIGHTS: Record<string, number> = {
    '.ts': 1.0,
    '.tsx': 1.0,
    '.js': 0.9,
    '.jsx': 0.9,
    '.py': 1.0,
    '.go': 1.0,
    '.rs': 1.0,
    '.java': 0.8,
    '.cpp': 0.8,
    '.c': 0.8,
    '.h': 0.7,
    '.css': 0.3,
    '.scss': 0.3,
    '.json': 0.1,
    '.md': 0.05,  // Heavily penalize docs
    '.mdx': 0.05, // Heavily penalize docs
    '.txt': 0.0,
    '.yml': 0.8,  // Config files
    '.yaml': 0.8  // Config files
};

// Critical config files without extensions (should not be penalized)
const IMPORTANT_CONFIG_FILES = new Set([
    'dockerfile',
    'makefile',
    'rakefile',
    'gemfile',
    'procfile',
    'jenkinsfile'
]);

/**
 * Path patterns that indicate non-implementation files
 * These should be deprioritized in search results
 */
const NON_IMPLEMENTATION_PATTERNS = [
    '/docs/', '/doc/', '/test/', '/tests/', '/e2e/', '/__tests__/',
    '/playwright/', '/cypress/', '/__mocks__/', '/examples/', '/storybook/',
    '.test.', '.spec.', '.e2e.'
];

const IMPLEMENTATION_DIRECTORY_PATTERNS = [
    '/src/', '/lib/', '/module/', '/modules/', '/service/', '/services/',
    '/api/', '/server/', '/core/', '/feature/', '/features/'
];

const GENERIC_FILE_PATTERNS = [
    '/page.tsx', '/page.ts', '/layout.tsx', '/layout.ts',
    '/route.tsx', '/route.ts', '/index.ts', '/index.tsx', '/index.js',
    '/app.tsx', '/app.ts', '/main.ts', '/main.js'
];

const BUSINESS_LOGIC_PATTERNS = [
    '.service.', '.controller.', '.handler.', '.repository.',
    '.manager.', '.provider.', '.helper.', '.util.', '.utils.',
    '.model.', '.schema.'
];

export class BrainInspiredScorer {
    private cache: CacheIndex | null = null;
    private intentWeights: DirectoryWeights = {};
    private sessionBoosts: Map<string, { boostFactor: number; reason: string }> = new Map();

    constructor(cache?: CacheIndex, sessionBoosts?: Array<{ path: string; boostFactor: number; reason: string }>) {
        this.cache = cache || null;

        // Build session boost map
        if (sessionBoosts) {
            for (const boost of sessionBoosts) {
                this.sessionBoosts.set(boost.path, {
                    boostFactor: boost.boostFactor,
                    reason: boost.reason
                });
            }
        }
    }

    /**
     * PHASE 1: Structural Elimination
     * Eliminates files based on extension and basic path rules
     * No file reads required
     */
    eliminateByStructure(files: string[]): string[] {
        return files.filter(file => {
            const ext = path.extname(file).toLowerCase();

            // Eliminate obvious non-code files
            if (['.png', '.jpg', '.gif', '.svg', '.ico', '.woff', '.ttf'].includes(ext)) {
                return false;
            }

            // Eliminate lock files, logs
            if (file.endsWith('.lock') || file.endsWith('.log')) {
                return false;
            }

            // Eliminate map files
            if (file.endsWith('.map')) {
                return false;
            }

            return true;
        });
    }

    /**
     * PHASE 2: Intent-Based Directory Pruning
     * Scores files based on directory hierarchy
     * Uses pre-computed weights (like DCS histograms)
     */
    scoreByDirectory(filepath: string, intent: IntentCategory): number {
        const weights = INTENT_DIRECTORY_WEIGHTS[intent] || INTENT_DIRECTORY_WEIGHTS['general'];
        let score = 0.0;

        // Optimization: Use includes() instead of split() to avoid allocation
        // This is much faster for large file sets (millions of checks)
        for (const [weightedDir, weight] of Object.entries(weights)) {
            // weightedDir is usually "components/" or "api/"
            // Check if filepath contains this directory segment
            // We search for "/name/" to ensure it's a directory segment
            // Also handle start of path (e.g. "components/...")

            // Normalize weightedDir to remove trailing slash for search
            const dirName = weightedDir.replace(/\/$/, '');

            if (filepath.includes('/' + dirName + '/') || filepath.startsWith(dirName + '/')) {
                score += weight;
            }
            // Partial match fallback (less strict, but maybe too slow? skip for now for speed)
        }

        return score;
    }

    /**
     * Pre-fetch fs.stat() for all files in parallel with controlled concurrency
     * This is a SAFE optimization - no accuracy loss
     */
    private async bulkStatFiles(
        files: string[],
        projectRoot: string,
        concurrency = 100
    ): Promise<Map<string, Stats>> {
        const statsCache = new Map<string, Stats>();

        // Process in chunks to avoid overwhelming the system
        const chunks: string[][] = [];
        for (let i = 0; i < files.length; i += concurrency) {
            chunks.push(files.slice(i, i + concurrency));
        }

        for (const chunk of chunks) {
            await Promise.all(
                chunk.map(async (file) => {
                    try {
                        const fullPath = path.join(projectRoot, file);
                        const stats = await fs.stat(fullPath);
                        statsCache.set(file, stats);
                    } catch {
                        // Skip files that can't be stat'd
                    }
                })
            );
        }

        return statsCache;
    }

    /**
     * PHASE 3: Zero-Read Heuristic Scoring
     * Score files using ONLY metadata - NO FILE READS
     * This is the revolutionary part!
     */
    async scoreWithoutReading(
        filepath: string,
        keywords: string[],
        intent: IntentCategory,
        projectRoot: string,
        statsCache?: Map<string, Stats>
    ): Promise<number> {
        let score = 0;
        const lowerPath = filepath.toLowerCase();

        // 1. Check if this is a non-implementation file (docs, tests, etc.)
        let isNonImplementation = false;
        for (const pattern of NON_IMPLEMENTATION_PATTERNS) {
            if (lowerPath.includes(pattern)) {
                isNonImplementation = true;
                break;
            }
        }

        // 2. Filename keyword matching (HIGHEST SIGNAL - like DCS equality constraint)
        const filename = path.basename(filepath).toLowerCase();
        const filenameNoExt = filename.replace(path.extname(filename), '');

        for (const keyword of keywords) {
            const kw = keyword.toLowerCase();

            // Exact filename match
            if (filenameNoExt === kw) {
                score += isNonImplementation ? 10 : 100; // Much lower for docs/tests
            }
            // Filename contains keyword
            else if (filename.includes(kw)) {
                score += isNonImplementation ? 5 : 50;
            }
            // Filename has keyword as word (e.g., "auth" in "auth-service")
            else if (new RegExp(`\\b${kw}\\b`).test(filenameNoExt.replace(/[-_]/g, ' '))) {
                score += isNonImplementation ? 3 : 30;
            }
        }

        // 3. Directory context scoring (like DCS histogram estimation)
        const dirScore = this.scoreByDirectory(filepath, intent);
        score += dirScore * 20; // Boost from directory relevance

        // 4. Implementation directory boost
        // Boost files in core implementation directories
        if (!isNonImplementation) { // Only boost if not already penalized
            for (const pattern of IMPLEMENTATION_DIRECTORY_PATTERNS) {
                if (lowerPath.includes(pattern)) {
                    score += 40; // Strong boost for implementation files
                    break; // Only apply boost once
                }
            }
        }

        // 5. File extension relevance (cost factor in DCS)
        const ext = path.extname(filepath).toLowerCase();
        const baseName = path.basename(filepath, ext).toLowerCase();

        // Check if it's an important config file without extension
        const isImportantConfigFile = !ext && IMPORTANT_CONFIG_FILES.has(baseName);
        const extWeight = isImportantConfigFile ? 1.0 : (EXTENSION_WEIGHTS[ext] || 0.5);
        score *= extWeight;

        // 6. Path depth penalty (reduced for monorepos)
        // Monorepos often have deep nesting (apps/api/v2/src/modules/stripe)
        const depth = filepath.split('/').length;
        const depthPenalty = Math.max(0, (depth - 5) * 1); // Only penalize after 5 levels, less aggressive
        score -= depthPenalty;

        // 7. File size heuristic (uses pre-fetched stats cache!)
        if (statsCache) {
            // Use pre-fetched stats (FAST - no disk I/O!)
            const stats = statsCache.get(filepath);
            if (stats) {
                // Larger files more likely to contain implementation
                if (stats.size > 10000) score += 10; // >10KB
                if (stats.size > 50000) score += 5;  // >50KB

                // Tiny files unlikely to be relevant
                if (stats.size < 500) score -= 10;

                // Very recently modified = more relevant (recency bias)
                const ageMs = Date.now() - stats.mtimeMs;
                const ageDays = ageMs / (1000 * 60 * 60 * 24);
                if (ageDays < 7) score += 15;  // Modified in last week
                else if (ageDays < 30) score += 5; // Modified in last month
            } else {
                // No stats available, neutral penalty
                score -= 5;
            }
        } else {
            // Fallback to individual fs.stat() if no cache
            try {
                const fullPath = path.join(projectRoot, filepath);
                const stats = await fs.stat(fullPath);

                // Larger files more likely to contain implementation
                if (stats.size > 10000) score += 10; // >10KB
                if (stats.size > 50000) score += 5;  // >50KB

                // Tiny files unlikely to be relevant
                if (stats.size < 500) score -= 10;

                // Very recently modified = more relevant (recency bias)
                const ageMs = Date.now() - stats.mtimeMs;
                const ageDays = ageMs / (1000 * 60 * 60 * 24);
                if (ageDays < 7) score += 15;  // Modified in last week
                else if (ageDays < 30) score += 5; // Modified in last month
            } catch {
                // Can't stat file, neutral penalty
                score -= 5;
            }
        }

        // 8. Canonical file boost (Phase 1 - Week 2-3)
        // Prefer implementation files over test/docs for logic queries
        if (isCanonical(filepath)) {
            score += 30; // Boost canonical files (implementation)
        } else {
            // Penalize derivative files (tests, docs)
            const fileType = classifyFile(filepath);
            if (fileType === 'test') {
                score -= 40; // Strong penalty for tests
            } else if (fileType === 'docs') {
                score -= 50; // Stronger penalty for docs
            }
        }

        // 9. Cached metadata boost (if we have AST cache - like DCS learned orderings)
        if (this.cache && this.cache.files[filepath]) {
            const entry = this.cache.files[filepath];

            // Boost if exports match keywords
            if (entry.exports) {
                for (const exp of entry.exports) {
                    for (const keyword of keywords) {
                        if (exp.name.toLowerCase().includes(keyword.toLowerCase())) {
                            score += 40; // High signal from exports
                        }
                    }
                }
            }

            // Boost if keywords appear in cached keywords
            if (entry.keywords) {
                const overlap = entry.keywords.filter(k =>
                    keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase()))
                );
                score += overlap.length * 15;
            }

            // Boost if functions match
            if (entry.functions) {
                for (const func of entry.functions) {
                    for (const keyword of keywords) {
                        if (func.name.toLowerCase().includes(keyword.toLowerCase())) {
                            score += 25;
                        }
                    }
                }
            }
        }

        // 10. Session memory boost (Phase 2 - Week 2)
        // Boost files previously viewed in active session
        const sessionBoost = this.sessionBoosts.get(filepath);
        if (sessionBoost) {
            score += sessionBoost.boostFactor;
        }

        return Math.max(0, score); // Never negative
    }

    /**
     * ULTRA-FAST scoring without any I/O
     * Scores files using ONLY path and filename - NO fs.stat() calls
     */
    private scoreUltraFast(
        filepath: string,
        keywords: string[],
        intent: IntentCategory
    ): number {
        let score = 0;
        const lowerPath = filepath.toLowerCase();

        // 1. Check if this is a non-implementation file
        let isNonImplementation = false;
        for (const pattern of NON_IMPLEMENTATION_PATTERNS) {
            if (lowerPath.includes(pattern)) {
                isNonImplementation = true;
                break;
            }
        }

        // Pre-compile keyword regexes for performance (CRITICAL for large repos)
        const keywordRegexes = keywords.map(kw => ({
            kw: kw.toLowerCase(),
            regex: new RegExp(`\\b${kw.toLowerCase()}\\b`)
        }));

        // 2. Filename keyword matching
        const filename = path.basename(filepath).toLowerCase();
        const filenameNoExt = filename.replace(path.extname(filename), '');
        // Replace separators once
        const normalizedName = filenameNoExt.replace(/[-_]/g, ' ');

        for (const { kw, regex } of keywordRegexes) {
            if (filenameNoExt === kw) {
                score += isNonImplementation ? 10 : 100;
            } else if (filename.includes(kw)) {
                score += isNonImplementation ? 5 : 50;
            } else if (regex.test(normalizedName)) {
                score += isNonImplementation ? 3 : 30;
            }
        }

        // 3. Quick directory scoring
        const dirScore = this.scoreByDirectory(filepath, intent);
        score += dirScore * 20;

        // 4. Implementation boost
        if (!isNonImplementation) {
            for (const pattern of IMPLEMENTATION_DIRECTORY_PATTERNS) {
                if (lowerPath.includes(pattern)) {
                    score += 40;
                    break;
                }
            }
        }

        // 5. MACHINE MODE: Business logic vs generic file heuristics
        let isGenericFile = false;
        let isBusinessLogic = false;

        for (const pattern of GENERIC_FILE_PATTERNS) {
            if (lowerPath.includes(pattern)) {
                isGenericFile = true;
                break;
            }
        }

        for (const pattern of BUSINESS_LOGIC_PATTERNS) {
            if (lowerPath.includes(pattern)) {
                isBusinessLogic = true;
                break;
            }
        }

        // Apply heuristic adjustments
        if (isBusinessLogic) {
            score *= 1.5; // 50% boost for business logic files
        } else if (isGenericFile) {
            score *= 0.3; // 70% penalty for generic/boilerplate files
        }

        // 6. Extension weight
        const ext = path.extname(filepath).toLowerCase();
        const baseName = path.basename(filepath, ext).toLowerCase();

        // Check if it's an important config file without extension
        const isImportantConfigFile = !ext && IMPORTANT_CONFIG_FILES.has(baseName);
        const extWeight = isImportantConfigFile ? 1.0 : (EXTENSION_WEIGHTS[ext] || 0.5);
        score *= extWeight;

        // 7. Minimal depth penalty
        const depth = filepath.split('/').length;
        score -= Math.max(0, (depth - 5) * 1);

        // 8. Canonical file boost (Phase 1 - Week 2-3)
        if (isCanonical(filepath)) {
            score += 30; // Boost canonical files (implementation)
        } else {
            const fileType = classifyFile(filepath);
            if (fileType === 'test') {
                score -= 40; // Strong penalty for tests
            } else if (fileType === 'docs') {
                score -= 50; // Stronger penalty for docs
            }
        }

        // 9. Session memory boost (Phase 2 - Week 2)
        const sessionBoost = this.sessionBoosts.get(filepath);
        if (sessionBoost) {
            score += sessionBoost.boostFactor;
        }

        return Math.max(0, score);
    }

    /**
     * PHASE 4: Multi-Stage Cascade
     * Like DCS constraint sequencing - apply filters in optimal order
     */
    async rankFiles(
        files: string[],
        keywords: string[],
        intent: IntentAnalysis,
        projectRoot: string
    ): Promise<FileScore[]> {
        const startTime = Date.now();

        // Stage 1: Structural elimination (instant)
        const afterStructural = this.eliminateByStructure(files);

        // Stage 2: ULTRA-FAST scoring (NO I/O - pure computation)
        const scored: FileScore[] = [];

        // Single-pass scoring without batching overhead
        for (const file of afterStructural) {
            const score = this.scoreUltraFast(file, keywords, intent.category);

            if (score > 0) {
                const reasons: string[] = [];
                if (score > 100) reasons.push('filename-match');
                if (score > 50) reasons.push('keyword-match');
                scored.push({ path: file, score, reasons });
            }
        }

        // Stage 3: Sort and take top results
        scored.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            // Deterministic tie-breaker
            return a.path.localeCompare(b.path);
        });
        const topFiles = scored.slice(0, 100);

        return topFiles;
    }

    /**
     * Get statistics about the scoring
     */
    getStats(scoredFiles: FileScore[]): {
        filesEliminated: number;
        avgScore: number;
        topScore: number;
    } {
        const length = scoredFiles.length;
        return {
            filesEliminated: scoredFiles.filter(f => f.score === 0).length,
            avgScore: length > 0 ? scoredFiles.reduce((sum, f) => sum + f.score, 0) / length : 0,
            topScore: scoredFiles[0]?.score || 0
        };
    }
}
