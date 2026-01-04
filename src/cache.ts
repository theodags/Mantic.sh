import * as fs from 'fs/promises';
import * as path from 'path';
import { CacheIndex, FileEntry } from './types.js';
import { FileParser, shouldParseFile } from './parser.js';

const CACHE_VERSION = '1.0.0';
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory LRU cache for project indices (max 3 projects)
class MemoryCache {
    private cache: Map<string, { data: CacheIndex; timestamp: number }> = new Map();
    private maxSize = 3;

    get(key: string): CacheIndex | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if still valid (5 minutes)
        if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
            this.cache.delete(key);
            return null;
        }

        // Move to end (LRU)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data;
    }

    set(key: string, data: CacheIndex): void {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, { data, timestamp: Date.now() });
    }

    clear(): void {
        this.cache.clear();
    }
}

const memoryCache = new MemoryCache();

export class CacheManager {
    private cacheDir: string;
    private cachePath: string;
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.cacheDir = path.join(projectRoot, '.mantic');
        this.cachePath = path.join(this.cacheDir, 'index.json');
    }

    /**
     * Load cache from disk if it exists
     */
    async load(): Promise<CacheIndex | null> {
        // Try memory cache first
        const memCached = memoryCache.get(this.projectRoot);
        if (memCached) {
            return memCached;
        }

        try {
            const content = await fs.readFile(this.cachePath, 'utf-8');
            const cache = JSON.parse(content) as CacheIndex;

            // Store in memory cache for next access
            memoryCache.set(this.projectRoot, cache);

            return cache;
        } catch (error) {
            // Cache doesn't exist or is corrupted
            return null;
        }
    }

    /**
     * Save cache to disk atomically
     */
    async save(cache: CacheIndex): Promise<void> {
        // Update memory cache
        memoryCache.set(this.projectRoot, cache);

        // Ensure directory exists
        await fs.mkdir(this.cacheDir, { recursive: true });

        // Create .gitignore to exclude cache from git
        const gitignorePath = path.join(this.cacheDir, '.gitignore');
        try {
            await fs.access(gitignorePath);
        } catch {
            // .gitignore doesn't exist, create it
            await fs.writeFile(gitignorePath, '# Mantic cache\n*\n!.gitignore\n');
        }

        // Atomic write: write to temp file, then rename
        const tempPath = `${this.cachePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(cache, null, 2));
        await fs.rename(tempPath, this.cachePath);
    }

    /**
     * Check if cache should be invalidated
     */
    async shouldInvalidate(cache: CacheIndex): Promise<boolean> {
        // Strategy 1: Version mismatch
        if (cache.version !== CACHE_VERSION) {
            return true;
        }

        // Strategy 2: Project root changed
        if (cache.projectRoot !== this.projectRoot) {
            return true;
        }

        // Strategy 3: package.json changed (tech stack detection)
        const packageJsonPath = path.join(this.projectRoot, 'package.json');
        try {
            const pkgStats = await fs.stat(packageJsonPath);
            const pkgEntry = cache.files['package.json'];
            if (!pkgEntry || pkgEntry.mtime !== pkgStats.mtimeMs) {
                return true; // Full rebuild if dependencies changed
            }
        } catch {
            // package.json doesn't exist or can't be read
            // Don't invalidate, might be a project without package.json
        }

        // Strategy 4: Too old (24 hours)
        if (Date.now() - cache.lastScanTime > MAX_CACHE_AGE_MS) {
            return true;
        }

        return false;
    }

    /**
     * Detect which files have been added, modified, or deleted
     */
    async getStaleFiles(
        cache: CacheIndex,
        currentFiles: string[]
    ): Promise<{
        modified: string[];
        added: string[];
        deleted: string[];
    }> {
        const modified: string[] = [];
        const added: string[] = [];
        const cachedPaths = new Set(Object.keys(cache.files));

        // Check for modifications and additions
        for (const filePath of currentFiles) {
            const entry = cache.files[filePath];

            if (!entry) {
                added.push(filePath);
                continue;
            }

            // Check mtime and size
            try {
                const stats = await fs.stat(path.join(this.projectRoot, filePath));
                if (stats.mtimeMs !== entry.mtime || stats.size !== entry.size) {
                    modified.push(filePath);
                }
            } catch {
                // File might have been deleted, will be caught below
                // or is inaccessible
            }

            cachedPaths.delete(filePath);
        }

        // Remaining cached paths are deleted files
        const deleted = Array.from(cachedPaths);

        return { modified, added, deleted };
    }

    /**
     * Update cache incrementally with only changed files
     */
    async updateIncrementally(
        cache: CacheIndex,
        changes: { modified: string[]; added: string[]; deleted: string[] },
        parser: FileParser
    ): Promise<CacheIndex> {
        // Remove deleted files
        for (const filePath of changes.deleted) {
            delete cache.files[filePath];
        }

        // Parse and update modified + added files
        const filesToParse = [...changes.modified, ...changes.added];

        // Process files in batches for better performance
        const BATCH_SIZE = 50; // Increased from 10 for faster parsing
        for (let i = 0; i < filesToParse.length; i += BATCH_SIZE) {
            const batch = filesToParse.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (filePath) => {
                    await this.parseAndCacheFile(filePath, parser, cache);
                })
            );
        }

        cache.lastScanTime = Date.now();
        cache.totalFiles = Object.keys(cache.files).length;

        return cache;
    }

    /**
     * Build cache from scratch for all files
     */
    async buildFromScratch(
        files: string[],
        techStack: string,
        parser: FileParser
    ): Promise<CacheIndex> {
        const cache: CacheIndex = {
            version: CACHE_VERSION,
            lastScanTime: Date.now(),
            projectRoot: this.projectRoot,
            techStack,
            totalFiles: 0,
            files: {},
        };

        // Process files in batches
        const BATCH_SIZE = 50; // Increased from 10 for faster parsing
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (filePath) => {
                    await this.parseAndCacheFile(filePath, parser, cache);
                })
            );
        }

        cache.totalFiles = Object.keys(cache.files).length;

        return cache;
    }

    /**
     * Parse a single file and add it to the cache
     */
    private async parseAndCacheFile(
        filePath: string,
        parser: FileParser,
        cache: CacheIndex
    ): Promise<void> {
        const fullPath = path.join(this.projectRoot, filePath);

        try {
            const stats = await fs.stat(fullPath);
            const content = await fs.readFile(fullPath, 'utf-8');

            const entry: FileEntry = {
                path: filePath,
                mtime: stats.mtimeMs,
                size: stats.size,
                lastParsed: Date.now(),
            };

            // Only parse supported file types
            if (shouldParseFile(filePath)) {
                try {
                    const parsed = parser.parse(filePath, content);
                    entry.exports = parsed.exports;
                    entry.imports = parsed.imports;
                    entry.components = parsed.components;
                    entry.keywords = parsed.keywords;
                    entry.functions = parsed.functions;
                    entry.classes = parsed.classes;
                    entry.types = parsed.types;
                    entry.language = parsed.language;
                } catch (error) {
                    // Parsing failed, store error but keep basic file info
                    entry.parseError = error instanceof Error ? error.message : 'Parse error';
                }
            }

            cache.files[filePath] = entry;
        } catch (error) {
            // File might not be readable, skip it
            console.warn(`Failed to process ${filePath}:`, error instanceof Error ? error.message : error);
        }
    }

    /**
     * Get the cache directory path
     */
    getCacheDir(): string {
        return this.cacheDir;
    }

    /**
     * Get the cache file path
     */
    getCachePath(): string {
        return this.cachePath;
    }

    /**
     * Check if cache exists
     */
    async exists(): Promise<boolean> {
        try {
            await fs.access(this.cachePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Delete the cache
     */
    async clear(): Promise<void> {
        try {
            await fs.unlink(this.cachePath);
        } catch {
            // Cache doesn't exist or can't be deleted
        }
    }
}
