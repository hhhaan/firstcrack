// @vitest-environment jsdom

import { profileKeys } from '@shared/lib/query-keys';
import type { Profile } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profileApi } from './api';
import { useProfile, useUpdateProfile } from './queries';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('./api', () => ({ profileApi: { get: vi.fn(), update: vi.fn() } }));

const profile = (id = 'user-1'): Profile => ({
    id,
    display_name: 'Roaster',
    default_roast_profile_id: 'original',
    avatar_url: null,
    business_name: null,
    business_registration_number: null,
    country_code: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    plan: 'pro',
    polar_customer_id: null,
    simulator_enabled: false,
});

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

describe('profile cache edits', () => {
    let qc: QueryClient;
    let host: HTMLDivElement;
    let root: Root;
    let server: Profile | null;
    let actions: ReturnType<typeof useUpdateProfile>[];
    const key = profileKeys.detail('user-1');

    function Harness() {
        actions = [useUpdateProfile('user-1'), useUpdateProfile('user-1'), useUpdateProfile('user-2')];
        const first = useProfile('user-1');
        const second = useProfile('user-1');
        return createElement(
            'div',
            null,
            `${first.data?.default_roast_profile_id}|${second.data?.default_roast_profile_id}`,
        );
    }

    beforeEach(async () => {
        vi.resetAllMocks();
        server = profile();
        vi.mocked(profileApi.get).mockImplementation(async () => server);
        qc = new QueryClient({
            defaultOptions: {
                queries: { retry: false, staleTime: Infinity },
                mutations: { retry: false },
            },
        });
        qc.setQueryData(key, server);
        qc.setQueryData(profileKeys.detail('user-2'), profile('user-2'));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness))));
    });

    afterEach(() => {
        act(() => root.unmount());
        qc.clear();
        host.remove();
    });

    it.each([
        { firstSucceeds: true, secondSucceeds: true, expected: 'second' },
        { firstSucceeds: false, secondSucceeds: true, expected: 'second' },
        { firstSucceeds: true, secondSucceeds: false, expected: 'first' },
        { firstSucceeds: false, secondSucceeds: false, expected: 'original' },
    ])(
        'serializes edits and restores $expected ($firstSucceeds / $secondSucceeds)',
        async ({ firstSucceeds, secondSucceeds, expected }) => {
            const first = deferred<Profile>();
            const second = deferred<Profile>();
            vi.mocked(profileApi.update).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

            await act(async () => actions[0].mutate({ default_roast_profile_id: 'first' }));
            expect(qc.getQueryData<Profile>(key)?.default_roast_profile_id).toBe('first');
            await act(async () => actions[1].mutate({ default_roast_profile_id: 'second' }));
            expect(qc.getQueryData<Profile>(key)?.default_roast_profile_id).toBe('second');
            expect(profileApi.update).toHaveBeenCalledTimes(1);

            await act(async () => {
                if (firstSucceeds) {
                    server = { ...profile(), default_roast_profile_id: 'first' };
                    first.resolve(server);
                } else first.reject(new Error('First edit failed'));
            });
            await vi.waitFor(() => expect(profileApi.update).toHaveBeenCalledTimes(2));
            expect(qc.getQueryData<Profile>(key)?.default_roast_profile_id).toBe('second');
            expect(profileApi.get).not.toHaveBeenCalled();

            await act(async () => {
                if (secondSucceeds) {
                    server = { ...profile(), default_roast_profile_id: 'second' };
                    second.resolve(server);
                } else second.reject(new Error('Second edit failed'));
            });
            await vi.waitFor(() => expect(qc.isMutating()).toBe(0));
            expect(qc.getQueryData<Profile>(key)?.default_roast_profile_id).toBe(expected);
            expect(profileApi.get).toHaveBeenCalledTimes(1);
            await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
            expect(host.textContent).toBe(`${expected}|${expected}`);
        },
    );

    it('restores the cached row even if the reconciliation read also fails', async () => {
        vi.mocked(profileApi.update).mockRejectedValue(new Error('Write failed'));
        vi.mocked(profileApi.get).mockRejectedValue(new Error('Read failed'));
        await act(async () => actions[0].mutate({ default_roast_profile_id: null }));
        await vi.waitFor(() => expect(qc.isMutating()).toBe(0));
        expect(qc.getQueryData(key)).toEqual(profile());
    });

    it('does not restore a failed field over a later successful edit to a different field', async () => {
        const first = deferred<Profile>();
        const second = deferred<Profile>();
        vi.mocked(profileApi.update).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        await act(async () => actions[0].mutate({ default_roast_profile_id: 'failed' }));
        await act(async () => actions[1].mutate({ display_name: 'New name' }));
        await act(async () => first.reject(new Error('Default failed')));
        await vi.waitFor(() => expect(profileApi.update).toHaveBeenCalledTimes(2));
        await act(async () => {
            server = { ...profile(), display_name: 'New name' };
            second.resolve(server);
        });
        await vi.waitFor(() => expect(qc.isMutating()).toBe(0));
        expect(qc.getQueryData(key)).toMatchObject({ default_roast_profile_id: 'original', display_name: 'New name' });
    });

    it('keeps different accounts independent and rolls back a missing profile without fabricating a row', async () => {
        const first = deferred<Profile>();
        const other = deferred<Profile>();
        vi.mocked(profileApi.update).mockReturnValueOnce(first.promise).mockReturnValueOnce(other.promise);
        await act(async () => actions[0].mutate({ default_roast_profile_id: 'pending' }));
        await act(async () => actions[2].mutate({ display_name: 'Other account' }));
        expect(profileApi.update).toHaveBeenCalledTimes(2);
        await act(async () => {
            first.reject(new Error('Write failed'));
            other.resolve({ ...profile('user-2'), display_name: 'Other account' });
        });
        await vi.waitFor(() => expect(qc.isMutating()).toBe(0));
        expect(qc.getQueryData(key)).toEqual(profile());
        expect(qc.getQueryData(profileKeys.detail('user-2'))).toMatchObject({ display_name: 'Other account' });

        server = null;
        act(() => qc.setQueryData(key, null));
        vi.mocked(profileApi.update).mockRejectedValue(new Error('No profile'));
        await act(async () => actions[0].mutate({ display_name: 'Unstored' }));
        await vi.waitFor(() => expect(qc.isMutating()).toBe(0));
        expect(qc.getQueryData(key)).toBeNull();
    });
});
