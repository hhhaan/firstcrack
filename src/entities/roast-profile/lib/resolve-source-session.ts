export type SourceSessionSnapshot = {
    tsv_path: string | null;
    bbp_tsv_path?: string | null;
    bbp_seconds?: number | null;
    /** roast_sessions.events jsonb — 조인에 events를 안 실은 호출자는 생략 */
    events?: unknown;
    /** History-edited Heat set plan; NULL = recorded TSV. */
    heater_events?: unknown;
};

type SourceSessionJoin = SourceSessionSnapshot | SourceSessionSnapshot[] | null | undefined;

export const resolveSourceSession = (sourceSession: SourceSessionJoin): SourceSessionSnapshot | null => {
    if (!sourceSession) return null;
    if (Array.isArray(sourceSession)) return sourceSession[0] ?? null;
    return sourceSession;
};

/** Profiles own their Replay plan; source records only supply reference measurements. */
export const profileHeaterEvents = (
    profile: { heater_events?: unknown; source_session?: SourceSessionJoin } | null | undefined,
): unknown => profile?.heater_events ?? null;
