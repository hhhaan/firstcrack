/** Filename UUID extract + session pairing. Keep this module pure (no FS). */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SESSION_TSV_RE = new RegExp(`^session_(${UUID})\\.tsv$`, 'i');
const BBP_TSV_RE = new RegExp(`^bbp_(${UUID})\\.tsv$`, 'i');

export type LocalTsvKind = 'session' | 'bbp';

export type ParsedLocalTsv = {
    kind: LocalTsvKind;
    sessionId: string;
    filename: string;
};

export type SessionTsvRef = {
    id: string;
    tsv_path: string | null;
    user_id: string;
};

export type PairedLocalTsv = {
    sessionId: string;
    hasSessionTsv: boolean;
    hasBbpTsv: boolean;
};

export type OrphanTsvPlan = {
    /** Session row exists, tsv_path is null, local session TSV present → re-upload. */
    needsUpload: Array<{ sessionId: string; roastSessionId: string }>;
    /** Local TSV with no roast_sessions row. */
    unmatched: PairedLocalTsv[];
};

export const parseLocalTsvFilename = (name: string): ParsedLocalTsv | null => {
    const session = name.match(SESSION_TSV_RE);
    if (session?.[1]) {
        return { kind: 'session', sessionId: session[1].toLowerCase(), filename: name };
    }
    const bbp = name.match(BBP_TSV_RE);
    if (bbp?.[1]) {
        return { kind: 'bbp', sessionId: bbp[1].toLowerCase(), filename: name };
    }
    return null;
};

export const pairLocalTsvsToSessions = (
    files: readonly ParsedLocalTsv[],
    sessions: readonly SessionTsvRef[],
    ownerId: string,
): OrphanTsvPlan => {
    const grouped = new Map<string, { hasSessionTsv: boolean; hasBbpTsv: boolean }>();
    for (const file of files) {
        const sessionId = file.sessionId.toLowerCase();
        const cur = grouped.get(sessionId) ?? { hasSessionTsv: false, hasBbpTsv: false };
        if (file.kind === 'session') cur.hasSessionTsv = true;
        else cur.hasBbpTsv = true;
        grouped.set(sessionId, cur);
    }

    const sessionById = new Map(sessions.map((row) => [row.id.toLowerCase(), row]));
    const needsUpload: OrphanTsvPlan['needsUpload'] = [];
    const unmatched: PairedLocalTsv[] = [];

    for (const [sessionId, pair] of grouped) {
        const row = sessionById.get(sessionId);
        if (!row) {
            unmatched.push({ sessionId, ...pair });
            continue;
        }
        // Other workspace — leave the file; scan again when that workspace is active.
        if (row.user_id !== ownerId) continue;
        // Already uploaded (leftover local file is #183 GC, not this issue).
        if (row.tsv_path) continue;
        // Existing upload pipeline requires the main session TSV.
        if (!pair.hasSessionTsv) continue;
        needsUpload.push({ sessionId, roastSessionId: row.id });
    }

    return { needsUpload, unmatched };
};
