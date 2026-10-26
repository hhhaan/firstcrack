import { supabase } from '@shared/lib/supabase';
import type { Json, RoastProfile } from '@shared/types/database.types';
import { z } from 'zod';
import { type ProfileSource, registeredProfileSources } from './lib/source-candidates';

type RoastProfileInsert = Omit<RoastProfile, 'id' | 'created_at' | 'updated_at'> & { sources?: ProfileSource[] };
export type RoastProfileUpdate = { id: string } & Partial<
    Omit<RoastProfile, 'id' | 'created_at' | 'updated_at' | 'user_id'>
> & { sources?: ProfileSource[] };

/** Completed roast saved under a profile. The reference curve is chosen from this list. */
export type ProfileReferenceBatch = {
    id: string;
    roasted_at: string | null;
    batch_name: string | null;
    bean_label: string | null;
    profile_batch_number: number | null;
    total_batch_number: number | null;
    tsv_path: string | null;
    bbp_tsv_path: string | null;
    bbp_seconds: number | null;
    heater_events?: Json | null;
    beans: { name: string } | null;
    blends: { name: string } | null;
};

/** events: 소스 세션 로그 — Replay 컷오프(Drop 마크)에 쓴다 */
type SourceSessionRow = {
    tsv_path: string | null;
    bbp_tsv_path?: string | null;
    bbp_seconds?: number | null;
    events: Json | null;
    heater_events?: Json | null;
};

export type RoastProfileWithSource = RoastProfile & {
    sources?: ProfileSource[];
    source_session: SourceSessionRow | SourceSessionRow[] | null;
    default_bean: { id: string; name: string } | null;
    default_blend: { id: string; name: string } | null;
};

export const roastProfileCopyInsert = (profile: RoastProfileWithSource, name: string): RoastProfileInsert => {
    const {
        id: _id,
        created_at: _createdAt,
        updated_at: _updatedAt,
        source_session: _sourceSession,
        default_bean: _defaultBean,
        default_blend: _defaultBlend,
        ...copy
    } = profile;
    void _id;
    void _createdAt;
    void _updatedAt;
    void _sourceSession;
    void _defaultBean;
    void _defaultBlend;
    return { ...copy, name, ...(profile.sources && { sources: registeredProfileSources(profile) }) };
};

const REFERENCE_BATCHS_WITH_HEATER =
    'id, roasted_at, batch_name, bean_label, profile_batch_number, total_batch_number, tsv_path, bbp_tsv_path, bbp_seconds, heater_events, beans(name), blends(name)';
const REFERENCE_BATCHS_WITHOUT_HEATER =
    'id, roasted_at, batch_name, bean_label, profile_batch_number, total_batch_number, tsv_path, bbp_tsv_path, bbp_seconds, beans(name), blends(name)';

const SELECT_WITH_SESSION_HEATER =
    '*, sources:roast_profile_sources(bean_id,blend_id), source_session:roast_sessions!source_session_id(tsv_path,bbp_tsv_path,bbp_seconds,events,heater_events), default_bean:beans!default_bean_id(id,name), default_blend:blends!default_blend_id(id,name)';

/** Same list shape when `roast_sessions.heater_events` is not on this database. */
const SELECT_WITHOUT_SESSION_HEATER =
    '*, sources:roast_profile_sources(bean_id,blend_id), source_session:roast_sessions!source_session_id(tsv_path,bbp_tsv_path,bbp_seconds,events), default_bean:beans!default_bean_id(id,name), default_blend:blends!default_blend_id(id,name)';

type ProfileListSelect = typeof SELECT_WITH_SESSION_HEATER | typeof SELECT_WITHOUT_SESSION_HEATER;

// ponytail: remembered until reload. A column added later is picked up on the next launch.
let omitSessionHeaterColumn = false;

export const resetRoastProfileSourceSelectForTests = () => {
    omitSessionHeaterColumn = false;
};

const isMissingSessionHeaterColumn = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const row = error as { code?: unknown; message?: unknown };
    return row.code === '42703' && typeof row.message === 'string' && row.message.includes('heater_events');
};

const listProfiles = (userId: string, select: ProfileListSelect) =>
    supabase.from('roast_profiles').select(select).eq('user_id', userId).order('created_at', { ascending: false });

