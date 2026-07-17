import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AddSampleInput, type CreateEventInput, type CreateInviteForEventInput, cuppingApi } from './api';

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

export const useCreateCuppingEvent = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: Omit<CreateEventInput, 'userId'>) => cuppingApi.createEvent({ ...input, userId }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useDeleteCuppingEvent = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: cuppingApi.deleteEvent,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useAddCuppingSamples = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (items: { label: string; roastSessionId?: string | null }[]) =>
            cuppingApi.addSamplesBatch(userId, eventId, items),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: cuppingKeys.samples(eventId) });
            qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useAddCuppingSample = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: Omit<AddSampleInput, 'userId' | 'eventId'>) =>
            cuppingApi.addSample({ ...input, userId, eventId }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: cuppingKeys.samples(eventId) });
            qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useDeleteCuppingSample = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: cuppingApi.deleteSample,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: cuppingKeys.samples(eventId) });
            qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useCreateEventInvite = (userId: string, eventId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input?: Omit<CreateInviteForEventInput, 'userId' | 'eventId'>) =>
            cuppingApi.createInviteForEvent({ ...input, userId, eventId }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: cuppingKeys.invite(eventId) });
            qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};

export const useRevokeCuppingInvite = (eventId: string, userId?: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: cuppingApi.revokeInvite,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: cuppingKeys.invite(eventId) });
            if (userId) qc.invalidateQueries({ queryKey: cuppingKeys.events(userId) });
        },
    });
};
