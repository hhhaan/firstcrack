import { supabase } from '@shared/lib/supabase';
import type { Cupping, CuppingEvent, CuppingInvite, CuppingSample, Database } from '@shared/types/database.types';
import { cuppingInviteUrl, generateCuppingToken, resolveCuppingPublicBaseUrl } from './lib/token';

type CuppingInsert = Database['public']['Tables']['cuppings']['Insert'];

export type CuppingEventSummary = CuppingEvent & {
    sample_count: number;
    score_count: number;
    /** Unique cuppers (by cupped_by). Empty string = anonymous. */
    participant_count: number;
    participants: string[];
    avg_score: number | null;
    active_invite: (CuppingInvite & { url: string }) | null;
};

export type BeanCuppingMeta = {
    name: string;
    origin: string | null;
    region: string | null;
    variety: string | null;
    process: string | null;
    farm: string | null;
};

export type CuppingSampleWithMeta = CuppingSample & {
    roast_sessions: {
        id: string;
        roasted_at: string | null;
        beans: BeanCuppingMeta | null;
    } | null;
    score_count: number;
    avg_score: number | null;
};

/** origin · region · variety · process · farm (skips empty) */
export function formatBeanCuppingMeta(bean: Partial<BeanCuppingMeta> | null | undefined): string {
    if (!bean) return '';
    return [bean.origin, bean.region, bean.variety, bean.process, bean.farm].filter(Boolean).join(' · ');
}

export type CreateEventInput = {
    userId: string;
    title: string;
    heldAt?: string;
    notes?: string | null;
};

export type AddSampleInput = {
    userId: string;
    eventId: string;
    label: string;
    roastSessionId?: string | null;
    sortOrder?: number;
};

export type CreateInviteForEventInput = {
    userId: string;
    eventId: string;
    expiresInDays?: number;
    maxUses?: number;
};

export type CreateInviteResult = CuppingInvite & { url: string };

/** Empty string = anonymous (also maps server default "Anonymous"). */
function normalizeCupperName(raw: string | null | undefined): string {
    const name = raw?.trim() ?? '';
    if (!name || name.toLowerCase() === 'anonymous') return '';
    return name;
}

async function loadActiveInviteForEvent(eventId: string): Promise<(CuppingInvite & { url: string }) | null> {
    const now = new Date().toISOString();
    const { data: invites, error } = await supabase
        .from('cupping_invites')
        .select('*')
        .eq('event_id', eventId)
        .is('revoked_at', null)
        .gt('expires_at', now)
        .order('created_at', { ascending: false });
    if (error) throw error;

    const inv = (invites ?? []).find((i) => i.used_count < i.max_uses) ?? null;
    if (!inv) return null;
    const base = await resolveCuppingPublicBaseUrl();
    return { ...inv, url: cuppingInviteUrl(inv.token, base) };
}

