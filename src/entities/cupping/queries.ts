import type { CuppingEvent, CuppingSample } from '@shared/types/database.types';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    type AddSampleInput,
    type CreateEventInput,
    type CreateInviteForEventInput,
    type CreateInviteResult,
    type CuppingEventSummary,
    type CuppingSampleWithMeta,
    cuppingApi,
} from './api';
import { cuppingInviteUrl, generateCuppingToken, resolveCuppingPublicBaseUrl } from './lib/token';

export const cuppingKeys = {
    events: (userId: string) => ['cupping_events', userId] as const,
    event: (eventId: string) => ['cupping_events', 'detail', eventId] as const,
    samples: (eventId: string) => ['cupping_samples', eventId] as const,
    invite: (eventId: string) => ['cupping_invite', eventId] as const,
    scores: (sampleId: string) => ['cuppings', 'sample', sampleId] as const,
};

type ActiveInvite = CuppingEventSummary['active_invite'];

function bumpEventSampleCount(
    events: CuppingEventSummary[] | undefined,
    eventId: string,
    delta: number,
): CuppingEventSummary[] | undefined {
    if (!events) return events;
    return events.map((e) => (e.id === eventId ? { ...e, sample_count: Math.max(0, e.sample_count + delta) } : e));
}

function setEventActiveInvite(
    events: CuppingEventSummary[] | undefined,
    eventId: string,
    invite: ActiveInvite,
): CuppingEventSummary[] | undefined {
    if (!events) return events;
    return events.map((e) => (e.id === eventId ? { ...e, active_invite: invite } : e));
}

/** Find event summary in any user events list cache (skips detail keys). */
export function findEventSummaryInCache(qc: QueryClient, eventId: string): CuppingEventSummary | undefined {
    const queries = qc.getQueriesData<CuppingEventSummary[]>({ queryKey: ['cupping_events'] });
    for (const [key, data] of queries) {
        if (key[1] === 'detail') continue;
        if (!Array.isArray(data)) continue;
        const found = data.find((e) => e.id === eventId);
        if (found) return found;
    }
    return undefined;
}

/**
 * Keep `cupping_invite[eventId]` and every events-list `active_invite` in lockstep.
 * List badge + detail "Link active" share one write path (gcTime Infinity → miss = permanent desync).
 */
export function syncActiveInviteCache(qc: QueryClient, eventId: string, invite: ActiveInvite, userId?: string): void {
    qc.setQueryData<ActiveInvite>(cuppingKeys.invite(eventId), invite);

    if (userId) {
        qc.setQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId), (old) =>
            setEventActiveInvite(old, eventId, invite),
        );
        return;
    }

    // No userId: patch every loaded events list that contains this event
    const queries = qc.getQueriesData<CuppingEventSummary[]>({ queryKey: ['cupping_events'] });
    for (const [key, data] of queries) {
        if (key[1] === 'detail') continue;
        if (!Array.isArray(data) || !data.some((e) => e.id === eventId)) continue;
        qc.setQueryData<CuppingEventSummary[]>(key, setEventActiveInvite(data, eventId, invite));
    }
}

/**
 * Session end: set ended_at on list + detail, clear active invite everywhere.
 * Idempotent for cache purposes — always forces invite null.
 */
export function syncEventEndedCache(
    qc: QueryClient,
    userId: string,
    eventId: string,
    endedAt: string,
    eventPatch?: CuppingEvent | Partial<CuppingEvent>,
): void {
    qc.setQueryData<ActiveInvite>(cuppingKeys.invite(eventId), null);

    qc.setQueryData<CuppingEvent | undefined>(cuppingKeys.event(eventId), (old) => {
        if (eventPatch && 'id' in eventPatch && eventPatch.id) {
            return { ...(old ?? (eventPatch as CuppingEvent)), ...eventPatch, ended_at: endedAt };
        }
        if (!old) return old;
        return { ...old, ...eventPatch, ended_at: endedAt, updated_at: endedAt };
    });

    qc.setQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId), (old = []) =>
        old.map((e) =>
            e.id === eventId
                ? {
                      ...e,
                      ...eventPatch,
                      ended_at: endedAt,
                      updated_at: (eventPatch?.updated_at as string | undefined) ?? endedAt,
                      active_invite: null,
                  }
                : e,
        ),
    );
}

