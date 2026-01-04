import type * as ts from 'typescript';
import {
    ExportInfo,
    ImportInfo,
    ComponentInfo,
    FunctionInfo,
    FileEntry,
} from './types.js';

// Global variable to hold the loaded TypeScript module
let tsModule: typeof ts;

function loadTypeScript() {
    if (tsModule) return;
    try {
        // Try to load from the user's project first (where the command is run)
        const userTsPath = require.resolve('typescript', { paths: [process.cwd()] });
        tsModule = require(userTsPath);
    } catch (e) {
        try {
            // Fallback to our (dev) dependency or global
            tsModule = require('typescript');
        } catch (e2) {
            throw new Error('TypeScript not found. Please install typescript in your project: npm install -D typescript');
        }
    }
}

// Keyword patterns for semantic search
const KEYWORD_PATTERNS = [
    /button/i, /modal/i, /dialog/i, /form/i, /input/i,
    /header/i, /footer/i, /nav/i, /menu/i, /sidebar/i,
    /theme/i, /dark/i, /light/i, /color/i, /style/i,
    /auth/i, /login/i, /signup/i, /user/i, /profile/i,
    /api/i, /fetch/i, /query/i, /mutation/i,
    /loading/i, /error/i, /success/i, /state/i,
    /card/i, /list/i, /table/i, /grid/i, /layout/i,
    /dropdown/i, /select/i, /checkbox/i, /radio/i, /switch/i,
];

export interface ParsedFileData {
    exports: ExportInfo[];
    imports: ImportInfo[];
    components: ComponentInfo[];
    keywords: string[];
    functions: FunctionInfo[];
    classes: string[];
    types: string[];
    language: 'typescript' | 'javascript' | 'tsx' | 'jsx';
}

export class FileParser {
    /**
     * Parse a source file and extract semantic information
     */
    parse(filePath: string, content: string): ParsedFileData {
        loadTypeScript();

        const isTsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
        const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');

        const language: ParsedFileData['language'] =
            filePath.endsWith('.tsx') ? 'tsx' :
                filePath.endsWith('.ts') ? 'typescript' :
                    filePath.endsWith('.jsx') ? 'jsx' : 'javascript';

        const sourceFile = tsModule.createSourceFile(
            filePath,
            content,
            tsModule.ScriptTarget.Latest,
            true,
            isTsx ? tsModule.ScriptKind.TSX : isTypeScript ? tsModule.ScriptKind.TS : tsModule.ScriptKind.JS
        );

        const result: ParsedFileData = {
            exports: [],
            imports: [],
            components: [],
            keywords: [],
            functions: [],
            classes: [],
            types: [],
            language,
        };

        const keywordSet = new Set<string>();

        // Visitor pattern to traverse AST
        const visit = (node: ts.Node) => {
            // Extract exports
            if (tsModule.isExportDeclaration(node)) {
                this.extractExportDeclaration(node, result);
            } else if (tsModule.isExportAssignment(node)) {
                this.extractExportAssignment(node, result);
            }

            // Check for exported declarations
            const hasExportModifier = tsModule.canHaveModifiers(node) &&
                tsModule.getModifiers(node)?.some((m: ts.Modifier) => m.kind === tsModule.SyntaxKind.ExportKeyword);

            if (hasExportModifier) {
                if (tsModule.isFunctionDeclaration(node) && node.name) {
                    result.exports.push({
                        name: node.name.text,
                        type: 'function',
                        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    });
                } else if (tsModule.isClassDeclaration(node) && node.name) {
                    result.exports.push({
                        name: node.name.text,
                        type: 'class',
                        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    });
                } else if (tsModule.isVariableStatement(node)) {
                    node.declarationList.declarations.forEach(decl => {
                        if (tsModule.isIdentifier(decl.name)) {
                            result.exports.push({
                                name: decl.name.text,
                                type: 'const',
                                line: sourceFile.getLineAndCharacterOfPosition(decl.getStart()).line + 1,
                            });
                        }
                    });
                } else if (tsModule.isTypeAliasDeclaration(node) && node.name) {
                    result.exports.push({
                        name: node.name.text,
                        type: 'type',
                        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    });
                } else if (tsModule.isInterfaceDeclaration(node) && node.name) {
                    result.exports.push({
                        name: node.name.text,
                        type: 'interface',
                        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    });
                }
            }

            // Extract imports
            if (tsModule.isImportDeclaration(node)) {
                this.extractImportDeclaration(node, result);
            }

            // Extract React/Vue components
            if (isTsx && this.isComponentDeclaration(node)) {
                this.extractComponent(node, sourceFile, result);
            }

            // Extract functions
            if (tsModule.isFunctionDeclaration(node) && node.name) {
                const modifiers = tsModule.canHaveModifiers(node) ? tsModule.getModifiers(node) : undefined;
                const isExported = modifiers?.some((m: ts.Modifier) => m.kind === tsModule.SyntaxKind.ExportKeyword) || false;
                const isAsync = modifiers?.some((m: ts.Modifier) => m.kind === tsModule.SyntaxKind.AsyncKeyword) || false;
                result.functions.push({
                    name: node.name.text,
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    isAsync,
                    isExported,
                });
            }

            // Extract classes
            if (tsModule.isClassDeclaration(node) && node.name) {
                result.classes.push(node.name.text);
            }

            // Extract types/interfaces
            if (tsModule.isTypeAliasDeclaration(node) && node.name) {
                result.types.push(node.name.text);
            } else if (tsModule.isInterfaceDeclaration(node) && node.name) {
                result.types.push(node.name.text);
            }

            // Extract semantic keywords
            this.extractKeywords(node, keywordSet);

            tsModule.forEachChild(node, visit);
        };

        visit(sourceFile);

        // Convert keyword set to sorted array
        result.keywords = Array.from(keywordSet).sort();

        return result;
    }