export const roastProfileApi = {
    batchCounters: async (userId: string) => {
        const { data, error } = await supabase.rpc('get_roast_batch_counters', { p_user_id: userId });
        if (error) throw error;
        return z.record(z.string(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).parse(data);
    },

    list: async (userId: string): Promise<RoastProfileWithSource[]> => {
        const select = omitSessionHeaterColumn ? SELECT_WITHOUT_SESSION_HEATER : SELECT_WITH_SESSION_HEATER;
        const first = await listProfiles(userId, select);
        // One narrower query — not a retry of the same select. Do not ALTER the database from here.
        if (first.error && !omitSessionHeaterColumn && isMissingSessionHeaterColumn(first.error)) {
            omitSessionHeaterColumn = true;
            const second = await listProfiles(userId, SELECT_WITHOUT_SESSION_HEATER);
            if (second.error) throw second.error;
            return (second.data ?? []) as RoastProfileWithSource[];
        }
        if (first.error) throw first.error;
        return (first.data ?? []) as RoastProfileWithSource[];
    },

    create: async (profile: RoastProfileInsert): Promise<RoastProfile> => {
        const { sources, ...row } = profile;
        const { data, error } = sources
            ? await supabase.rpc('save_roast_profile_sources', {
                  p_profile: row as Json,
                  p_sources: sources,
                  p_id: undefined,
              })
            : await supabase.from('roast_profiles').insert(row).select().single();
        if (error) throw error;
        return Object.assign(data, sources ? { sources } : {});
    },

    update: async ({ id, ...patch }: RoastProfileUpdate): Promise<RoastProfile> => {
        const { sources, ...row } = patch;
        const { data, error } = sources
            ? await supabase.rpc('save_roast_profile_sources', { p_profile: row as Json, p_sources: sources, p_id: id })
            : await supabase.from('roast_profiles').update(row).eq('id', id).select().single();
        if (error) throw error;
        return Object.assign(data, sources ? { sources } : {});
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('roast_profiles').delete().eq('id', id);
        if (error) throw error;
    },

    /** Profile detail log. History edits invalidate the roast_profiles root, not this read. */
    sourceSessionEvents: async (sessionId: string): Promise<Json | null> => {
        const { data, error } = await supabase.from('roast_sessions').select('events').eq('id', sessionId).single();
        if (error) throw error;
        return data?.events ?? null;
    },

    sourceHistory: async (userId: string, profileId: string): Promise<ProfileSource[]> => {
        const sources: ProfileSource[] = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
                .from('roast_sessions')
                .select('bean_id, blend_id, plan_batch:roast_plan_batches!plan_batch_id(blend_id)')
                .eq('user_id', userId)
                .eq('profile_id', profileId)
                .eq('status', 'completed')
                .order('id')
                .range(from, from + 999);
            if (error) throw error;
            for (const row of data ?? [])
                sources.push({ bean_id: row.bean_id, blend_id: row.blend_id ?? row.plan_batch?.blend_id ?? null });
            if (!data || data.length < 1000) return sources;
        }
    },

    /** Completed batches saved with this profile, newest first. Pages past the PostgREST cap. */
    referenceBatches: async (profileId: string): Promise<ProfileReferenceBatch[]> => {
        const load = async (columns: string): Promise<{ rows: ProfileReferenceBatch[]; error: unknown }> => {
            const rows: ProfileReferenceBatch[] = [];
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase
                    .from('roast_sessions')
                    .select(columns)
                    .eq('profile_id', profileId)
                    .eq('status', 'completed')
                    .order('roasted_at', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(from, from + 999);
                if (error) return { rows, error };
                rows.push(...((data ?? []) as unknown as ProfileReferenceBatch[]));
                if (!data || data.length < 1000) return { rows, error: null };
            }
        };
        const select = omitSessionHeaterColumn ? REFERENCE_BATCHS_WITHOUT_HEATER : REFERENCE_BATCHS_WITH_HEATER;
        const first = await load(select);
        if (first.error && !omitSessionHeaterColumn && isMissingSessionHeaterColumn(first.error)) {
            omitSessionHeaterColumn = true;
            const second = await load(REFERENCE_BATCHS_WITHOUT_HEATER);
            if (second.error) throw second.error;
            return second.rows;
        }
        if (first.error) throw first.error;
        return first.rows;
    },

    /** Point the profile curve at one saved batch. Does not write the heater plan or copied stats. */
    setReferenceSession: async (id: string, sourceSessionId: string): Promise<RoastProfile> => {
        const { data, error } = await supabase
            .from('roast_profiles')
            .update({ source_session_id: sourceSessionId })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Sessions that name a bean, newest first. The hook groups them into counts. */
    beanHistorySessions: async (profileId: string) => {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select('bean_id, roasted_at, beans(name)')
            .eq('profile_id', profileId)
            .not('bean_id', 'is', null)
            .order('roasted_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    /** Newest completed batches for the consistency card. The limit is part of this read. */
    consistencySessions: async (profileId: string) => {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select('drop_temp_celsius, duration_seconds, weight_grams, roasted_at')
            .eq('profile_id', profileId)
            .eq('status', 'completed')
            .order('roasted_at', { ascending: false })
            .limit(10);
        if (error) throw error;
        return data ?? [];
    },
};
