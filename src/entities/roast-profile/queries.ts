import { generateProfileCurve } from '@shared/data/roast-profiles';
import { roastProfileQueryRoots } from '@shared/lib/query-keys';
import { fetchTsvFromR2 } from '@shared/lib/r2';
import { curveQueryConfig } from '@shared/lib/roast-curve';
import type { Json, RoastProfile } from '@shared/types/database.types';
import type { FrozenReference } from '@shared/types/sidecar';
import { type QueryClient, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type RoastProfileWithSource, roastProfileApi } from './api';
import { buildFsdReference, type FsdReferenceReason } from './lib/fsd-reference';
import { resolveSourceSession } from './lib/resolve-source-session';

export type ProfileCurveSource = 'session' | 'synthetic' | 'none';

const resolveTsvPath = (profile: RoastProfileWithSource | null): string | null =>
    resolveSourceSession(profile?.source_session)?.tsv_path ?? null;

const { profiles: profilesRoot, consistency: consistencyRoot, beanHistory: beanHistoryRoot } = roastProfileQueryRoots;

export const roastProfileKeys = {
    all: (userId: string) => [...profilesRoot, userId] as const,
    detail: (id: string) => [...profilesRoot, 'detail', id] as const,
    sourceEvents: (sessionId: string) => [...profilesRoot, 'source_events', sessionId] as const,
    beanHistory: (profileId: string) => [...beanHistoryRoot, profileId] as const,
    consistency: (profileId: string) => [...consistencyRoot, profileId] as const,
};

export const useProfileSourceHistory = (userId: string, profileId: string | null) =>
    useQuery({
        queryKey: [...beanHistoryRoot, userId, 'source-history', profileId],
        queryFn: () => roastProfileApi.sourceHistory(userId, profileId ?? ''),
        enabled: !!userId && !!profileId,
    });

export const useRoastProfiles = (userId: string) => {
    const { data: batchCounters } = useQuery({
        queryKey: [...roastProfileKeys.all(userId), 'batch_counters'],
        queryFn: () => roastProfileApi.batchCounters(userId),
        enabled: !!userId,
    });
    const profiles = useQuery({
        queryKey: roastProfileKeys.all(userId),
        queryFn: () => roastProfileApi.list(userId),
        enabled: !!userId,
    });
    return { ...profiles, batchCounters };
};

/** List is the SSoT for count/cards/detail — patch it immediately, then invalidate for joins. */
const toListRow = (created: RoastProfile): RoastProfileWithSource => ({
    ...created,
    source_session: null,
    default_bean: null,
    default_blend: null,
});

export const applyCreatedRoastProfileCache = (qc: QueryClient, userId: string, created: RoastProfile) => {
    const ownerId = created.user_id || userId;
    qc.setQueryData<RoastProfileWithSource[]>(roastProfileKeys.all(ownerId), (old = []) => [
        toListRow(created),
        ...old.filter((p) => p.id !== created.id),
    ]);
    void qc.invalidateQueries({ queryKey: roastProfileKeys.all(ownerId) });
};

export const applyUpdatedRoastProfileCache = (qc: QueryClient, userId: string, updated: RoastProfile) => {
    const ownerId = updated.user_id || userId;
    qc.setQueryData<RoastProfileWithSource[]>(roastProfileKeys.all(ownerId), (old) =>
        old?.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
    );
    void qc.invalidateQueries({ queryKey: roastProfileKeys.all(ownerId) });
};

export const useCreateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.create,
        onSuccess: (created) => {
            applyCreatedRoastProfileCache(qc, userId, created);
        },
    });
};

export const useUpdateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.update,
        onSuccess: (updated) => {
            applyUpdatedRoastProfileCache(qc, userId, updated);
        },
    });
};

export const useDeleteRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.delete,
        onSuccess: (_, id) => {
            void qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
            qc.removeQueries({ queryKey: roastProfileKeys.detail(id) });
        },
    });
};

export const useRoastProfileCurve = (tsvPath: string | null | undefined) => useQuery(curveQueryConfig(tsvPath));

