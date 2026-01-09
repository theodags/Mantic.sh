import { spawnSync, execSync } from 'child_process';
import fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Optimized file loader that prioritizes native system binaries
 * for order-of-magnitude speed improvements on large repositories.
 */
export class NativeLoader {
    private ignorePatterns: string[];
    private compiledIgnores: RegExp[];
    private ignorePrefixes: string[];

    constructor(ignorePatterns: string[]) {
        this.ignorePatterns = ignorePatterns;

        // Optimization: Split ignores into fast prefixes and slow regexes
        this.ignorePrefixes = [];
        const complexPatterns: string[] = [];

        for (const pattern of ignorePatterns) {
            // "node_modules/**" -> "node_modules/"
            if (pattern.endsWith('/**')) {
                this.ignorePrefixes.push(pattern.slice(0, -3) + '/');
            } else if (pattern.endsWith('/')) {
                this.ignorePrefixes.push(pattern);
            } else {
                complexPatterns.push(pattern);
            }
        }

        this.compiledIgnores = this.compilePatterns(complexPatterns);
    }

    /**
     * Main entry point: Load files using the fastest available method
     */
    public async loadFiles(cwd: string): Promise<string[]> {
        const isGit = this.isGitRepo(cwd);
        // console.error(`[NativeLoader] isGitRepo(${cwd}): ${isGit}`);

        // 1. Try Git (Fastest for repos)
        if (isGit) {
            try {
                // console.error('[NativeLoader] Attempting Git load...');
                const files = this.loadFromGit(cwd);

                // const tFilterStart = Date.now();
                const filtered = this.filterFiles(files);
                // const tFilterEnd = Date.now();

                // Only log if slow (> 100ms)
                // if (tFilterEnd - tFilterStart > 100) {
                //    console.error(`[NativeLoader] Filtering ${files.length} files took ${tFilterEnd - tFilterStart}ms`);
                // }

                return filtered;
            } catch (e) {
                // console.error(`[NativeLoader] Git failed in ${cwd}:`, e instanceof Error ? e.message : String(e));
                // Fallback if git fails
            }
        }

        // 2. Try fd (Fastest for non-repos)
        if (this.isCommandAvailable('fd') || this.isCommandAvailable('fdfind')) {
            try {
                const files = this.loadFromFd(cwd);
                return this.filterFiles(files);
            } catch (e) {
                // Fallback
            }
        }

        // 3. Fallback to fast-glob (Node.js)
        return this.loadFromGlob(cwd);
    }

    private isGitRepo(cwd: string): boolean {
        try {
            execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    private isCommandAvailable(cmd: string): boolean {
        try {
            // Cross-platform command detection
            // Windows uses 'where', Unix/Linux uses 'command -v'
            const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
            execSync(checkCmd, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    private loadFromGit(cwd: string): string[] {
        // git ls-files -c (cached/committed) -o (others/untracked) --exclude-standard
        const tracked = spawnSync('git', ['ls-files', '-z', '-c'], {
            cwd,
            maxBuffer: 1024 * 1024 * 512, // 512MB
            encoding: 'buffer'
        });

        if (tracked.error || !tracked.stdout) throw new Error('Git failed');

        const trackedFiles = tracked.stdout.toString('utf-8').split('\0').filter(f => f.length > 0);

        // Optimization: Large repos (Chromium), skip untracked scan to save 5-10s
        if (trackedFiles.length > 50000) {
            return trackedFiles;
        }

        const untracked = spawnSync('git', ['ls-files', '-z', '-o', '--exclude-standard'], {
            cwd,
            maxBuffer: 1024 * 1024 * 100,
            encoding: 'buffer'
        });

        if (untracked.stdout) {
            const untrackedFiles = untracked.stdout.toString('utf-8').split('\0').filter(f => f.length > 0);
            return trackedFiles.concat(untrackedFiles);
        }

        return trackedFiles;
    }

    private loadFromFd(cwd: string): string[] {
        const cmd = this.isCommandAvailable('fdfind') ? 'fdfind' : 'fd';
        // fd --type f --color never --print0
        const output = spawnSync(cmd, ['--type', 'f', '--color', 'never', '--print0', '--follow'], {
            cwd,
            maxBuffer: 1024 * 1024 * 512,
            encoding: 'buffer'
        });

        if (output.error || !output.stdout) throw new Error('fd failed');

        return output.stdout.toString('utf-8').split('\0').filter(f => f.length > 0);
    }

    private async loadFromGlob(cwd: string): Promise<string[]> {
        try {
            return await fg(['**/*'], {
                cwd,
                ignore: this.ignorePatterns,
                dot: true,
                onlyFiles: true,
                suppressErrors: true, // Ignore permission errors (EACCES on Windows)
                followSymbolicLinks: false, // Avoid WSL symlink issues on Windows
                deep: 10
            });
        } catch (error) {
            // Handle permission errors gracefully (EPERM, EACCES on Windows)
            const errMsg = error instanceof Error ? error.message : String(error);

            if (errMsg.includes('EPERM') || errMsg.includes('EACCES')) {
                console.error('[NativeLoader] Permission denied accessing some directories. Skipping protected folders.');
                console.error('Tip: Run from your project directory, not system folders like C:\\Users\\<user>\\AppData');
                return [];
            }

            console.error('[NativeLoader] fast-glob error:', errMsg);
            return [];
        }
    }

    /**
     * Efficiently filter files using pre-compiled regexes
     */
    private filterFiles(files: string[]): string[] {
        if (this.ignorePatterns.length === 0) return files;

        const hasPrefixes = this.ignorePrefixes.length > 0;
        const hasRegex = this.compiledIgnores.length > 0;

        return files.filter(file => {
            // Fast prefix check (e.g. node_modules/)
            if (hasPrefixes) {
                for (const prefix of this.ignorePrefixes) {
                    if (file.startsWith(prefix)) return false;
                }
            }

            // Slow regex check
            if (hasRegex) {
                for (const regex of this.compiledIgnores) {
                    if (regex.test(file)) return false;
                }
            }

            return true;
        });
    }

    /**
     * Compile glob patterns to RegExp once
     */
    private compilePatterns(patterns: string[]): RegExp[] {
        return patterns.map(pattern => {
            let regexPattern = pattern
                .replace(/\*\*\//g, '___GLOBSTARSLASH___')
                .replace(/\*\*/g, '___GLOBSTAR___')
                .replace(/\*/g, '___STAR___')
                .replace(/\?/g, '___QUESTION___');

            regexPattern = regexPattern.replace(/\./g, '\\.');

            regexPattern = regexPattern
                .replace(/___GLOBSTARSLASH___/g, '(?:.*/)?')
                .replace(/___GLOBSTAR___/g, '.*')
                .replace(/___STAR___/g, '[^/]*')
                .replace(/___QUESTION___/g, '.');

            return new RegExp(`^${regexPattern}$`);
        });
    }
}
