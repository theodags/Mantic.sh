/**
 * Smart File Filter - DCS-inspired constraint sequencing for code search
 *
 * Applies filters in optimal order to minimize operations and find
 * the most relevant files quickly, similar to how a human brain works.
 *
 * Key concepts from DCS:
 * 1. Constraint Sequencing: Apply high-selectivity filters first
 * 2. Learning: Cache successful search patterns
 * 3. Sparsity Optimization: Skip unused/unimported files quickly
 * 4. Energy Efficiency: Minimize expensive operations
 */

import { CacheIndex } from './types.js';
import fs from 'fs/promises';
import path from 'path';
import { getGitModifiedFiles } from './git-utils.js';

export interface FilterConstraint {
    type: 'import' | 'export' | 'keyword' | 'path' | 'usage' | 'component-type';
    value: string | string[];
    cost: number; // Computational cost (1 = cheap, 10 = expensive)
    selectivity: number; // Expected elimination rate (0-1)
}

export interface ScoredFile {
    path: string;
    score: number;
    matchedConstraints: string[];
    isImported: boolean;
    isExported: boolean;
    matchedLines?: Array<{
        line: number;
        content: string;
        keyword: string;
    }>;
    // Progressive Disclosure Metadata (Phase 1)
    metadata?: {
        sizeBytes?: number;
        lines?: number;
        estimatedTokens?: number;
        lastModified?: string;
        created?: string;
        confidence?: number;
    };
}

export interface SearchPattern {
    keywords: string[];
    constraints: FilterConstraint[];
    successfulPaths: string[];
    usageCount: number;
}