/** After list fetch/refetch: write-through invite keys so detail remount matches list badges. */
export function writeThroughInvitesFromEvents(qc: QueryClient, events: CuppingEventSummary[]): void {
    for (const ev of events) {
        const invite = ev.ended_at ? null : (ev.active_invite ?? null);
        qc.setQueryData<ActiveInvite>(cuppingKeys.invite(ev.id), invite);

        // Keep detail.ended_at aligned when detail is already cached
        if (ev.ended_at) {
            qc.setQueryData<CuppingEvent | undefined>(cuppingKeys.event(ev.id), (old) =>
                old && old.ended_at !== ev.ended_at
                    ? { ...old, ended_at: ev.ended_at, updated_at: ev.updated_at }
                    : old,
            );
        }
    }
}

function toSampleWithMeta(sample: CuppingSample, sortOrder: number): CuppingSampleWithMeta {
    return {
        ...sample,
        sort_order: sample.sort_order ?? sortOrder,
        roast_sessions: null,
        score_count: 0,
        avg_score: null,
    };
}

export const useCuppingEvents = (userId: string, enabled = true) => {
    const qc = useQueryClient();
    return useQuery({
        queryKey: cuppingKeys.events(userId),
        queryFn: async () => {
            const events = await cuppingApi.listEvents(userId);
            // List is SSoT for link-active / ended → keep invite keys consistent on every fetch
            writeThroughInvitesFromEvents(qc, events);
            return events;
        },
        staleTime: Infinity,
        enabled: !!userId && enabled,
        throwOnError: false,
    });
};

export const useCuppingEvent = (eventId: string, enabled = true) =>
    useQuery({
        queryKey: cuppingKeys.event(eventId),
        queryFn: () => cuppingApi.getEvent(eventId),
        staleTime: Infinity,
        enabled: !!eventId && enabled,
        throwOnError: false,
    });

export const useCuppingSamples = (eventId: string, enabled = true) =>
    useQuery({
        queryKey: cuppingKeys.samples(eventId),
        queryFn: () => cuppingApi.listSamples(eventId),
        staleTime: Infinity,
        enabled: !!eventId && enabled,
        throwOnError: false,
    });

/**
 * Active session invite. Seeds from events-list cache so list "Link active" and detail
 * agree immediately when navigating back (gcTime Infinity dual-cache).
 * When session is ended, forced null and no network.
 */
export const useEventInvite = (eventId: string, enabled = true, isEnded = false) => {
    const qc = useQueryClient();

    return useQuery({
        queryKey: cuppingKeys.invite(eventId),
        queryFn: () => cuppingApi.getActiveInviteForEvent(eventId),
        staleTime: Infinity,
        enabled: !!eventId && enabled && !isEnded,
        throwOnError: false,
        // Seed only when invite key empty — list/write-through/mutations own the value thereafter
        initialData: () => {
            if (isEnded) return null;
            const existing = qc.getQueryData<ActiveInvite>(cuppingKeys.invite(eventId));
            if (existing !== undefined) return existing;
            const summary = findEventSummaryInCache(qc, eventId);
            if (!summary) return undefined;
            if (summary.ended_at) return null;
            return summary.active_invite ?? null;
        },
        initialDataUpdatedAt: () => {
            const state = qc.getQueryState(cuppingKeys.invite(eventId));
            if (state?.dataUpdatedAt) return state.dataUpdatedAt;
            // Seeded from list: treat as fresh so Infinity does not refetch stale dual-source
            if (findEventSummaryInCache(qc, eventId)) return Date.now();
            return 0;
        },
    });
};

