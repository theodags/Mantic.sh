/**
 * File Metadata Extraction
 * Gathers metadata for progressive disclosure without reading file contents
 */

import fs from 'fs/promises';
import path from 'path';

export interface FileMetadata {
    sizeBytes: number;
    lines: number;
    estimatedTokens: number;
    lastModified: string;
    created: string;
}

/**
 * Get file metadata efficiently (stat only, no content read)
 */
export async function getFileMetadata(filepath: string, cwd: string): Promise<FileMetadata | null> {
    try {
        const fullPath = path.join(cwd, filepath);
        const stats = await fs.stat(fullPath);

        // Estimate lines from file size
        // Average: ~50 bytes per line for code (varies by language)
        const estimatedLines = Math.max(1, Math.round(stats.size / 50));

        // Estimate tokens: ~4 tokens per line (conservative)
        const estimatedTokens = estimatedLines * 4;

        return {
            sizeBytes: stats.size,
            lines: estimatedLines,
            estimatedTokens,
            lastModified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString()
        };
    } catch (error) {
        // File might not exist or be accessible
        return null;
    }
}

/**
 * Batch get metadata for multiple files (parallel)
 */
export async function getFileMetadataBatch(
    filepaths: string[],
    cwd: string,
    maxConcurrency: number = 50
): Promise<Map<string, FileMetadata>> {
    const results = new Map<string, FileMetadata>();

    // Process in batches to avoid overwhelming filesystem
    for (let i = 0; i < filepaths.length; i += maxConcurrency) {
        const batch = filepaths.slice(i, i + maxConcurrency);
        const promises = batch.map(async (filepath) => {
            const metadata = await getFileMetadata(filepath, cwd);
            return { filepath, metadata };
        });

        const batchResults = await Promise.all(promises);

        for (const { filepath, metadata } of batchResults) {
            if (metadata) {
                results.set(filepath, metadata);
            }
        }
    }

    return results;
}

/**
 * Calculate confidence score based on score distribution
 * High confidence: score is well above average
 * Low confidence: score is close to average or median
 */
export function calculateConfidence(
    fileScore: number,
    allScores: number[]
): number {
    if (allScores.length < 2) return 1.0;

    // Calculate statistics
    const sorted = [...allScores].sort((a, b) => b - a);
    const max = sorted[0];
    const median = sorted[Math.floor(sorted.length / 2)];
    const avg = sorted.reduce((sum, s) => sum + s, 0) / sorted.length;

    // Confidence based on how far above median/average
    // - Files scoring 2x median = high confidence (0.9+)
    // - Files scoring close to median = low confidence (0.3-0.5)
    const relativeToMedian = median > 0 ? fileScore / median : 1.0;
    const relativeToAvg = avg > 0 ? fileScore / avg : 1.0;

    // Weighted combination
    const confidence = Math.min(1.0,
        (relativeToMedian * 0.6 + relativeToAvg * 0.4) / 2
    );

    return Math.max(0.0, Math.min(1.0, confidence));
}
