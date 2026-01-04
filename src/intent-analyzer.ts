import { IntentAnalysis, IntentCategory } from './types.js';
import { extractEntities } from './entity-extractor.js';

// Intent pattern matching
const INTENT_PATTERNS: Record<IntentCategory, RegExp> = {
    UI: /button|modal|dialog|form|input|card|menu|dropdown|component|nav|header|footer|sidebar|screen|page|view|onboarding|welcome|dashboard|panel|widget|layout/i,
    auth: /auth|login|signup|sign\s*up|sign\s*in|user|profile|session|password|token|credential/i,
    styling: /style|theme|color|dark|light|css|tailwind|rounded|border|font|spacing|layout|design/i,
    performance: /slow|fast|optimize|cache|lazy|memo|performance|speed|bundle|load/i,
    backend: /api|endpoint|server|database|query|mutation|fetch|request|response|route|booking|reservation|appointment|confirmation|notification|email|payment|webhook|workflow|schedule|calendar|event|slot|availability|stripe|paypal|checkout|subscription|invoice|billing|charge|refund|merchant|transaction/i,
    testing: /test|spec|jest|vitest|cypress|e2e|unit|integration|mock/i,
    config: /config|env|settings|setup|install|dependency|package|tsconfig/i,
    general: /.*/ // Matches everything as fallback
};

// Stop words to filter out when extracting keywords
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'could', 'may', 'might', 'must', 'can', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
    'this', 'that', 'these', 'those', 'all', 'some', 'want', 'need', 'make',
    'get', 'fix', 'add', 'remove', 'update', 'change', 'create',
    // Question/location words (not useful for file matching)
    'where', 'what', 'when', 'why', 'how', 'who', 'which', 'locat', 'find', 'show'
]);

// Sub-patterns for finer classification
const SUB_PATTERNS: Partial<Record<IntentCategory, Record<string, RegExp>>> = {
    UI: {
        styling: /style|theme|color|css|tailwind|rounded|border|spacing|dark|light/i,
        structure: /layout|component|sidebar|header|footer|menu|wrapper|container/i,
        interaction: /click|hover|focus|event|handler|modal|dialog/i
    },
    auth: {
        flow: /login|signup|reset|flow/i,
        session: /session|token|cookie|jwt/i
    },
    backend: {
        db: /database|sql|prisma|supabase|table|schema/i,
        api: /api|endpoint|fetch|rest|graphql/i
    }
};

export class IntentAnalyzer {
    /**
     * Analyze user prompt to detect intent category
     */
    async analyze(prompt: string): Promise<IntentAnalysis> {
        const originalPrompt = prompt; // Save original before normalizing
        const normalizedPrompt = prompt.toLowerCase();
        const words = normalizedPrompt.split(/\s+/);

        // Count matches for each category
        const matches = new Map<IntentCategory, number>();

        for (const [category, pattern] of Object.entries(INTENT_PATTERNS)) {
            if (category === 'general') continue; // Skip general for scoring

            // Count how many words match the pattern
            let matchCount = 0;
            for (const word of words) {
                if (pattern.test(word)) {
                    matchCount++;
                }
            }

            if (matchCount > 0) {
                matches.set(category as IntentCategory, matchCount);
            }
        }

        // Find the category with the most matches
        let bestCategory: IntentCategory = 'general';
        let bestScore = 0;
        const matchedPatterns: string[] = [];

        for (const [category, score] of matches.entries()) {
            if (score > bestScore) {
                bestScore = score;
                bestCategory = category;
            }
            matchedPatterns.push(`${category}:${score}`);
        }

        // Extract keywords from prompt
        const keywords = this.extractKeywords(normalizedPrompt);

        // Calculate confidence based on match strength
        const confidence = this.calculateConfidence(bestScore, matches.size, words.length);

        // Extract entities
        const entities = this.extractEntities(originalPrompt);

        // Determine sub-category
        let subCategory: string | undefined;
        if (bestCategory !== 'general' && SUB_PATTERNS[bestCategory]) {
            for (const [sub, pattern] of Object.entries(SUB_PATTERNS[bestCategory]!)) {
                if (pattern.test(normalizedPrompt)) {
                    subCategory = sub;
                    break; // Take first match
                }
            }
        }

        return {
            category: bestCategory,
            keywords,
            confidence,
            matchedPatterns,
            originalPrompt,
            subCategory,
            entities
        };
    }

    /**
     * Extract specific entities like files, functions, and error messages
     * Uses comprehensive entity extractor for hallucination detection
     */
    private extractEntities(prompt: string): { files?: string[], functions?: string[], errors?: string[] } {
        const extracted = extractEntities(prompt);

        return {
            files: extracted.files.length > 0 ? extracted.files : undefined,
            functions: extracted.functions.length > 0 ? extracted.functions : undefined,
            errors: extracted.errors.length > 0 ? extracted.errors : undefined
        };
    }

    /**
     * Extract meaningful keywords from user prompt
     *
     * CRITICAL: Preserve filenames like "nc-project", "app-sidebar"
     * Users often say "in the file nc-project" and we need to match exactly!
     */
    private extractKeywords(prompt: string): string[] {
        const keywords: string[] = [];

        // 1. Extract filename patterns (kebab-case, PascalCase)
        const filenamePattern = /\b([a-z]+-[a-z0-9-]+|[A-Z][a-zA-Z]+)\b/g;
        const filenames = prompt.match(filenamePattern) || [];
        filenames.forEach(name => {
            keywords.push(name.toLowerCase());
        });

        // 2. Tokenize remaining text: split on non-alphanumeric BUT preserve hyphens in filenames
        const tokens = prompt
            .toLowerCase()
            .replace(/ing\b|ed\b|s\b|es\b/g, '') // Simple stemming
            .split(/[^a-z0-9-]+/)  // Keep hyphens
            .filter(token => token.length > 2);

        // Filter out stop words and already-added filenames
        tokens.forEach(token => {
            if (!STOP_WORDS.has(token) && !keywords.includes(token)) {
                keywords.push(token);
            }
        });

        // Deduplicate and return
        return [...new Set(keywords)];
    }

    /**
     * Calculate confidence score based on match strength, uniqueness, and prompt length
     *
     * FIXED: Don't penalize short prompts. If user says "fix the button", that's
     * clearly UI with high confidence even though only 1/3 words match.
     */
    private calculateConfidence(bestScore: number, totalCategories: number, totalWords: number): number {
        if (bestScore === 0) {
            return 0.0; // No matches
        }

        // Start with a base confidence based on having ANY match
        let confidence = 0.6; // Base: 60% if we matched at all

        // Boost for multiple keyword matches (stronger signal)
        if (bestScore >= 3) {
            confidence = 0.95; // 3+ matches = very confident
        } else if (bestScore >= 2) {
            confidence = 0.85; // 2 matches = highly confident
        } else if (bestScore === 1) {
            confidence = 0.75; // 1 match = confident
        }

        // Reduce confidence if multiple categories matched (ambiguous)
        if (totalCategories > 2) {
            confidence *= 0.7; // 30% penalty for high ambiguity
        } else if (totalCategories > 1) {
            confidence *= 0.85; // 15% penalty for some ambiguity
        }

        return Math.max(0.0, Math.min(1.0, confidence));
    }
}