export const useFsdReference = (
    profile: RoastProfileWithSource | null,
): {
    reference: FrozenReference | null;
    reason: FsdReferenceReason | null;
    isLoading: boolean;
    referenceTpTime?: number;
} => {
    const source = resolveSourceSession(profile?.source_session);
    const tsvPath = source?.tsv_path ?? null;
    const query = useQuery({
        queryKey: [
            ...roastProfileKeys.all(profile?.user_id ?? ''),
            'fsd-reference',
            profile?.source_session_id,
            tsvPath,
        ],
        queryFn: () => fetchTsvFromR2(tsvPath ?? ''),
        enabled: !!profile?.source_session_id && !!tsvPath,
        staleTime: Infinity,
        gcTime: Infinity,
    });
    return useMemo(() => {
        if (!profile) return { reference: null, reason: 'no_profile', isLoading: false };
        if (!profile.source_session_id || !source) {
            return { reference: null, reason: 'synthetic_source', isLoading: false };
        }
        if (!tsvPath) return { reference: null, reason: 'legacy_source', isLoading: false };
        if (query.isLoading) return { reference: null, reason: null, isLoading: true };
        if (query.isError || query.data === undefined)
            return { reference: null, reason: 'download_failed', isLoading: false };
        const built = buildFsdReference(profile, query.data);
        return {
            reference: built.reference,
            reason: built.reason,
            isLoading: false,
            ...(built.reference && { referenceTpTime: built.diagnostics.reference_tp_elapsed_sec }),
        };
    }, [profile, query.data, query.isError, query.isLoading, source, tsvPath]);
};

/** ProfileDetail roast log. History record edits invalidate it via the roast_profiles root. */
export const useSourceSessionEvents = (sessionId: string | null) =>
    useQuery({
        queryKey: roastProfileKeys.sourceEvents(sessionId ?? ''),
        queryFn: async (): Promise<Json | null> => {
            if (!sessionId) return null;
            return roastProfileApi.sourceSessionEvents(sessionId);
        },
        enabled: !!sessionId,
        staleTime: Infinity,
    });

/** 실측 TSV 우선, 없으면 drop_temp/duration 기반 synthetic 곡선 반환 */
export const useResolvedProfileCurve = (profile: RoastProfileWithSource | null) => {
    const tsvPath = profile ? resolveTsvPath(profile) : null;
    const { data: real = [], isLoading, isError } = useRoastProfileCurve(tsvPath);
    const synthetic = useMemo(
        () =>
            profile
                ? generateProfileCurve(profile.drop_temp_celsius ?? 200, profile.duration_sec ?? 720).map((p) => ({
                      t: p.t,
                      bt: p.bt,
                      et: null as number | null,
                      ror: null as number | null,
                      heater: null as number | null,
                      fan: null as number | null,
                      drum: null as number | null,
                  }))
                : [],
        [profile],
    );
    const points = real.length > 0 ? real : synthetic;
    const source: ProfileCurveSource = real.length > 0 ? 'session' : synthetic.length > 0 ? 'synthetic' : 'none';
    return { points, source, isLoading, isError };
};

// 비교 모드용 — paths 순서대로 결과 배열 반환. 각 fallbackKey는 캐시 충돌 방지용.
export const useRoastProfileCurves = (paths: (string | null | undefined)[], fallbackKeys: string[] = []) =>
    useQueries({
        queries: paths.map((p, i) => curveQueryConfig(p, fallbackKeys[i])),
    });

export type { RoastProfileWithSource };

// ── Profile Bean History ──────────────────────────────────────────────────────

export type BeanHistoryItem = {
    name: string;
    count: number;
    lastDate: string;
};

export const useProfileBeanHistory = (profileId: string) =>
    useQuery({
        queryKey: roastProfileKeys.beanHistory(profileId),
        queryFn: async (): Promise<BeanHistoryItem[]> => {
            const data = await roastProfileApi.beanHistorySessions(profileId);

            const grouped: Record<string, { name: string; count: number; lastDate: string }> = {};
            for (const s of data) {
                if (!s.bean_id) continue;
                if (!grouped[s.bean_id]) {
                    grouped[s.bean_id] = {
                        name: s.beans?.name ?? 'Unknown',
                        count: 0,
                        lastDate: s.roasted_at ?? '',
                    };
                }
                grouped[s.bean_id].count++;
            }
            return Object.values(grouped).sort((a, b) => b.count - a.count);
        },
        enabled: !!profileId,
    });

// ── Profile Consistency ──────────────────────────────────────────────────────

export type ConsistencySessionRow = {
    drop_temp_celsius: number | null;
    duration_seconds: number | null;
    weight_grams: number;
    roasted_at: string | null;
};

/** 최근 10개 완료 배치 메타 (newest first) — 일관성 통계용. 한도는 api 읽기에 있다. */
export const useProfileConsistency = (profileId: string) =>
    useQuery({
        queryKey: roastProfileKeys.consistency(profileId),
        queryFn: async (): Promise<ConsistencySessionRow[]> => roastProfileApi.consistencySessions(profileId),
        enabled: !!profileId,
    });