export const useCuppingScoresBySample = (sampleId: string, enabled = true) =>
    useQuery({
        queryKey: cuppingKeys.scores(sampleId),
        queryFn: () => cuppingApi.listScoresBySample(sampleId),
        staleTime: Infinity,
        enabled: !!sampleId && enabled,
        throwOnError: false,
    });

export const useCreateCuppingEvent = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: Omit<CreateEventInput, 'userId'>) => cuppingApi.createEvent({ ...input, userId }),
        onMutate: async (input) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            const prev = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
            const tempId = `opt_${crypto.randomUUID()}`;
            const now = new Date().toISOString();
            const optimistic: CuppingEventSummary = {
                id: tempId,
                user_id: userId,
                title: input.title.trim() || 'Cupping',
                held_at: input.heldAt ?? now,
                notes: input.notes ?? null,
                ended_at: null,
                created_at: now,
                updated_at: now,
                sample_count: 0,
                score_count: 0,
                participant_count: 0,
                participants: [],
                avg_score: null,
                active_invite: null,
            };
            qc.setQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId), (old = []) => [optimistic, ...old]);
            return { prev, tempId };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.prev) qc.setQueryData(cuppingKeys.events(userId), ctx.prev);
        },
        onSuccess: (real, _vars, ctx) => {
            const summary: CuppingEventSummary = {
                ...real,
                sample_count: 0,
                score_count: 0,
                participant_count: 0,
                participants: [],
                avg_score: null,
                active_invite: null,
            };
            qc.setQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId), (old = []) =>
                old.map((e) => (e.id === ctx?.tempId ? summary : e)),
            );
            qc.setQueryData(cuppingKeys.event(real.id), real);
            syncActiveInviteCache(qc, real.id, null, userId);
        },
    });
};

export const useEndCuppingEvent = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (eventId: string) => cuppingApi.endEvent(eventId),
        onMutate: async (eventId) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.event(eventId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.invite(eventId) });
            const prevEvents = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
            const prevEvent = qc.getQueryData(cuppingKeys.event(eventId));
            const prevInvite = qc.getQueryData(cuppingKeys.invite(eventId));
            const now = new Date().toISOString();
            syncEventEndedCache(qc, userId, eventId, now);
            return { prevEvents, prevEvent, prevInvite, eventId };
        },
        onError: (_err, eventId, ctx) => {
            if (ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
            if (ctx?.prevEvent !== undefined) qc.setQueryData(cuppingKeys.event(eventId), ctx.prevEvent);
            if (ctx?.prevInvite !== undefined) qc.setQueryData(cuppingKeys.invite(eventId), ctx.prevInvite);
        },
        onSuccess: (real) => {
            // Server timestamp wins; always clear invite (revoked on server)
            syncEventEndedCache(qc, userId, real.id, real.ended_at ?? new Date().toISOString(), real);
        },
    });
};

export const useDeleteCuppingEvent = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: cuppingApi.deleteEvent,
        onMutate: async (eventId) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.samples(eventId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.invite(eventId) });
            const prevEvents = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
            const prevSamples = qc.getQueryData(cuppingKeys.samples(eventId));
            const prevInvite = qc.getQueryData(cuppingKeys.invite(eventId));
            qc.setQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId), (old = []) =>
                old.filter((e) => e.id !== eventId),
            );
            return { prevEvents, prevSamples, prevInvite, eventId };
        },
        onError: (_err, eventId, ctx) => {
            if (ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
            if (ctx?.prevSamples !== undefined) qc.setQueryData(cuppingKeys.samples(eventId), ctx.prevSamples);
            if (ctx?.prevInvite !== undefined) qc.setQueryData(cuppingKeys.invite(eventId), ctx.prevInvite);
        },
        onSuccess: (_data, eventId) => {
            qc.removeQueries({ queryKey: cuppingKeys.event(eventId) });
            qc.removeQueries({ queryKey: cuppingKeys.samples(eventId) });
            qc.removeQueries({ queryKey: cuppingKeys.invite(eventId) });
        },
    });
};

