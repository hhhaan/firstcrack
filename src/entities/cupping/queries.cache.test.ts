import type { CuppingEvent } from '@shared/types/database.types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { CuppingEventSummary } from './api';
import {
    cuppingKeys,
    findEventSummaryInCache,
    syncActiveInviteCache,
    syncEventEndedCache,
    writeThroughInvitesFromEvents,
} from './queries';

const userId = 'user-1';
const eventId = 'ev-1';

function makeSummary(overrides: Partial<CuppingEventSummary> = {}): CuppingEventSummary {
    const now = '2026-07-01T00:00:00.000Z';
    return {
        id: eventId,
        user_id: userId,
        title: 'Morning cupping',
        held_at: now,
        notes: null,
        ended_at: null,
        created_at: now,
        updated_at: now,
        sample_count: 2,
        score_count: 0,
        participant_count: 0,
        participants: [],
        avg_score: null,
        active_invite: null,
        ...overrides,
    };
}

function makeInvite() {
    return {
        id: 'inv-1',
        user_id: userId,
        event_id: eventId,
        sample_id: null,
        roast_session_id: null,
        label: null,
        token: 'tok',
        expires_at: '2026-08-01T00:00:00.000Z',
        max_uses: 10_000,
        used_count: 0,
        revoked_at: null,
        created_at: '2026-07-01T00:00:00.000Z',
        url: 'https://example.com/c/tok',
    };
}

describe('cupping invite/end cache sync', () => {
    it('syncActiveInviteCache keeps list active_invite and invite key identical', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        qc.setQueryData(cuppingKeys.events(userId), [makeSummary()]);
        const invite = makeInvite();

        syncActiveInviteCache(qc, eventId, invite, userId);

        expect(qc.getQueryData(cuppingKeys.invite(eventId))).toEqual(invite);
        const events = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
        expect(events?.[0]?.active_invite).toEqual(invite);
    });

    it('syncActiveInviteCache null clears both keys (revoke / end path)', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const invite = makeInvite();
        qc.setQueryData(cuppingKeys.events(userId), [makeSummary({ active_invite: invite })]);
        qc.setQueryData(cuppingKeys.invite(eventId), invite);

        syncActiveInviteCache(qc, eventId, null, userId);

        expect(qc.getQueryData(cuppingKeys.invite(eventId))).toBeNull();
        expect(qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId))?.[0]?.active_invite).toBeNull();
    });

    it('syncEventEndedCache sets ended_at, clears invite, and survives remount-style re-read', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const invite = makeInvite();
        const endedAt = '2026-07-02T12:00:00.000Z';
        qc.setQueryData(cuppingKeys.events(userId), [makeSummary({ active_invite: invite })]);
        qc.setQueryData(cuppingKeys.invite(eventId), invite);
        qc.setQueryData(cuppingKeys.event(eventId), {
            id: eventId,
            user_id: userId,
            title: 'Morning cupping',
            held_at: '2026-07-01T00:00:00.000Z',
            notes: null,
            ended_at: null,
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
        } satisfies CuppingEvent);

        syncEventEndedCache(qc, userId, eventId, endedAt);

        // Simulate leaving detail and reading list + invite again
        const list = qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events(userId));
        const inviteAfter = qc.getQueryData(cuppingKeys.invite(eventId));
        const detail = qc.getQueryData<CuppingEvent>(cuppingKeys.event(eventId));

        expect(list?.[0]?.ended_at).toBe(endedAt);
        expect(list?.[0]?.active_invite).toBeNull();
        expect(inviteAfter).toBeNull();
        expect(detail?.ended_at).toBe(endedAt);
    });

    it('writeThroughInvitesFromEvents aligns invite keys with list (navigate-back consistency)', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const invite = makeInvite();
        // Stale invite cache left from before end
        qc.setQueryData(cuppingKeys.invite(eventId), invite);
        qc.setQueryData(cuppingKeys.invite('ev-open'), null);

        writeThroughInvitesFromEvents(qc, [
            makeSummary({ id: eventId, ended_at: '2026-07-02T00:00:00.000Z', active_invite: null }),
            makeSummary({ id: 'ev-open', active_invite: invite }),
        ]);

        expect(qc.getQueryData(cuppingKeys.invite(eventId))).toBeNull();
        expect(qc.getQueryData(cuppingKeys.invite('ev-open'))).toEqual(invite);
    });

    it('findEventSummaryInCache skips detail keys', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const summary = makeSummary({ title: 'From list' });
        qc.setQueryData(cuppingKeys.events(userId), [summary]);
        qc.setQueryData(cuppingKeys.event(eventId), {
            ...summary,
            title: 'From detail',
        });

        expect(findEventSummaryInCache(qc, eventId)?.title).toBe('From list');
    });
});
