export type SourceSessionSnapshot = {
    tsv_path: string | null;
};

type SourceSessionJoin = SourceSessionSnapshot | SourceSessionSnapshot[] | null | undefined;

export const resolveSourceSession = (sourceSession: SourceSessionJoin): SourceSessionSnapshot | null => {
    if (!sourceSession) return null;
    if (Array.isArray(sourceSession)) return sourceSession[0] ?? null;
    return sourceSession;
};
