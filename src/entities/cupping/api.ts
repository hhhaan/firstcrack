import { logger } from '@shared/lib/logger';
import { supabase } from '@shared/lib/supabase';
import type {
    Cupping,
    CuppingEvent,
    CuppingFormTemplate,
    CuppingInvite,
    CuppingSample,
    Database,
    Json,
} from '@shared/types/database.types';
import { type CuppingFormSchema, PRESET_FORMS, parseFormSchema } from './lib/form';
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

/** PostgREST many-to-one embed is an object; generated types sometimes say array. */
function beanFromEmbed(beans: unknown): BeanCuppingMeta | null {
    const row = Array.isArray(beans) ? beans[0] : beans;
    if (!row || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name) return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
        name: o.name,
        origin: str(o.origin),
        region: str(o.region),
        variety: str(o.variety),
        process: str(o.process),
        farm: str(o.farm),
    };
}

/** origin · region · variety · process · farm (skips empty) */
export function formatBeanCuppingMeta(bean: Partial<BeanCuppingMeta> | null | undefined): string {
    if (!bean) return '';
    return [bean.origin, bean.region, bean.variety, bean.process, bean.farm].filter(Boolean).join(' · ');
}

export type CuppingFormRef = { kind: 'preset'; key: 'sca_v1' | 'simple_5' } | { kind: 'template'; id: string };

export type CreateEventInput = {
    userId: string;
    title: string;
    heldAt?: string;
    notes?: string | null;
    form?: CuppingFormRef;
};

export type CreateFormTemplateInput = {
    userId: string;
    name: string;
    schema: CuppingFormSchema;
};

export type UpdateFormTemplateInput = {
    id: string;
    name: string;
    schema: CuppingFormSchema;
};

async function snapshotForForm(
    userId: string,
    form?: CuppingFormRef,
): Promise<{ snapshot: CuppingFormSchema; templateId: string | null }> {
    if (!form || form.kind === 'preset') {
        const key = form?.key ?? 'sca_v1';
        return { snapshot: PRESET_FORMS[key], templateId: null };
    }
    const { data, error } = await supabase
        .from('cupping_form_templates')
        .select('*')
        .eq('id', form.id)
        .eq('user_id', userId)
        .single();
    if (error) throw error;
    return { snapshot: parseFormSchema(data.schema), templateId: data.id };
}

export type AddSampleInput = {
    userId: string;
    eventId: string;
    label: string;
    roastSessionId?: string | null;
    sortOrder?: number;
};

