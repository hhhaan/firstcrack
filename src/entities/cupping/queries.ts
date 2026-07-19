import type { CuppingSample } from '@shared/types/database.types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export const useCuppingEvents = (userId: string, enabled = true) =>
    useQuery({
        queryKey: cuppingKeys.events(userId),
        queryFn: () => cuppingApi.listEvents(userId),
        staleTime: Infinity,
        enabled: !!userId && enabled,
        throwOnError: false,
    });

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

export const useEventInvite = (eventId: string, enabled = true) =>
    useQuery({
        queryKey: cuppingKeys.invite(eventId),
        queryFn: () => cuppingApi.getActiveInviteForEvent(eventId),
        staleTime: Infinity,
        enabled: !!eventId && enabled,
        throwOnError: false,
    });

export const useCuppingScoresBySample = (sampleId: string, enabled = true) =>
    useQuery({
        queryKey: cuppingKeys.scores(sampleId),
        queryFn: () => cuppingApi.listScoresBySample(sampleId),
        staleTime: Infinity,
        enabled: !!sampleId && enabled,
        throwOnError: false,
    });

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
    invite: CuppingEventSummary['active_invite'],
): CuppingEventSummary[] | undefined {
    if (!events) return events;
    return events.map((e) => (e.id === eventId ? { ...e, active_invite: invite } : e));
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
            qc.setQueryData(cuppingKeys.invite(eventId), optimistic);
            qc.setQueryData(cuppingKeys.events(userId), setEventActiveInvite(prevEvents, eventId, optimistic));
            return { prevInvite, prevEvents, tempId, skipped: false as const };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.skipped) return;
            if (ctx?.prevInvite !== undefined) qc.setQueryData(cuppingKeys.invite(eventId), ctx.prevInvite);
            if (ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
        },
        onSuccess: (real, _vars, ctx) => {
            if (ctx?.skipped) return;
            qc.setQueryData(cuppingKeys.invite(eventId), real);
            qc.setQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId), (old) =>
                setEventActiveInvite(old, eventId, real),
            );
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
            qc.setQueryData(cuppingKeys.invite(eventId), null);
            if (userId) {
                qc.setQueryData(cuppingKeys.events(userId), setEventActiveInvite(prevEvents, eventId, null));
            }
            return { prevInvite, prevEvents };
        },
        onError: (_err, _id, ctx) => {
            if (ctx?.prevInvite !== undefined) qc.setQueryData(cuppingKeys.invite(eventId), ctx.prevInvite);
            if (userId && ctx?.prevEvents) qc.setQueryData(cuppingKeys.events(userId), ctx.prevEvents);
        },
    });
};
