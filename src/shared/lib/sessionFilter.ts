import { sessionBeanName } from '@shared/lib/sessionBeanName';
import type { RoastSessionWithRelations } from '@shared/types/database.types';

export type SessionSortKey = 'date' | 'bean' | 'duration' | 'drop' | 'level' | 'profile' | 'weight';

export interface SessionFilterCriteria {
    search: string;
    levelFilter: string;
    fromYM: string;
    toYM: string;
    originFilter: string;
}

const qMatch = (s: RoastSessionWithRelations, q: string): boolean => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
        (sessionBeanName(s) ?? '').toLowerCase().includes(needle) ||
        (s.roast_profiles?.name ?? '').toLowerCase().includes(needle) ||
        (s.beans?.origin ?? '').toLowerCase().includes(needle)
    );
};

/** YYYY-MM range check on ISO roasted_at. Empty bounds = unbounded. */
export const ymInRange = (iso: string | null, fromYM: string, toYM: string): boolean => {
    if (!fromYM && !toYM) return true;
    if (!iso) return false;
    const d = new Date(iso);
    const sessionYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (fromYM && sessionYM < fromYM) return false;
    if (toYM && sessionYM > toYM) return false;
    return true;
};

/**
 * 사용자가 시작/끝 월을 거꾸로 고른 경우를 바로잡는다. 그대로 두면 ymInRange가
 * 항상 빈 결과를 내서, 필터가 고장난 것처럼 보인다.
 */
export const normalizeYMRange = (fromYM: string, toYM: string): { fromYM: string; toYM: string } =>
    fromYM && toYM && fromYM > toYM ? { fromYM: toYM, toYM: fromYM } : { fromYM, toYM };

/**
 * Full filter: search + level + date range + origin — single pass.
 * Used by displayTotal and list filtering (rawSessions).
 */
export const filterSessions = (
    sessions: RoastSessionWithRelations[],
    { search, levelFilter, fromYM, toYM, originFilter }: SessionFilterCriteria,
): RoastSessionWithRelations[] => {
    const q = search.toLowerCase();
    return sessions.filter((s) => {
        if (levelFilter !== 'all' && s.roast_level !== levelFilter) return false;
        if (!ymInRange(s.roasted_at, fromYM, toYM)) return false;
        if (q && !qMatch(s, q)) return false;
        if (originFilter !== 'all' && s.beans?.origin !== originFilter) return false;
        return true;
    });
};

/** Date-only slice for CSV export (list filters intentionally ignored). */
export const filterSessionsByDateRange = (
    sessions: RoastSessionWithRelations[],
    fromYM: string,
    toYM: string,
): RoastSessionWithRelations[] => sessions.filter((s) => ymInRange(s.roasted_at, fromYM, toYM));

const compareNullable = (
    a: string | number | null | undefined,
    b: string | number | null | undefined,
    dir: number,
): number => {
    const av = a ?? '';
    const bv = b ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
    return dir * String(av).localeCompare(String(bv));
};

/** Client-side sort for history table columns. */
export const sortSessions = (
    sessions: RoastSessionWithRelations[],
    sortKey: SessionSortKey,
    sortAsc: boolean,
): RoastSessionWithRelations[] => {
    const dir = sortAsc ? 1 : -1;
    return [...sessions].sort((a, b) => {
        switch (sortKey) {
            case 'date':
                return compareNullable(a.roasted_at, b.roasted_at, dir);
            case 'bean':
                return compareNullable(sessionBeanName(a), sessionBeanName(b), dir);
            case 'profile':
                return compareNullable(a.roast_profiles?.name, b.roast_profiles?.name, dir);
            case 'weight':
                return compareNullable(a.weight_grams, b.weight_grams, dir);
            case 'drop':
                return compareNullable(a.drop_temp_celsius, b.drop_temp_celsius, dir);
            case 'duration':
                return compareNullable(a.duration_seconds, b.duration_seconds, dir);
            case 'level':
                return compareNullable(a.roast_level, b.roast_level, dir);
            default:
                return 0;
        }
    });
};

export const paginateSessions = <T>(sessions: T[], page: number, pageSize: number): T[] => {
    const safePage = Math.max(1, page);
    const start = (safePage - 1) * pageSize;
    return sessions.slice(start, start + pageSize);
};