export class SmartFilter {
    private learnedPatterns: Map<string, SearchPattern> = new Map();
    private cacheDir: string;
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.cacheDir = path.join(projectRoot, '.mantic');
        this.projectRoot = projectRoot;
    }

    /**
     * Get recently modified files (git status + mtime fallback)
     * This captures what the user is actively working on - perfect for "vibe coders"!
     */
    private async getRecentlyModifiedFiles(cache: CacheIndex | null): Promise<Set<string>> {
        const TEN_MINUTES_AGO = Date.now() - (10 * 60 * 1000);

        // Get git modified files using shared utility
        const recentFiles = getGitModifiedFiles(this.projectRoot);

        // Also check mtime from cache (works even without git)
        // This catches files modified in the last 10 minutes
        if (cache) {
            for (const [filePath, fileEntry] of Object.entries(cache.files)) {
                const lastModified = fileEntry.mtime;
                if (lastModified >= TEN_MINUTES_AGO) {
                    recentFiles.add(filePath);
                }
            }
        }

        return recentFiles;
    }

    /**
     * Main search method: applies constraints in optimal order
     */
    async search(
        allFiles: string[],
        keywords: string[],
        cache: CacheIndex | null,
        projectRoot: string,
        contextFiles?: string[] // NEW: Files from previous request for context carryover
    ): Promise<ScoredFile[]> {
        // 1. Generate constraints from keywords
        const constraints = this.generateConstraints(keywords, cache);

        // 2. Check if we have a learned pattern for these keywords
        const patternKey = keywords.sort().join('_').toLowerCase();
        const learned = this.learnedPatterns.get(patternKey);

        // 3. Sequence constraints by cost-benefit ratio (like DCS)
        const orderedConstraints = this.sequenceConstraints(
            constraints,
            allFiles.length,
            learned
        );

        // 4. Apply constraints progressively
        const scoredFiles = await this.applyConstraints(
            allFiles,
            orderedConstraints,
            cache,
            projectRoot
        );

        // 4.5. RECENCY BOOST: Files you just modified are probably what you're working on!
        // Perfect for "vibe coders" who don't commit but DO edit files
        const recentFiles = await this.getRecentlyModifiedFiles(cache);
        if (recentFiles.size > 0) {
            const scoredMap = new Map(scoredFiles.map(f => [f.path, f]));
            for (const [filePath, fileData] of scoredMap.entries()) {
                if (recentFiles.has(filePath)) {
                    fileData.score += 200; // MASSIVE boost for recently modified files!
                    fileData.matchedConstraints.push('recently-modified');
                }
            }
        }

        // 4.6. CRITICAL: Boost files from previous context if this is a follow-up
        if (contextFiles && contextFiles.length > 0) {
            const scoredMap = new Map(scoredFiles.map(f => [f.path, f]));
            this.boostContextFiles(scoredMap, contextFiles);
        }

        // 5. Sort and get top results
        const topResults = scoredFiles
            .sort((a, b) => b.score - a.score)
            .slice(0, 50);

        // 6. CRITICAL: Find exact line numbers for top 10 results
        // This is the REAL value of Mantic - giving exact locations!
        // For UI tasks like "rename share button", focus on PRIMARY keyword ("share")
        // not generic ones ("button", "copy", "link")
        const primaryKeyword = this.getPrimaryKeyword(keywords);
        const searchKeywords = primaryKeyword ? [primaryKeyword] : keywords.slice(0, 2);

        const topTen = topResults.slice(0, 10);
        await Promise.all(
            topTen.map(file => this.findExactLines(file, searchKeywords, projectRoot))
        );

        // Filter out files with no meaningful matches
        // Only return files that actually have lines matching the primary keyword
        const filesWithMatches = topResults.filter(f => f.matchedLines && f.matchedLines.length > 0);

        // If no files have matches, return top results anyway (fallback)
        return filesWithMatches.length > 0 ? filesWithMatches : topResults.slice(0, 5);
    }

    /**
     * Generate constraints from search keywords
     */
    private generateConstraints(
        keywords: string[],
        cache: CacheIndex | null
    ): FilterConstraint[] {
        const constraints: FilterConstraint[] = [];

        // CRITICAL: Usage constraint (very high selectivity, expensive but worth it)
        // This eliminates unused/unimported files early to prevent modifying dead code
        constraints.push({
            type: 'usage',
            value: '*',
            cost: 8, // Expensive (scans all imports) but eliminates 50%+ of files
            selectivity: 0.60 // Eliminates ~60% of unused files
        });

        for (const keyword of keywords) {
            // Import constraint (high selectivity, cheap)
            constraints.push({
                type: 'import',
                value: keyword,
                cost: 2,
                selectivity: 0.85 // Eliminates ~85% of files
            });

            // Export constraint (high selectivity, cheap)
            constraints.push({
                type: 'export',
                value: keyword,
                cost: 2,
                selectivity: 0.90
            });

            // Component type constraint (medium selectivity, medium cost)
            if (this.isLikelyComponentName(keyword)) {
                constraints.push({
                    type: 'component-type',
                    value: keyword,
                    cost: 5,
                    selectivity: 0.70
                });
            }

            // Keyword constraint (low selectivity, cheap)
            constraints.push({
                type: 'keyword',
                value: keyword,
                cost: 1,
                selectivity: 0.30
            });

            // Path constraint (medium selectivity, very cheap)
            constraints.push({
                type: 'path',
                value: keyword,
                cost: 1,
                selectivity: 0.50
            });
        }

        return constraints;
    }

    /**
     * Sequence constraints by cost-benefit ratio (DCS algorithm core)
     *
     * Formula: score = selectivity / (cost + 0.1)
     * Higher score = apply first
     */
    private sequenceConstraints(
        constraints: FilterConstraint[],
        datasetSize: number,
        learned?: SearchPattern
    ): FilterConstraint[] {
        // If we have a learned pattern with high success rate, use it
        if (learned && learned.usageCount > 2) {
            return learned.constraints;
        }

        // Calculate cost-benefit score for each constraint
        const scored = constraints.map(c => ({
            constraint: c,
            score: c.selectivity / (c.cost + 0.1)
        }));

        // Sort by score (highest first)
        scored.sort((a, b) => b.score - a.score);

        return scored.map(s => s.constraint);
    }

    /**
     * Apply constraints progressively, tracking operations
     */
    private async applyConstraints(
        files: string[],
        constraints: FilterConstraint[],
        cache: CacheIndex | null,
        projectRoot: string
    ): Promise<ScoredFile[]> {
        const scored: Map<string, ScoredFile> = new Map();

        // Initialize all files with score 0
        for (const file of files) {
            scored.set(file, {
                path: file,
                score: 0,
                matchedConstraints: [],
                isImported: false,
                isExported: false
            });
        }

        // Apply each constraint
        for (const constraint of constraints) {
            await this.applyConstraint(scored, constraint, cache, projectRoot);

            // Early termination: if we have 5+ high-scoring files, stop
            const topScores = Array.from(scored.values())
                .map(f => f.score)
                .sort((a, b) => b - a);

            if (topScores.length >= 5 && topScores[4] > 50) {
                break; // We found good matches, no need to continue
            }
        }

        return Array.from(scored.values());
    }

    /**
     * Apply a single constraint to all files
     */
    private async applyConstraint(
        scored: Map<string, ScoredFile>,
        constraint: FilterConstraint,
        cache: CacheIndex | null,
        projectRoot: string
    ): Promise<void> {
        const keyword = Array.isArray(constraint.value)
            ? constraint.value[0]
            : constraint.value;

        switch (constraint.type) {
            case 'import':
                // Check if file imports the keyword
                for (const [filePath, fileData] of scored.entries()) {
                    if (!cache?.files[filePath]) continue;

                    const imports = cache.files[filePath].imports || [];
                    const hasImport = imports.some(imp =>
                        imp.source.toLowerCase().includes(keyword.toLowerCase()) ||
                        imp.names.some(name => name.toLowerCase().includes(keyword.toLowerCase()))
                    );

                    if (hasImport) {
                        fileData.score += 20; // High score for import match
                        fileData.matchedConstraints.push(`imports:${keyword}`);
                        fileData.isImported = true;
                    }
                }
                break;

            case 'export':
                // Check if file exports the keyword
                for (const [filePath, fileData] of scored.entries()) {
                    if (!cache?.files[filePath]) continue;

                    const exports = cache.files[filePath].exports || [];
                    const hasExport = exports.some(exp =>
                        exp.name.toLowerCase().includes(keyword.toLowerCase())
                    );

                    if (hasExport) {
                        fileData.score += 25; // Very high score for export match
                        fileData.matchedConstraints.push(`exports:${keyword}`);
                        fileData.isExported = true;
                    }
                }
                break;

            case 'component-type':
                // Check if file is a React/Vue component with matching name
                for (const [filePath, fileData] of scored.entries()) {
                    if (!cache?.files[filePath]) continue;

                    const fileName = path.basename(filePath, path.extname(filePath));
                    const components = cache.files[filePath].components || [];
                    const hasMatchingComponent = components.some(comp =>
                        comp.name.toLowerCase().includes(keyword.toLowerCase())
                    );

                    if (hasMatchingComponent || (components.length > 0 && fileName.toLowerCase().includes(keyword.toLowerCase()))) {
                        fileData.score += 15;
                        fileData.matchedConstraints.push(`component:${keyword}`);
                    }
                }
                break;

            case 'keyword':
                // Check if keyword appears in file's indexed keywords
                for (const [filePath, fileData] of scored.entries()) {
                    if (!cache?.files[filePath]) continue;

                    const keywords = cache.files[filePath].keywords || [];
                    const hasKeyword = keywords.some(kw =>
                        kw.toLowerCase().includes(keyword.toLowerCase())
                    );

                    if (hasKeyword) {
                        fileData.score += 5;
                        fileData.matchedConstraints.push(`keyword:${keyword}`);
                    }
                }
                break;

            case 'path':
                // Check if keyword appears in file path
                // CRITICAL: If user mentions a specific filename like "nc-project",
                // give it HUGE boost to prioritize exact matches!
                for (const [filePath, fileData] of scored.entries()) {
                    const fileName = path.basename(filePath, path.extname(filePath));

                    // EXACT filename match (e.g., "nc-project" matches "nc-project.tsx")
                    if (fileName.toLowerCase() === keyword.toLowerCase()) {
                        fileData.score += 100; // MASSIVE boost for exact match!
                        fileData.matchedConstraints.push(`exact-file:${keyword}`);
                    }
                    // Partial path match
                    else if (filePath.toLowerCase().includes(keyword.toLowerCase())) {
                        fileData.score += 3;
                        fileData.matchedConstraints.push(`path:${keyword}`);
                    }
                }
                break;

            case 'usage':
                // Check if file is actually used (imported by other files)
                // CRITICAL: This prevents modifying dead code / unused files
                for (const [filePath, fileData] of scored.entries()) {
                    const isUsed = await this.checkFileUsage(filePath, cache);
                    if (isUsed) {
                        fileData.score += 30; // BIG boost for actively used files
                        fileData.matchedConstraints.push('actively-used');
                    } else {
                        // PENALTY: Unused files get negative score to deprioritize them
                        fileData.score -= 50;
                        fileData.matchedConstraints.push('unused-file');
                    }
                }
                break;
        }
    }

    /**
     * Check if a file is actually used (imported) in the project
     * Uses sparsity optimization: quickly return false for unused files
     */
    private async checkFileUsage(
        filePath: string,
        cache: CacheIndex | null
    ): Promise<boolean> {
        if (!cache) return false;

        // Quick check: is this file exported?
        const fileData = cache.files[filePath];
        if (!fileData?.exports || fileData.exports.length === 0) {
            return false; // Not exported = not used (sparsity optimization)
        }

        // Check if any other file imports from this file
        const fileName = path.basename(filePath, path.extname(filePath));

        for (const otherFile of Object.values(cache.files)) {
            if (otherFile.imports) {
                for (const imp of otherFile.imports) {
                    if (imp.source.includes(fileName) || imp.names.some(n => n.includes(fileName))) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Get the PRIMARY keyword to search for (the specific thing to change)
     * For "rename share button", returns "share" not "button"
     * For "fix login form", returns "login" not "form"
     * For "in file nc-project rename share", returns "share" not "nc-project"
     */
    private getPrimaryKeyword(keywords: string[]): string | null {
        // Generic UI terms that are usually NOT the target
        const genericTerms = new Set([
            'button', 'form', 'modal', 'dialog', 'input', 'card',
            'menu', 'nav', 'header', 'footer', 'component', 'page',
            'rename', 'change', 'update', 'fix', 'add', 'remove',
            'copy', 'link', 'click', 'submit', 'cancel', 'file', 'theres'
        ]);

        // Find the first non-generic, non-filename keyword
        for (const keyword of keywords) {
            const lower = keyword.toLowerCase();

            // Skip generic terms
            if (genericTerms.has(lower)) continue;

            // Skip filename-like patterns (kebab-case, PascalCase)
            // These are for file matching, not content search!
            if (/^[a-z]+-[a-z0-9-]+$/i.test(keyword)) continue; // nc-project, app-sidebar
            if (/^[A-Z][a-zA-Z]+$/.test(keyword)) continue; // ShareButton, AppSidebar

            // This is a content keyword!
            return keyword;
        }

        // If all keywords are generic/filenames, return the first non-filename
        for (const keyword of keywords) {
            if (!/^[a-z]+-[a-z0-9-]+$/i.test(keyword) && !/^[A-Z][a-zA-Z]+$/.test(keyword)) {
                return keyword;
            }
        }

        return keywords.length > 0 ? keywords[0] : null;
    }

    /**
     * Detect if a keyword likely refers to a component name
     */
    private isLikelyComponentName(keyword: string): boolean {
        // Component names typically start with uppercase or contain "component"
        return /^[A-Z]/.test(keyword) ||
            keyword.toLowerCase().includes('component') ||
            keyword.toLowerCase().includes('button') ||
            keyword.toLowerCase().includes('modal') ||
            keyword.toLowerCase().includes('form') ||
            keyword.toLowerCase().includes('card');
    }

    /**
     * Learn from successful searches
     */
    async learnPattern(
        keywords: string[],
        constraints: FilterConstraint[],
        successfulPath: string
    ): Promise<void> {
        const patternKey = keywords.sort().join('_').toLowerCase();

        let pattern = this.learnedPatterns.get(patternKey);

        if (pattern) {
            pattern.usageCount++;
            if (!pattern.successfulPaths.includes(successfulPath)) {
                pattern.successfulPaths.push(successfulPath);
            }
        } else {
            pattern = {
                keywords,
                constraints,
                successfulPaths: [successfulPath],
                usageCount: 1
            };
        }

        this.learnedPatterns.set(patternKey, pattern);

        // Persist to disk
        await this.saveLearnedPatterns();
    }

    /**
     * Load learned patterns from disk
     */
    async loadLearnedPatterns(): Promise<void> {
        try {
            const patternsFile = path.join(this.cacheDir, 'search-patterns.json');
            const data = await fs.readFile(patternsFile, 'utf-8');
            const patterns = JSON.parse(data);

            this.learnedPatterns = new Map(Object.entries(patterns));
        } catch {
            // No patterns file yet, start fresh
        }
    }

    /**
     * Save learned patterns to disk
     */
    private async saveLearnedPatterns(): Promise<void> {
        try {
            const patternsFile = path.join(this.cacheDir, 'search-patterns.json');
            const patterns = Object.fromEntries(this.learnedPatterns);

            await fs.mkdir(this.cacheDir, { recursive: true });
            await fs.writeFile(patternsFile, JSON.stringify(patterns, null, 2));
        } catch (error) {
            // Ignore save errors
        }
    }

    /**
     * Find exact line numbers where keywords appear in a file
     * This is the CORE VALUE of Mantic - precise location detection!
     *
     * PRIORITY: Show meaningful UI context (JSX content, button labels) not imports/comments
     */
    private async findExactLines(
        scoredFile: ScoredFile,
        keywords: string[],
        projectRoot: string
    ): Promise<void> {
        try {
            const fullPath = path.join(projectRoot, scoredFile.path);
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            const matchedLines: Array<{ line: number; content: string; keyword: string; priority: number }> = [];

            // Search for each keyword in the file
            for (const keyword of keywords) {
                const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedKeyword, 'gi');

                lines.forEach((lineContent, index) => {
                    if (regex.test(lineContent)) {
                        const trimmed = lineContent.trim();

                        // Skip useless lines
                        if (trimmed.length === 0 || lineContent.length > 200) return;
                        if (trimmed.startsWith('import ') || trimmed.startsWith('//')) return;
                        if (trimmed === '</Button>' || trimmed === '</button>') return; // Closing tags

                        // Calculate priority: JSX content > props > code
                        let priority = 0;

                        // HIGHEST: JSX text content like <Button>Share</Button>
                        const jsxTextPattern = new RegExp(`>[^<]*${escapedKeyword}[^<]*<`, 'i');
                        if (jsxTextPattern.test(lineContent)) {
                            priority = 10;
                        }
                        // HIGHEST: Multi-line JSX text (e.g., "  Share" on its own line)
                        // Detect: short line (< 30 chars), mostly alphabetic, keyword match
                        else if (
                            trimmed.length < 30 &&
                            /^[A-Za-z\s]+$/.test(trimmed) && // Only letters and spaces
                            new RegExp(`\\b${escapedKeyword}\\b`, 'i').test(trimmed) // Whole word match
                        ) {
                            priority = 10; // JSX text content!
                        }
                        // HIGH: Button/label with keyword
                        else if (/button|label|title|text/i.test(lineContent)) {
                            priority = 8;
                        }
                        // MEDIUM: String literal with keyword
                        else if (new RegExp(`(["'\`])[^"'\`]*${escapedKeyword}[^"'\`]*\\1`, 'i').test(lineContent)) {
                            priority = 5;
                        }
                        // LOW: Variable/function name
                        else {
                            priority = 2;
                        }

                        const existing = matchedLines.find(m => m.line === index + 1);
                        if (!existing) {
                            matchedLines.push({
                                line: index + 1,
                                content: trimmed,
                                keyword,
                                priority
                            });
                        }
                    }
                });
            }

            // Sort by priority (highest first), then keep top 3
            matchedLines.sort((a, b) => b.priority - a.priority);
            scoredFile.matchedLines = matchedLines.slice(0, 3).map(m => ({
                line: m.line,
                content: m.content,
                keyword: m.keyword
            }));
        } catch (error) {
            // If file read fails, just skip line detection
            scoredFile.matchedLines = [];
        }
    }

    /**
     * Get statistics about search efficiency
     */
    getStatistics(): {
        totalPatterns: number;
        mostUsedPatterns: Array<{ keywords: string[]; usageCount: number }>;
    } {
        const patterns = Array.from(this.learnedPatterns.values())
            .sort((a, b) => b.usageCount - a.usageCount);

        return {
            totalPatterns: patterns.length,
            mostUsedPatterns: patterns.slice(0, 5).map(p => ({
                keywords: p.keywords,
                usageCount: p.usageCount
            }))
        };
    }

    /**
     * Boost files from previous session context
     * If user says "also rename customize button", and we previously found nc-project.tsx,
     * give that file a HUGE boost to keep context
     */
    boostContextFiles(
        scored: Map<string, ScoredFile>,
        contextFiles: string[]
    ): void {
        for (const [filePath, fileData] of scored.entries()) {
            if (contextFiles.includes(filePath)) {
                // MASSIVE boost for files from previous request
                fileData.score += 150;
                fileData.matchedConstraints.push('context-carryover');
            }
        }
    }
}