    private extractExportDeclaration(node: ts.ExportDeclaration, result: ParsedFileData) {
        if (node.exportClause && tsModule.isNamedExports(node.exportClause)) {
            node.exportClause.elements.forEach(element => {
                result.exports.push({
                    name: element.name.text,
                    type: 'variable',
                });
            });
        }
    }

    private extractExportAssignment(node: ts.ExportAssignment, result: ParsedFileData) {
        result.exports.push({
            name: 'default',
            type: 'default',
        });
    }

    private extractImportDeclaration(node: ts.ImportDeclaration, result: ParsedFileData) {
        const moduleSpecifier = node.moduleSpecifier;
        if (!tsModule.isStringLiteral(moduleSpecifier)) return;

        const source = moduleSpecifier.text;
        const names: string[] = [];
        let isDefault = false;

        if (node.importClause) {
            // Default import
            if (node.importClause.name) {
                names.push(node.importClause.name.text);
                isDefault = true;
            }

            // Named imports
            if (node.importClause.namedBindings) {
                if (tsModule.isNamedImports(node.importClause.namedBindings)) {
                    node.importClause.namedBindings.elements.forEach(element => {
                        names.push(element.name.text);
                    });
                } else if (tsModule.isNamespaceImport(node.importClause.namedBindings)) {
                    names.push(node.importClause.namedBindings.name.text);
                }
            }
        }

        result.imports.push({
            source,
            names,
            isDefault,
        });
    }

    private isComponentDeclaration(node: ts.Node): boolean {
        // Function component
        if (tsModule.isFunctionDeclaration(node) && node.name) {
            const name = node.name.text;
            return /^[A-Z]/.test(name); // Starts with capital letter
        }

        // Arrow function component
        if (tsModule.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
                if (tsModule.isIdentifier(decl.name) && /^[A-Z]/.test(decl.name.text)) {
                    if (decl.initializer && (
                        tsModule.isArrowFunction(decl.initializer) ||
                        tsModule.isFunctionExpression(decl.initializer)
                    )) {
                        return true;
                    }
                }
            }
        }

        // Class component
        if (tsModule.isClassDeclaration(node) && node.name) {
            const name = node.name.text;
            if (/^[A-Z]/.test(name)) {
                // Check if it extends React.Component or Component
                if (node.heritageClauses) {
                    for (const clause of node.heritageClauses) {
                        for (const type of clause.types) {
                            const text = type.expression.getText();
                            if (text.includes('Component')) {
                                return true;
                            }
                        }
                    }
                }
                // Even without heritage clause, capital letter suggests component
                return true;
            }
        }

        return false;
    }

    private extractComponent(node: ts.Node, sourceFile: ts.SourceFile, result: ParsedFileData) {
        let name = '';
        let type: ComponentInfo['type'] = 'function';

        if (tsModule.isFunctionDeclaration(node) && node.name) {
            name = node.name.text;
            type = 'function';
        } else if (tsModule.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
                if (tsModule.isIdentifier(decl.name)) {
                    name = decl.name.text;
                    if (decl.initializer && tsModule.isArrowFunction(decl.initializer)) {
                        type = 'arrow';
                    }
                }
            }
        } else if (tsModule.isClassDeclaration(node) && node.name) {
            name = node.name.text;
            type = 'class';
        }

        if (name) {
            result.components.push({
                name,
                type,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
        }
    }

    private extractKeywords(node: ts.Node, keywordSet: Set<string>) {
        // Check identifiers
        if (tsModule.isIdentifier(node)) {
            const name = node.text;
            for (const pattern of KEYWORD_PATTERNS) {
                if (pattern.test(name)) {
                    keywordSet.add(name.toLowerCase());
                }
            }
        }

        // CRITICAL FIX: Extract JSX text content (e.g., <Button>Share</Button>)
        // This ensures button labels and other UI text get indexed
        if (tsModule.isJsxText(node)) {
            const text = node.text.trim();
            if (text.length > 0 && text.length < 30) { // Reasonable length for keywords
                // Extract individual words
                const words = text.split(/\s+/);
                words.forEach(word => {
                    const cleaned = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
                    if (cleaned.length >= 3) { // Min 3 chars to avoid noise
                        keywordSet.add(cleaned);
                    }
                });
            }
        }

        // Check string literals
        if (tsModule.isStringLiteral(node)) {
            const text = node.text;
            for (const pattern of KEYWORD_PATTERNS) {
                if (pattern.test(text)) {
                    // Extract individual words from the string
                    const words = text.toLowerCase().split(/[^a-z]+/);
                    words.forEach(word => {
                        if (word && pattern.test(word)) {
                            keywordSet.add(word);
                        }
                    });
                }
            }
        }

        // Check JSX elements for component names and props
        if (tsModule.isJsxElement(node) || tsModule.isJsxSelfClosingElement(node)) {
            const tagName = tsModule.isJsxElement(node)
                ? node.openingElement.tagName.getText()
                : node.tagName.getText();

            for (const pattern of KEYWORD_PATTERNS) {
                if (pattern.test(tagName)) {
                    keywordSet.add(tagName.toLowerCase());
                }
            }
        }
    }
}

/**
 * Helper function to determine if a file should be parsed
 */
export function shouldParseFile(filePath: string): boolean {
    const ext = filePath.toLowerCase();
    return (
        (ext.endsWith('.ts') ||
            ext.endsWith('.tsx') ||
            ext.endsWith('.js') ||
            ext.endsWith('.jsx')) &&
        !ext.includes('.test.') &&
        !ext.includes('.spec.') &&
        !ext.endsWith('.d.ts')
    );
}
