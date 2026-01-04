/**
 * Entity Validator
 * Validates extracted entities against actual codebase to prevent hallucinations
 */

import path from 'path';
import { ExtractedEntities, findClosestMatches } from './entity-extractor.js';
import { CacheIndex } from './types.js';

export interface ValidationWarning {
    type: 'file_not_found' | 'function_not_found' | 'class_not_found' | 'component_not_found';
    entity: string;
    message: string;
    suggestions: string[];
}

export interface ValidationResult {
    isValid: boolean;
    warnings: ValidationWarning[];
    foundEntities: {
        files: string[];
        functions: string[];
        classes: string[];
        components: string[];
    };
}

/**
 * Validate extracted entities against the codebase
 * Returns warnings for entities that don't exist + suggestions for close matches
 */
export function validateEntities(
    entities: ExtractedEntities,
    allFiles: string[],
    cache: CacheIndex | null
): ValidationResult {
    const warnings: ValidationWarning[] = [];
    const foundEntities = {
        files: [] as string[],
        functions: [] as string[],
        classes: [] as string[],
        components: [] as string[]
    };

    // 1. Validate file references
    for (const file of entities.files) {
        const found = allFiles.some(f => {
            const basename = path.basename(f);
            return basename === file || basename.toLowerCase() === file.toLowerCase();
        });

        if (found) {
            foundEntities.files.push(file);
        } else {
            // Find close matches
            const basenames = allFiles.map(f => path.basename(f));
            const suggestions = findClosestMatches(file, basenames, 0.6, 3);

            warnings.push({
                type: 'file_not_found',
                entity: file,
                message: `File "${file}" not found in codebase`,
                suggestions: suggestions.map(s => s.match)
            });
        }
    }

    // 2. Validate functions (requires cache)
    if (cache) {
        for (const func of entities.functions) {
            let found = false;
            const allFunctions: string[] = [];

            // Collect all function names from cache
            for (const fileEntry of Object.values(cache.files)) {
                if (fileEntry.functions) {
                    allFunctions.push(...fileEntry.functions.map(f => f.name));
                }
                if (fileEntry.exports) {
                    allFunctions.push(...fileEntry.exports.filter(e => e.type === 'function').map(e => e.name));
                }
            }

            found = allFunctions.some(f =>
                f === func || f.toLowerCase() === func.toLowerCase()
            );

            if (found) {
                foundEntities.functions.push(func);
            } else if (allFunctions.length > 0) {
                const suggestions = findClosestMatches(func, allFunctions, 0.7, 3);
                if (suggestions.length > 0) {
                    warnings.push({
                        type: 'function_not_found',
                        entity: func,
                        message: `Function "${func}" not found in codebase`,
                        suggestions: suggestions.map(s => s.match)
                    });
                }
            }
        }

        // 3. Validate classes
        for (const cls of entities.classes) {
            let found = false;
            const allClasses: string[] = [];

            // Collect all class names from cache
            for (const fileEntry of Object.values(cache.files)) {
                if (fileEntry.classes) {
                    allClasses.push(...fileEntry.classes);
                }
                if (fileEntry.exports) {
                    allClasses.push(...fileEntry.exports.filter(e => e.type === 'class').map(e => e.name));
                }
            }

            found = allClasses.some(c =>
                c === cls || c.toLowerCase() === cls.toLowerCase()
            );

            if (found) {
                foundEntities.classes.push(cls);
            } else if (allClasses.length > 0) {
                const suggestions = findClosestMatches(cls, allClasses, 0.7, 3);
                if (suggestions.length > 0) {
                    warnings.push({
                        type: 'class_not_found',
                        entity: cls,
                        message: `Class "${cls}" not found in codebase`,
                        suggestions: suggestions.map(s => s.match)
                    });
                }
            }
        }

        // 4. Validate components (React/Vue)
        for (const component of entities.components) {
            let found = false;
            const allComponents: string[] = [];

            // Collect all component names from cache
            for (const fileEntry of Object.values(cache.files)) {
                if (fileEntry.components) {
                    allComponents.push(...fileEntry.components.map(c => c.name));
                }
            }

            found = allComponents.some(c =>
                c === component || c.toLowerCase() === component.toLowerCase()
            );

            if (found) {
                foundEntities.components.push(component);
            } else if (allComponents.length > 0) {
                const suggestions = findClosestMatches(component, allComponents, 0.7, 3);
                if (suggestions.length > 0) {
                    warnings.push({
                        type: 'component_not_found',
                        entity: component,
                        message: `Component "${component}" not found in codebase`,
                        suggestions: suggestions.map(s => s.match)
                    });
                }
            }
        }
    }

    return {
        isValid: warnings.length === 0,
        warnings,
        foundEntities
    };
}

/**
 * Check if a query appears to be asking about non-existent code
 * Returns true if the query mentions specific entities that don't exist
 */
export function isLikelyHallucination(
    entities: ExtractedEntities,
    validationResult: ValidationResult
): boolean {
    // If no entities extracted, not a hallucination (generic query)
    const totalEntities = entities.files.length + entities.functions.length +
                         entities.classes.length + entities.components.length;

    if (totalEntities === 0) {
        return false;
    }

    // If more than 50% of extracted entities don't exist, likely hallucination
    const totalFound = validationResult.foundEntities.files.length +
                      validationResult.foundEntities.functions.length +
                      validationResult.foundEntities.classes.length +
                      validationResult.foundEntities.components.length;

    const notFoundRatio = 1 - (totalFound / totalEntities);
    return notFoundRatio > 0.5;
}
