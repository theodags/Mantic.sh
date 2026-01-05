import { execSync, spawnSync } from 'child_process';

// Cache git repo status per directory
const gitRepoCache = new Map<string, boolean>();

/**
 * Check if a directory is inside a git repository (cached)
 */
export function isGitRepo(cwd: string): boolean {
    if (gitRepoCache.has(cwd)) {
        return gitRepoCache.get(cwd)!;
    }

    try {
        execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
        gitRepoCache.set(cwd, true);
        return true;
    } catch {
        gitRepoCache.set(cwd, false);
        return false;
    }
}

/**
 * Get current git status (short format) for context
 */
export function getGitState(cwd: string): string {
    if (!isGitRepo(cwd)) {
        return '';
    }

    try {
        const status = execSync('git status --short', { cwd }).toString().trim();
        if (!status) return '';

        // Limit output length
        const lines = status.split('\n');
        if (lines.length > 20) {
            return lines.slice(0, 20).join('\n') + `\n...and ${lines.length - 20} more`;
        }
        return status;
    } catch {
        return '';
    }
}

/**
 * Get recently modified files from git status
 * Returns a set of file paths (relative to cwd)
 */
export function getGitModifiedFiles(cwd: string): Set<string> {
    const recentFiles = new Set<string>();

    if (!isGitRepo(cwd)) {
        return recentFiles;
    }

    try {
        const status = execSync('git status --porcelain', { cwd, timeout: 2000 }).toString();

        // Parse git status output: "M  src/file.ts", " M src/file.ts", "?? src/file.ts"
        const lines = status.trim().split('\n').filter(l => l.length > 0);
        for (const line of lines) {
            const filePath = line.substring(3).trim(); // Skip status prefix
            if (filePath && !filePath.includes('node_modules')) {
                recentFiles.add(filePath);
            }
        }
    } catch {
        // Git command failed, return empty set
    }

    return recentFiles;
}

/**
 * Clear the git repo cache (useful for testing)
 */
export function clearGitCache(): void {
    gitRepoCache.clear();
}

/**
 * Get all files in the git repository (respecting .gitignore)
 * This is MUCH faster than fast-glob for large repos (e.g. 0.1s vs 6s for Chromium)
 */
export function getGitFiles(cwd: string): string[] {
    if (!isGitRepo(cwd)) {
        return [];
    }

    try {
        // Step 1: Get tracked files (FAST - ~0.3s for Chromium)
        const tracked = spawnSync('git', ['ls-files', '-z', '-c'], {
            cwd,
            maxBuffer: 1024 * 1024 * 500, // 500MB
            encoding: 'buffer'
        });

        if (!tracked.stdout) return [];

        const trackedOutput = tracked.stdout.toString('utf-8');
        const trackedFiles = trackedOutput.split('\0').filter(f => f.length > 0);

        // Heuristic: If repo is massive (>50k files), skip untracked files scan
        // because 'git ls-files -o' takes ~6s on Chromium vs 0.3s for tracked.
        if (trackedFiles.length > 50000) {
            // We could log a warning here if we had a logger, but for now we prioritize speed.
            return trackedFiles;
        }

        // Step 2: Get untracked files (slower on large repos)
        const untracked = spawnSync('git', ['ls-files', '-z', '-o', '--exclude-standard'], {
            cwd,
            maxBuffer: 1024 * 1024 * 500, // 500MB
            encoding: 'buffer'
        });

        if (!untracked.stdout) return trackedFiles;

        const untrackedOutput = untracked.stdout.toString('utf-8');
        const untrackedFiles = untrackedOutput.split('\0').filter(f => f.length > 0);

        return trackedFiles.concat(untrackedFiles);
    } catch {
        return [];
    }
}
