/**
 * Entity Extractor
 * Extracts specific entities (files, functions, classes) from user queries
 * Used for hallucination detection - validate that mentioned entities actually exist
 */

export interface ExtractedEntities {
    files: string[];        // e.g., "Button.tsx", "auth.ts"
    functions: string[];    // e.g., "authenticate", "handleSubmit"
    classes: string[];      // e.g., "UserService", "ApiClient"
    components: string[];   // e.g., "LoginForm", "Header"
    errors: string[];       // e.g., "TypeError", "ENOENT"
}

/**
 * Extract entities from a user query
 * Looks for:
 * - File references (*.ts, *.tsx, *.js, etc.)
 * - CamelCase identifiers (functions, classes, components)
 * - Error messages
 */
export function extractEntities(query: string): ExtractedEntities {
    const entities: ExtractedEntities = {
        files: [],
        functions: [],
        classes: [],
        components: [],
        errors: []
    };

    // 1. Extract file references (filename.ext)
    const filePattern = /\b([a-z0-9_-]+\.(tsx?|jsx?|py|go|rs|java|rb|php|vue|svelte))\b/gi;
    const fileMatches = query.matchAll(filePattern);
    for (const match of fileMatches) {
        entities.files.push(match[1]);
    }

    // 2. Extract PascalCase identifiers (Components, Classes)
    const pascalCasePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    const pascalMatches = query.matchAll(pascalCasePattern);
    for (const match of pascalMatches) {
        const name = match[1];
        // Heuristic: if ends with common component suffixes, it's a component
        if (/^(Button|Form|Modal|Card|Header|Footer|Layout|Page|View|Panel|Menu|List|Item|Input|Select|Table|Row|Cell)/.test(name) ||
            /(Button|Form|Modal|Card|Header|Footer|Layout|Page|View|Panel|Menu|List|Item|Input|Select|Table|Row|Cell)$/.test(name)) {
            entities.components.push(name);
        } else if (/Service|Client|Controller|Handler|Manager|Provider|Factory|Repository|Store|Context$/.test(name)) {
            entities.classes.push(name);
        } else {
            // Default to class
            entities.classes.push(name);
        }
    }

    // 3. Extract camelCase identifiers (functions)
    const camelCasePattern = /\b([a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+)\b/g;
    const camelMatches = query.matchAll(camelCasePattern);
    for (const match of camelMatches) {
        const name = match[1];
        // Filter out common words
        if (!['typeError', 'useState', 'useEffect', 'onClick', 'onChange'].includes(name)) {
            entities.functions.push(name);
        }
    }

    // 4. Extract error patterns
    const errorPatterns = [
        /\b([A-Z][a-z]+Error)\b/g,           // TypeError, ReferenceError, etc.
        /\b(E[A-Z]+)\b/g,                     // ENOENT, EACCES, etc.
        /\berror:?\s+([A-Z][A-Z_]+)\b/gi,     // error: MODULE_NOT_FOUND
        /\b(\d{3})\s+error\b/gi               // 404 error, 500 error
    ];

    for (const pattern of errorPatterns) {
        const matches = query.matchAll(pattern);
        for (const match of matches) {
            entities.errors.push(match[1]);
        }
    }

    // 5. Extract quoted strings (often file/function names)
    const quotedPattern = /["'`]([a-zA-Z0-9_.-]+)["'`]/g;
    const quotedMatches = query.matchAll(quotedPattern);
    for (const match of quotedMatches) {
        const quoted = match[1];
        // If it looks like a file, add to files
        if (/\.[a-z]{2,4}$/i.test(quoted)) {
            entities.files.push(quoted);
        } else if (/^[A-Z]/.test(quoted)) {
            // PascalCase in quotes
            entities.classes.push(quoted);
        } else if (/^[a-z][a-zA-Z0-9]*$/.test(quoted)) {
            // camelCase in quotes
            entities.functions.push(quoted);
        }
    }

    // Deduplicate
    entities.files = [...new Set(entities.files)];
    entities.functions = [...new Set(entities.functions)];
    entities.classes = [...new Set(entities.classes)];
    entities.components = [...new Set(entities.components)];
    entities.errors = [...new Set(entities.errors)];

    return entities;
}

/**
 * Simple fuzzy match (Levenshtein distance)
 * Returns similarity score 0-1 (1 = exact match)
 */
export function fuzzyMatch(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    // Quick exact match
    if (s1 === s2) return 1.0;

    // Quick substring match
    if (s1.includes(s2) || s2.includes(s1)) {
        return 0.9;
    }

    // Levenshtein distance
    const matrix: number[][] = [];

    for (let i = 0; i <= s2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= s1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
        for (let j = 1; j <= s1.length; j++) {
            if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    const maxLen = Math.max(s1.length, s2.length);
    const distance = matrix[s2.length][s1.length];
    return 1 - (distance / maxLen);
}

/**
 * Find close matches in a list of candidates
 * Returns matches with similarity > threshold (default 0.7)
 */
export function findClosestMatches(
    target: string,
    candidates: string[],
    threshold: number = 0.7,
    maxResults: number = 3
): Array<{ match: string; similarity: number }> {
    const results = candidates
        .map(candidate => ({
            match: candidate,
            similarity: fuzzyMatch(target, candidate)
        }))
        .filter(r => r.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxResults);

    return results;
}