export const cuppingApi = {
    listEvents: async (userId: string): Promise<CuppingEventSummary[]> => {
        const { data: events, error } = await supabase
            .from('cupping_events')
            .select('*')
            .eq('user_id', userId)
            .order('held_at', { ascending: false });
        if (error) throw error;
        if (!events?.length) return [];

        const eventIds = events.map((e) => e.id);
        const { data: samples, error: sErr } = await supabase
            .from('cupping_samples')
            .select('id, event_id')
            .in('event_id', eventIds);
        if (sErr) throw sErr;

        const sampleIds = (samples ?? []).map((s) => s.id);
        const scoresBySample = new Map<string, number[]>();
        const cuppersBySample = new Map<string, string[]>();
        if (sampleIds.length) {
            const { data: scores, error: cErr } = await supabase
                .from('cuppings')
                .select('sample_id, total_score, cupped_by')
                .in('sample_id', sampleIds);
            if (cErr) throw cErr;
            for (const row of scores ?? []) {
                if (!row.sample_id) continue;
                const list = scoresBySample.get(row.sample_id) ?? [];
                list.push(Number(row.total_score));
                scoresBySample.set(row.sample_id, list);
                const cuppers = cuppersBySample.get(row.sample_id) ?? [];
                cuppers.push(normalizeCupperName(row.cupped_by));
                cuppersBySample.set(row.sample_id, cuppers);
            }
        }

        const samplesByEvent = new Map<string, string[]>();
        for (const s of samples ?? []) {
            const list = samplesByEvent.get(s.event_id) ?? [];
            list.push(s.id);
            samplesByEvent.set(s.event_id, list);
        }

        const now = new Date().toISOString();
        const { data: invites, error: iErr } = await supabase
            .from('cupping_invites')
            .select('*')
            .in('event_id', eventIds)
            .is('revoked_at', null)
            .gt('expires_at', now)
            .order('created_at', { ascending: false });
        if (iErr) throw iErr;

        const activeInviteByEvent = new Map<string, CuppingInvite>();
        for (const inv of invites ?? []) {
            if (!inv.event_id) continue;
            if (inv.used_count >= inv.max_uses) continue;
            if (!activeInviteByEvent.has(inv.event_id)) {
                activeInviteByEvent.set(inv.event_id, inv);
            }
        }

        const base = await resolveCuppingPublicBaseUrl();
        return events.map((ev) => {
            const sids = samplesByEvent.get(ev.id) ?? [];
            const allScores: number[] = [];
            const participantSet = new Set<string>();
            for (const sid of sids) {
                allScores.push(...(scoresBySample.get(sid) ?? []));
                for (const name of cuppersBySample.get(sid) ?? []) {
                    participantSet.add(name);
                }
            }
            const participants = [...participantSet].sort((a, b) => {
                if (!a) return 1;
                if (!b) return -1;
                return a.localeCompare(b);
            });
            const avg =
                allScores.length > 0
                    ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100
                    : null;
            const inv = activeInviteByEvent.get(ev.id) ?? null;
            return {
                ...ev,
                sample_count: sids.length,
                score_count: allScores.length,
                participant_count: participants.length,
                participants,
                avg_score: avg,
                active_invite: inv ? { ...inv, url: cuppingInviteUrl(inv.token, base) } : null,
            };
        });
    },

    getEvent: async (eventId: string): Promise<CuppingEvent> => {
        const { data, error } = await supabase.from('cupping_events').select('*').eq('id', eventId).single();
        if (error) throw error;
        return data;
    },

    getActiveInviteForEvent: loadActiveInviteForEvent,

    createEvent: async ({ userId, title, heldAt, notes = null }: CreateEventInput): Promise<CuppingEvent> => {
        const { data, error } = await supabase
            .from('cupping_events')
            .insert({
                user_id: userId,
                title: title.trim() || 'Cupping',
                held_at: heldAt ?? new Date().toISOString(),
                notes,
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    deleteEvent: async (eventId: string): Promise<void> => {
        const { error } = await supabase.from('cupping_events').delete().eq('id', eventId);
        if (error) throw error;
    },

    listSamples: async (eventId: string): Promise<CuppingSampleWithMeta[]> => {
        const { data: samples, error } = await supabase
            .from('cupping_samples')
            .select('*, roast_sessions(id, roasted_at, beans(name, origin, region, variety, process, farm))')
            .eq('event_id', eventId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
        if (error) throw error;
        if (!samples?.length) return [];

        const sampleIds = samples.map((s) => s.id);
        const { data: scores, error: cErr } = await supabase
            .from('cuppings')
            .select('sample_id, total_score')
            .in('sample_id', sampleIds);
        if (cErr) throw cErr;

        const scoresBySample = new Map<string, number[]>();
        for (const row of scores ?? []) {
            if (!row.sample_id) continue;
            const list = scoresBySample.get(row.sample_id) ?? [];
            list.push(Number(row.total_score));
            scoresBySample.set(row.sample_id, list);
        }

        return samples.map((s) => {
            const scoreList = scoresBySample.get(s.id) ?? [];
            const avg =
                scoreList.length > 0
                    ? Math.round((scoreList.reduce((a, b) => a + b, 0) / scoreList.length) * 100) / 100
                    : null;
            return {
                ...s,
                roast_sessions: s.roast_sessions,
                score_count: scoreList.length,
                avg_score: avg,
            };
        });
    },

    addSample: async ({
        userId,
        eventId,
        label,
        roastSessionId = null,
        sortOrder = 0,
    }: AddSampleInput): Promise<CuppingSample> => {
        const { data, error } = await supabase
            .from('cupping_samples')
            .insert({
                user_id: userId,
                event_id: eventId,
                label: label.trim() || 'Sample',
                roast_session_id: roastSessionId,
                sort_order: sortOrder,
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    addSamplesBatch: async (
        userId: string,
        eventId: string,
        items: { label: string; roastSessionId?: string | null }[],
    ): Promise<CuppingSample[]> => {
        if (!items.length) return [];
        const { data: existing, error: maxErr } = await supabase
            .from('cupping_samples')
            .select('sort_order')
            .eq('event_id', eventId)
            .order('sort_order', { ascending: false })
            .limit(1);
        if (maxErr) throw maxErr;
        const baseOrder = (existing?.[0]?.sort_order ?? -1) + 1;
        const rows = items.map((item, i) => ({
            user_id: userId,
            event_id: eventId,
            label: item.label.trim() || `Sample ${i + 1}`,
            roast_session_id: item.roastSessionId ?? null,
            sort_order: baseOrder + i,
        }));
        const { data, error } = await supabase.from('cupping_samples').insert(rows).select();
        if (error) throw error;
        return data ?? [];
    },

    /** Persist sample order: `orderedIds` index becomes `sort_order`. */
    reorderSamples: async (orderedIds: string[]): Promise<void> => {
        if (!orderedIds.length) return;
        const results = await Promise.all(
            orderedIds.map((id, i) => supabase.from('cupping_samples').update({ sort_order: i }).eq('id', id)),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
    },

    deleteSample: async (sampleId: string): Promise<void> => {
        const { error } = await supabase.from('cupping_samples').delete().eq('id', sampleId);
        if (error) throw error;
    },

    listScoresBySample: async (sampleId: string): Promise<Cupping[]> => {
        const { data, error } = await supabase
            .from('cuppings')
            .select('*')
            .eq('sample_id', sampleId)
            .order('cupped_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    /** One QR per cupping event (session). */
    createInviteForEvent: async ({
        userId,
        eventId,
        expiresInDays = 7,
        // Session invite: many cuppers × many samples (parallel table use)
        maxUses = 10_000,
    }: CreateInviteForEventInput): Promise<CreateInviteResult> => {
        const existing = await loadActiveInviteForEvent(eventId);
        if (existing) return existing;

        const token = generateCuppingToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);

        const { data, error } = await supabase
            .from('cupping_invites')
            .insert({
                user_id: userId,
                event_id: eventId,
                sample_id: null,
                roast_session_id: null,
                token,
                expires_at: expiresAt.toISOString(),
                max_uses: maxUses,
            })
            .select()
            .single();
        if (error) throw error;
        const base = await resolveCuppingPublicBaseUrl();
        return { ...data, url: cuppingInviteUrl(data.token, base) };
    },

    revokeInvite: async (inviteId: string): Promise<CuppingInvite> => {
        const { data, error } = await supabase
            .from('cupping_invites')
            .update({ revoked_at: new Date().toISOString() })
            .eq('id', inviteId)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    createOwnerCupping: async (row: CuppingInsert): Promise<Cupping> => {
        const { data, error } = await supabase.from('cuppings').insert(row).select().single();
        if (error) throw error;
        return data;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('cuppings').delete().eq('id', id);
        if (error) throw error;
    },
};
