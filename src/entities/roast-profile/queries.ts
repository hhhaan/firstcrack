import { fetchTsvFromR2 } from '@shared/lib/r2';
import { supabase } from '@shared/lib/supabase';
import { parseTsv, type TsvPoint } from '@shared/lib/tsv';
import type { RoastProfile } from '@shared/types/database.types';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RoastProfileWithSource, roastProfileApi } from './api';

export const roastProfileKeys = {
    all: (userId: string) => ['roast_profiles', userId] as const,
    detail: (id: string) => ['roast_profiles', 'detail', id] as const,
    curve: (tsvPath: string) => ['roast_profile_curve', tsvPath] as const,
};

export const useRoastProfiles = (userId: string) =>
    useQuery({
        queryKey: roastProfileKeys.all(userId),
        queryFn: () => roastProfileApi.list(userId),
        staleTime: 30_000,
        enabled: !!userId,
    });

export const useCreateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.create,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
        },
    });
};

export const useUpdateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.update,
        onSuccess: (updated) => {
            qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
            qc.setQueryData<RoastProfile>(roastProfileKeys.detail(updated.id), updated);
        },
    });
};

export const useDeleteRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.delete,
        onSuccess: (_, id) => {
            qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
            qc.removeQueries({ queryKey: roastProfileKeys.detail(id) });
        },
    });
};

// TSV는 세션당 immutable — 한 번 fetch 후 영구 캐시.
const curveQueryConfig = (tsvPath: string | null | undefined, fallbackKey?: string) => ({
    queryKey: tsvPath ? roastProfileKeys.curve(tsvPath) : ['roast_profile_curve', 'none', fallbackKey ?? ''],
    queryFn: async (): Promise<TsvPoint[]> => {
        if (!tsvPath) return [];
        return parseTsv(await fetchTsvFromR2(tsvPath));
    },
    enabled: !!tsvPath,
    staleTime: Infinity,
    gcTime: Infinity,
});

export const useRoastProfileCurve = (tsvPath: string | null | undefined) => useQuery(curveQueryConfig(tsvPath));

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
        queryKey: ['profile-bean-history', profileId],
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
                        name: (s.beans as { name: string } | null)?.name ?? 'Unknown',
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
