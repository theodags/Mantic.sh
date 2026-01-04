/**
 * Session Manager
 * Tracks agent interactions across multiple queries for context carryover
 * Enables coherent multi-turn workflows with memory
 */

import fs from 'fs/promises';
import path from 'path';

export interface SessionFile {
    path: string;
    viewCount: number;
    lastViewed: string;  // ISO timestamp
    relevanceScore: number;  // Score from when it was first viewed
    blastRadius?: 'small' | 'medium' | 'large' | 'critical';
    notes?: string;  // Optional agent notes
}

export interface SessionMetadata {
    id: string;
    name: string;
    created: string;
    lastActive: string;
    queryCount: number;
    intent?: string;  // Overall session intent (e.g., "fix-auth-bug")
    status: 'active' | 'ended';
}

export interface Session {
    metadata: SessionMetadata;
    viewedFiles: Map<string, SessionFile>;
    queryHistory: Array<{
        query: string;
        timestamp: string;
        filesReturned: number;
    }>;
    insights: string[];  // Key findings/notes from the session
}

export class SessionManager {
    private sessionsDir: string;
    private activeSession: Session | null = null;

    constructor(projectRoot: string) {
        this.sessionsDir = path.join(projectRoot, '.mantic', 'sessions');
    }

    /**
     * Initialize sessions directory
     */
    private async ensureSessionsDir(): Promise<void> {
        try {
            await fs.mkdir(this.sessionsDir, { recursive: true });
        } catch (error) {
            // Directory already exists or can't be created
        }
    }