export const useAddCuppingSamples = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (items: { label: string; roastSessionId?: string | null }[]) =>
            cuppingApi.addSamplesBatch(userId, eventId, items),
        onMutate: async (items) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.samples(eventId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            const prevSamples = qc.getQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId));
            const prevEvents = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
            const now = new Date().toISOString();
            const baseOrder = prevSamples?.length ?? 0;
            const tempIds = items.map(() => `opt_${crypto.randomUUID()}`);
            const optimistic: CuppingSampleWithMeta[] = items.map((item, i) =>
                toSampleWithMeta(
                    {
                        id: tempIds[i],
                        user_id: userId,
                        event_id: eventId,
                        label: item.label.trim() || `Sample ${i + 1}`,
                        roast_session_id: item.roastSessionId ?? null,
                        sort_order: baseOrder + i,
                        created_at: now,
                    },
                    baseOrder + i,
                ),
            );
            qc.setQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId), (old = []) => [
                ...old,
                ...optimistic,
            ]);
            qc.setQueryData(cuppingKeys.events(userId), bumpEventSampleCount(prevEvents, eventId, items.length));
            return { prevSamples, prevEvents, tempIds };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.prevSamples) qc.setQueryData(cuppingKeys.samples(eventId), ctx.prevSamples);
            if (ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
        },
        onSuccess: (realSamples, _vars, ctx) => {
            const tempSet = new Set(ctx?.tempIds ?? []);
            qc.setQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId), (old = []) => {
                const kept = old.filter((s) => !tempSet.has(s.id));
                const mapped = realSamples.map((s, i) => toSampleWithMeta(s, kept.length + i));
                return [...kept, ...mapped];
            });
            // Keep events list counts accurate without full refetch
            void qc.invalidateQueries({ queryKey: cuppingKeys.samples(eventId) });
            void qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useAddCuppingSample = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: Omit<AddSampleInput, 'userId' | 'eventId'>) =>
            cuppingApi.addSample({ ...input, userId, eventId }),
        onMutate: async (input) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.samples(eventId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            const prevSamples = qc.getQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId));
            const prevEvents = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
            const tempId = `opt_${crypto.randomUUID()}`;
            const now = new Date().toISOString();
            const sortOrder = input.sortOrder ?? prevSamples?.length ?? 0;
            const optimistic = toSampleWithMeta(
                {
                    id: tempId,
                    user_id: userId,
                    event_id: eventId,
                    label: input.label.trim() || 'Sample',
                    roast_session_id: input.roastSessionId ?? null,
                    sort_order: sortOrder,
                    created_at: now,
                },
                sortOrder,
            );
            qc.setQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId), (old = []) => [...old, optimistic]);
            qc.setQueryData(cuppingKeys.events(userId), bumpEventSampleCount(prevEvents, eventId, 1));
            return { prevSamples, prevEvents, tempId };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.prevSamples) qc.setQueryData(cuppingKeys.samples(eventId), ctx.prevSamples);
            if (ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
        },
        onSuccess: (real, _vars, ctx) => {
            qc.setQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId), (old = []) =>
                old.map((s) => (s.id === ctx?.tempId ? toSampleWithMeta(real, s.sort_order) : s)),
            );
            void qc.invalidateQueries({ queryKey: cuppingKeys.samples(eventId) });
            void qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useDeleteCuppingSample = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: cuppingApi.deleteSample,
        onMutate: async (sampleId) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.samples(eventId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            const prevSamples = qc.getQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId));
            const prevEvents = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
            qc.setQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId), (old = []) =>
                old.filter((s) => s.id !== sampleId),
            );
            qc.setQueryData(cuppingKeys.events(userId), bumpEventSampleCount(prevEvents, eventId, -1));
            return { prevSamples, prevEvents };
        },
        onError: (_err, _id, ctx) => {
            if (ctx?.prevSamples) qc.setQueryData(cuppingKeys.samples(eventId), ctx.prevSamples);
            if (ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
        },
        onSuccess: (_data, sampleId) => {
            qc.removeQueries({ queryKey: cuppingKeys.scores(sampleId) });
        },
    });
};

