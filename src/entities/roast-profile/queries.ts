import { generateProfileCurve } from '@shared/data/roast-profiles';
import { curveQueryConfig } from '@shared/lib/roast-curve';
import { supabase } from '@shared/lib/supabase';
import type { Json, RoastProfile } from '@shared/types/database.types';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type RoastProfileWithSource, roastProfileApi } from './api';
import { resolveSourceSession } from './lib/resolve-source-session';

export type ProfileCurveSource = 'session' | 'synthetic' | 'none';

const resolveTsvPath = (profile: RoastProfileWithSource | null): string | null =>
    resolveSourceSession(profile?.source_session)?.tsv_path ?? null;

export const roastProfileKeys = {
    all: (userId: string) => ['roast_profiles', userId] as const,
    detail: (id: string) => ['roast_profiles', 'detail', id] as const,
    sourceEvents: (sessionId: string) => ['roast_profiles', 'source_events', sessionId] as const,
    beanHistory: (profileId: string) => ['profile-bean-history', profileId] as const,
    consistency: (profileId: string) => ['profile-consistency', profileId] as const,
};

export const useRoastProfiles = (userId: string) =>
    useQuery({
        queryKey: roastProfileKeys.all(userId),
        queryFn: () => roastProfileApi.list(userId),
        enabled: !!userId,
    });

export const useCreateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.create,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
        },
    });
};

export const useUpdateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.update,
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
            qc.setQueryData<RoastProfile>(roastProfileKeys.detail(updated.id), updated);
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

/** ProfileDetail roast log — events are immutable after session save. */
export const useSourceSessionEvents = (sessionId: string | null) =>
    useQuery({
        queryKey: roastProfileKeys.sourceEvents(sessionId ?? ''),
        queryFn: async (): Promise<Json | null> => {
            if (!sessionId) return null;
            const { data, error } = await supabase.from('roast_sessions').select('events').eq('id', sessionId).single();
            if (error) throw error;
            return data?.events ?? null;
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
            const { data, error } = await supabase
                .from('roast_sessions')
                .select('bean_id, roasted_at, beans(name)')
                .eq('profile_id', profileId)
                .not('bean_id', 'is', null)
                .order('roasted_at', { ascending: false });
            if (error) throw error;

            const grouped: Record<string, { name: string; count: number; lastDate: string }> = {};
            for (const s of data ?? []) {
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

const CONSISTENCY_BATCH_LIMIT = 10;

/** 최근 N개 완료 배치 메타 (newest first) — 일관성 통계용. */
export const useProfileConsistency = (profileId: string) =>
    useQuery({
        queryKey: roastProfileKeys.consistency(profileId),
        queryFn: async (): Promise<ConsistencySessionRow[]> => {
            const { data, error } = await supabase
                .from('roast_sessions')
                .select('drop_temp_celsius, duration_seconds, weight_grams, roasted_at')
                .eq('profile_id', profileId)
                .eq('status', 'completed')
                .order('roasted_at', { ascending: false })
                .limit(CONSISTENCY_BATCH_LIMIT);
            if (error) throw error;
            return data ?? [];
        },
        enabled: !!profileId,
    });