    /**
     * Generate unique session ID
     */
    private generateSessionId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `session-${timestamp}-${random}`;
    }

    /**
     * Start a new session
     */
    async startSession(name: string, intent?: string): Promise<Session> {
        await this.ensureSessionsDir();

        const session: Session = {
            metadata: {
                id: this.generateSessionId(),
                name,
                created: new Date().toISOString(),
                lastActive: new Date().toISOString(),
                queryCount: 0,
                intent,
                status: 'active'
            },
            viewedFiles: new Map(),
            queryHistory: [],
            insights: []
        };

        this.activeSession = session;
        await this.saveSession(session);

        return session;
    }

    /**
     * Load an existing session
     */
    async loadSession(idOrName: string): Promise<Session | null> {
        await this.ensureSessionsDir();

        try {
            // 1. Try loading as ID first
            let sessionPath = path.join(this.sessionsDir, `${idOrName}.json`);

            // 2. If not found or not a UUID, search by name
            try {
                await fs.access(sessionPath);
            } catch {
                // Not found by ID, look for name
                const sessions = await this.listSessions();
                const match = sessions.find(s => s.name === idOrName && s.status === 'active');
                if (match) {
                    sessionPath = path.join(this.sessionsDir, `${match.id}.json`);
                } else {
                    return null;
                }
            }

            const content = await fs.readFile(sessionPath, 'utf-8');
            const data = JSON.parse(content);

            // Reconstruct Map from JSON
            const session: Session = {
                ...data,
                viewedFiles: new Map(Object.entries(data.viewedFiles))
            };

            this.activeSession = session;
            return session;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get active session
     */
    getActiveSession(): Session | null {
        return this.activeSession;
    }

    /**
     * Save session to disk
     */
    private async saveSession(session: Session): Promise<void> {
        await this.ensureSessionsDir();

        const sessionPath = path.join(this.sessionsDir, `${session.metadata.id}.json`);

        // Convert Map to object for JSON serialization
        const serialized = {
            ...session,
            viewedFiles: Object.fromEntries(session.viewedFiles)
        };

        await fs.writeFile(sessionPath, JSON.stringify(serialized, null, 2), 'utf-8');
    }

    /**
     * Record a query in the active session
     */
    async recordQuery(query: string, filesReturned: number): Promise<void> {
        if (!this.activeSession) return;

        this.activeSession.queryHistory.push({
            query,
            timestamp: new Date().toISOString(),
            filesReturned
        });

        this.activeSession.metadata.queryCount++;
        this.activeSession.metadata.lastActive = new Date().toISOString();

        await this.saveSession(this.activeSession);
    }

    /**
     * Record file views in the active session
     */
    async recordFileViews(files: Array<{
        path: string;
        relevanceScore: number;
        blastRadius?: 'small' | 'medium' | 'large' | 'critical';
    }>): Promise<void> {
        if (!this.activeSession) return;

        const now = new Date().toISOString();

        for (const file of files) {
            const existing = this.activeSession.viewedFiles.get(file.path);

            if (existing) {
                // Increment view count
                existing.viewCount++;
                existing.lastViewed = now;
                // Update blast radius if provided
                if (file.blastRadius) {
                    existing.blastRadius = file.blastRadius;
                }
            } else {
                // New file
                this.activeSession.viewedFiles.set(file.path, {
                    path: file.path,
                    viewCount: 1,
                    lastViewed: now,
                    relevanceScore: file.relevanceScore,
                    blastRadius: file.blastRadius
                });
            }
        }

        await this.saveSession(this.activeSession);
    }

    /**
     * Add insight/note to session
     */
    async addInsight(insight: string): Promise<void> {
        if (!this.activeSession) return;

        this.activeSession.insights.push(insight);
        await this.saveSession(this.activeSession);
    }

    /**
     * Get context summary for the session
     */
    getSessionContext(): string {
        if (!this.activeSession) return '';

        const lines: string[] = [];
        lines.push(`Session: ${this.activeSession.metadata.name}`);

        if (this.activeSession.metadata.intent) {
            lines.push(`Intent: ${this.activeSession.metadata.intent}`);
        }

        lines.push(`Queries: ${this.activeSession.metadata.queryCount}`);
        lines.push(`Files viewed: ${this.activeSession.viewedFiles.size}`);

        // Most viewed files
        const sortedFiles = Array.from(this.activeSession.viewedFiles.values())
            .sort((a, b) => b.viewCount - a.viewCount)
            .slice(0, 5);

        if (sortedFiles.length > 0) {
            lines.push('\nMost viewed:');
            sortedFiles.forEach(f => {
                lines.push(`  - ${f.path} (${f.viewCount}x)`);
            });
        }

        // Recent insights
        if (this.activeSession.insights.length > 0) {
            lines.push('\nKey findings:');
            this.activeSession.insights.slice(-3).forEach(i => {
                lines.push(`  - ${i}`);
            });
        }

        return lines.join('\n');
    }

    /**
     * Get files that should be boosted in next search
     * Returns previously viewed files + their dependents
     */
    getBoostCandidates(): Array<{ path: string; boostFactor: number; reason: string }> {
        if (!this.activeSession) return [];

        const candidates: Array<{ path: string; boostFactor: number; reason: string }> = [];

        for (const [filepath, fileData] of this.activeSession.viewedFiles.entries()) {
            // Boost factor based on view count and recency
            const viewBoost = Math.min(fileData.viewCount * 10, 50);  // Max 50 points

            // Recency boost (files viewed in last 5 minutes get extra boost)
            const ageMs = Date.now() - new Date(fileData.lastViewed).getTime();
            const recencyBoost = ageMs < 5 * 60 * 1000 ? 20 : 0;

            candidates.push({
                path: filepath,
                boostFactor: viewBoost + recencyBoost,
                reason: `Previously viewed ${fileData.viewCount}x in session "${this.activeSession.metadata.name}"`
            });
        }

        return candidates;
    }

    /**
     * End the active session
     */
    async endSession(): Promise<void> {
        if (!this.activeSession) return;

        // Mark as ended
        this.activeSession.metadata.status = 'ended';
        this.activeSession.metadata.lastActive = new Date().toISOString();

        // Final save
        await this.saveSession(this.activeSession);
        this.activeSession = null;
    }

    /**
     * List all sessions
     */
    async listSessions(): Promise<SessionMetadata[]> {
        await this.ensureSessionsDir();

        try {
            const files = await fs.readdir(this.sessionsDir);
            const sessions: SessionMetadata[] = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = await fs.readFile(
                        path.join(this.sessionsDir, file),
                        'utf-8'
                    );
                    const data = JSON.parse(content);
                    sessions.push(data.metadata);
                }
            }

            // Sort by last active (most recent first)
            return sessions.sort((a, b) =>
                new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
            );
        } catch (error) {
            return [];
        }
    }

    /**
     * Delete a session
     */
    async deleteSession(sessionId: string): Promise<void> {
        await this.ensureSessionsDir();

        try {
            const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
            await fs.unlink(sessionPath);

            if (this.activeSession?.metadata.id === sessionId) {
                this.activeSession = null;
            }
        } catch (error) {
            // Session doesn't exist or can't be deleted
        }
    }
}