export type UpdateSampleInput = {
    eventId: string;
    sampleId: string;
    label: string;
    roastSessionId?: string | null;
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
    const { data: event, error: evErr } = await supabase
        .from('cupping_events')
        .select('ended_at')
        .eq('id', eventId)
        .maybeSingle();
    if (evErr) throw evErr;
    if (event?.ended_at) return null;

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
            const inv = ev.ended_at ? null : (activeInviteByEvent.get(ev.id) ?? null);
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

    createEvent: async ({ userId, title, heldAt, notes = null, form }: CreateEventInput): Promise<CuppingEvent> => {
        const { snapshot, templateId } = await snapshotForForm(userId, form);
        const { data, error } = await supabase
            .from('cupping_events')
            .insert({
                user_id: userId,
                title: title.trim() || 'Cupping',
                held_at: heldAt ?? new Date().toISOString(),
                notes,
                form_snapshot: snapshot as unknown as Json,
                form_template_id: templateId,
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    listFormTemplates: async (userId: string): Promise<CuppingFormTemplate[]> => {
        const { data, error } = await supabase
            .from('cupping_form_templates')
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    createFormTemplate: async ({ userId, name, schema }: CreateFormTemplateInput): Promise<CuppingFormTemplate> => {
        const parsed = parseFormSchema({ ...schema, key: 'custom', name: name.trim() || schema.name });
        const { data, error } = await supabase
            .from('cupping_form_templates')
            .insert({
                user_id: userId,
                name: parsed.name,
                schema: parsed as unknown as Json,
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    updateFormTemplate: async ({ id, name, schema }: UpdateFormTemplateInput): Promise<CuppingFormTemplate> => {
        const parsed = parseFormSchema({ ...schema, key: 'custom', name: name.trim() || schema.name });
        const { data, error } = await supabase
            .from('cupping_form_templates')
            .update({
                name: parsed.name,
                schema: parsed as unknown as Json,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    deleteFormTemplate: async (id: string): Promise<void> => {
        const { data, error } = await supabase.from('cupping_form_templates').delete().eq('id', id).select('id');
        if (error) throw error;
        if (data.length === 0) throw new Error('CUPPING_FORM_NOT_DELETED');
    },

    deleteEvent: async (eventId: string): Promise<void> => {
        // .select() so a RLS/filter miss (0 rows, no error) is not treated as success.
        const { data, error } = await supabase.from('cupping_events').delete().eq('id', eventId).select('id');
        if (error) throw error;
        if (data.length === 0) throw new Error('CUPPING_EVENT_NOT_DELETED');
    },

    /** Ensure results_token exists (ended sessions only). Idempotent. */
    ensureResultsToken: async (eventId: string): Promise<CuppingEvent> => {
        const existing = await cuppingApi.getEvent(eventId);
        if (existing.results_token) return existing;
        if (!existing.ended_at) throw new Error('SESSION_OPEN');

        const token = generateCuppingToken();
        const { data, error } = await supabase
            .from('cupping_events')
            .update({ results_token: token, updated_at: new Date().toISOString() })
            .eq('id', eventId)
            .is('results_token', null)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            const again = await cuppingApi.getEvent(eventId);
            if (again.results_token) return again;
            throw new Error('CUPPING_RESULTS_TOKEN_NOT_SET');
        }
        return data;
    },

    /** Close session: set ended_at + results_token + revoke invites. Idempotent. */
    endEvent: async (eventId: string): Promise<CuppingEvent> => {
        const existing = await cuppingApi.getEvent(eventId);
        if (existing.ended_at) {
            if (existing.results_token) return existing;
            return cuppingApi.ensureResultsToken(eventId);
        }

        const now = new Date().toISOString();
        const resultsToken = existing.results_token ?? generateCuppingToken();
        const { data, error } = await supabase
            .from('cupping_events')
            .update({ ended_at: now, updated_at: now, results_token: resultsToken })
            .eq('id', eventId)
            .is('ended_at', null)
            .select()
            .single();
        if (error) throw error;

        const { error: revErr } = await supabase
            .from('cupping_invites')
            .update({ revoked_at: now })
            .eq('event_id', eventId)
            .is('revoked_at', null);
        if (revErr) throw revErr;

        return data;
    },

    assertEventOpen: async (eventId: string): Promise<void> => {
        const ev = await cuppingApi.getEvent(eventId);
        if (ev.ended_at) throw new Error('SESSION_ENDED');
    },

    listSamples: async (eventId: string): Promise<CuppingSampleWithMeta[]> => {
        // Same event_id read as listEvents. Do not embed roast_sessions/beans here:
        // that nested select can return zero parent rows (RLS or an inner join on a
        // missing roast/bean) while `select id, event_id` still counts the samples.
        const { data: samples, error } = await supabase
            .from('cupping_samples')
            .select('*')
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

        const roastIds = [...new Set(samples.map((s) => s.roast_session_id).filter((id): id is string => Boolean(id)))];
        const roastById = new Map<string, NonNullable<CuppingSampleWithMeta['roast_sessions']>>();
        if (roastIds.length) {
            const { data: sessions, error: rErr } = await supabase
                .from('roast_sessions')
                .select('id, roasted_at, beans(name, origin, region, variety, process, farm)')
                .in('id', roastIds);
            // Bean/roast meta is display-only. A failed embed must not hide the samples.
            if (rErr) logger.capture(rErr, { scope: 'cupping.listSamples.roastMeta', eventId });
            else {
                for (const row of sessions ?? []) {
                    roastById.set(row.id, {
                        id: row.id,
                        roasted_at: row.roasted_at,
                        beans: beanFromEmbed(row.beans),
                    });
                }
            }
        }

        return samples.map((s) => {
            const scoreList = scoresBySample.get(s.id) ?? [];
            const avg =
                scoreList.length > 0
                    ? Math.round((scoreList.reduce((a, b) => a + b, 0) / scoreList.length) * 100) / 100
                    : null;
            return {
                ...s,
                roast_sessions: s.roast_session_id ? (roastById.get(s.roast_session_id) ?? null) : null,
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
        await cuppingApi.assertEventOpen(eventId);
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
        await cuppingApi.assertEventOpen(eventId);
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
    reorderSamples: async (eventId: string, orderedIds: string[]): Promise<void> => {
        if (!orderedIds.length) return;
        const { error } = await supabase.rpc('reorder_cupping_samples', {
            p_event_id: eventId,
            p_ordered_ids: orderedIds,
        });
        if (error) throw error;
    },

    updateSample: async ({
        eventId,
        sampleId,
        label,
        roastSessionId = null,
    }: UpdateSampleInput): Promise<CuppingSample> => {
        await cuppingApi.assertEventOpen(eventId);
        const { data, error } = await supabase
            .from('cupping_samples')
            .update({
                label: label.trim() || 'Sample',
                roast_session_id: roastSessionId,
            })
            .eq('id', sampleId)
            .eq('event_id', eventId)
            .select()
            .single();
        if (error) throw error;
        return data;
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
        await cuppingApi.assertEventOpen(eventId);
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
