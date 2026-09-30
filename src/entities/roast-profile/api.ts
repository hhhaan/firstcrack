import { supabase } from '@shared/lib/supabase';
import type { Json, RoastProfile } from '@shared/types/database.types';

type RoastProfileInsert = Omit<RoastProfile, 'id' | 'created_at' | 'updated_at'>;
type RoastProfileUpdate = { id: string } & Partial<Omit<RoastProfile, 'id' | 'created_at' | 'updated_at' | 'user_id'>>;

/** events: 소스 세션 로그 — Replay 컷오프(Drop 마크)에 쓴다 */
type SourceSessionRow = {
    tsv_path: string | null;
    bbp_tsv_path?: string | null;
    bbp_seconds?: number | null;
    events: Json | null;
    heater_events?: Json | null;
};

export type RoastProfileWithSource = RoastProfile & {
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
    return { ...copy, name };
};

const SELECT_WITH_SESSION_HEATER =
    '*, source_session:roast_sessions!source_session_id(tsv_path,bbp_tsv_path,bbp_seconds,events,heater_events), default_bean:beans!default_bean_id(id,name), default_blend:blends!default_blend_id(id,name)';

/** Same list shape when `roast_sessions.heater_events` is not on this database. */
const SELECT_WITHOUT_SESSION_HEATER =
    '*, source_session:roast_sessions!source_session_id(tsv_path,bbp_tsv_path,bbp_seconds,events), default_bean:beans!default_bean_id(id,name), default_blend:blends!default_blend_id(id,name)';

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
        const { data, error } = await supabase.from('roast_profiles').insert(profile).select().single();
        if (error) throw error;
        return data;
    },

    update: async ({ id, ...patch }: RoastProfileUpdate): Promise<RoastProfile> => {
        const { data, error } = await supabase.from('roast_profiles').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('roast_profiles').delete().eq('id', id);
        if (error) throw error;
    },
};