/** Reorder samples by full ordered id list. Optimistic; reverts on error. */
export const useReorderCuppingSamples = (eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (orderedIds: string[]) => cuppingApi.reorderSamples(orderedIds),
        onMutate: async (orderedIds) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.samples(eventId) });
            const prev = qc.getQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId));
            if (!prev) return { prev };
            const byId = new Map(prev.map((s) => [s.id, s]));
            const next: CuppingSampleWithMeta[] = [];
            for (let i = 0; i < orderedIds.length; i++) {
                const s = byId.get(orderedIds[i]);
                if (s) next.push({ ...s, sort_order: i });
            }
            // Keep any ids missing from orderedIds (shouldn't happen) at the end
            for (const s of prev) {
                if (!orderedIds.includes(s.id)) next.push(s);
            }
            qc.setQueryData(cuppingKeys.samples(eventId), next);
            return { prev };
        },
        onError: (_err, _ids, ctx) => {
            if (ctx?.prev) qc.setQueryData(cuppingKeys.samples(eventId), ctx.prev);
        },
    });
};

export const useCreateEventInvite = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input?: Omit<CreateInviteForEventInput, 'userId' | 'eventId'>) =>
            cuppingApi.createInviteForEvent({ ...input, userId, eventId }),
        onMutate: async (input) => {
            await qc.cancelQueries({ queryKey: cuppingKeys.invite(eventId) });
            await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            const prevInvite = qc.getQueryData<CreateInviteResult | null>(cuppingKeys.invite(eventId));
            const prevEvents = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
            if (prevInvite) return { prevInvite, prevEvents, skipped: true as const };

            const tempId = `opt_${crypto.randomUUID()}`;
            const token = generateCuppingToken();
            const now = new Date();
            const expires = new Date(now);
            expires.setDate(expires.getDate() + (input?.expiresInDays ?? 7));
            const base = await resolveCuppingPublicBaseUrl();
            const optimistic: CreateInviteResult = {
                id: tempId,
                user_id: userId,
                event_id: eventId,
                sample_id: null,
                roast_session_id: null,
                label: null,
                token,
                expires_at: expires.toISOString(),
                max_uses: input?.maxUses ?? 10_000,
                used_count: 0,
                revoked_at: null,
                created_at: now.toISOString(),
                url: cuppingInviteUrl(token, base),
            };
            syncActiveInviteCache(qc, eventId, optimistic, userId);
            return { prevInvite, prevEvents, tempId, skipped: false as const };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.skipped) return;
            if (ctx?.prevInvite !== undefined) qc.setQueryData(cuppingKeys.invite(eventId), ctx.prevInvite);
            if (ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
        },
        onSuccess: (real, _vars, ctx) => {
            // Always sync real invite (even when skipped optimistic) so list/detail stay aligned
            syncActiveInviteCache(qc, eventId, real, userId);
            if (ctx?.skipped) return;
        },
    });
};

export const useRevokeCuppingInvite = (eventId: string, userId?: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: cuppingApi.revokeInvite,
        onMutate: async () => {
            await qc.cancelQueries({ queryKey: cuppingKeys.invite(eventId) });
            if (userId) await qc.cancelQueries({ queryKey: cuppingKeys.events(userId) });
            const prevInvite = qc.getQueryData(cuppingKeys.invite(eventId));
            const prevEvents = userId ? qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId)) : undefined;
            syncActiveInviteCache(qc, eventId, null, userId);
            return { prevInvite, prevEvents };
        },
        onError: (_err, _id, ctx) => {
            if (ctx?.prevInvite !== undefined) qc.setQueryData(cuppingKeys.invite(eventId), ctx.prevInvite);
            if (userId && ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
        },
        onSuccess: () => {
            // Confirm null on both keys after server revoke
            syncActiveInviteCache(qc, eventId, null, userId);
        },
    });
};
