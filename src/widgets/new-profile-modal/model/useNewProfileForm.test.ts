// @vitest-environment jsdom
import type { RoastProfileWithSource } from '@entities/roast-profile';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_PROFILE_FORM } from '../lib/types';
import { resolveNewProfileFormState, useNewProfileForm } from './useNewProfileForm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1' }),
}));

vi.mock('@entities/roast', () => ({
    useRoastSessions: () => ({
        data: [
            {
                id: 's1',
                beans: { name: 'Ethiopia' },
                roasted_at: '2026-09-15T13:23:00Z',
                roast_level: 'Medium',
                events: null,
            },
        ],
    }),
}));

vi.mock('@entities/bean/queries', () => ({ useBeans: () => ({ data: [] }) }));
vi.mock('@entities/blend', () => ({ useBlends: () => ({ data: [] }) }));

const editing = {
    id: 'p1',
    name: 'QA Smoke 0917',
    description: 'leftover',
    target_level: 'Medium-Light',
    source_session_id: 's1',
    default_bean_id: 'bean-1',
    default_blend_id: null,
} as RoastProfileWithSource;

describe('resolveNewProfileFormState (#471)', () => {
    it('close/unmount returns the session picker, not leftover create values', () => {
        expect(resolveNewProfileFormState(false, null)).toEqual({
            mode: 'session-list',
            form: INITIAL_PROFILE_FORM,
            selectedSessionId: null,
            defaultType: 'none',
            defaultBeanId: null,
            defaultBlendId: null,
        });
    });

    it('open create starts on the session picker', () => {
        expect(resolveNewProfileFormState(true, null).mode).toBe('session-list');
        expect(resolveNewProfileFormState(true, null).form).toEqual(INITIAL_PROFILE_FORM);
    });

    it('open edit hydrates from the selected profile', () => {
        expect(resolveNewProfileFormState(true, editing)).toEqual({
            mode: 'from-session',
            form: {
                name: 'QA Smoke 0917',
                description: 'leftover',
                target_level: 'Medium-Light',
            },
            selectedSessionId: 's1',
            defaultType: 'bean',
            defaultBeanId: 'bean-1',
            defaultBlendId: null,
        });
    });

    it('close after edit also clears so the next create is clean', () => {
        expect(resolveNewProfileFormState(false, editing).mode).toBe('session-list');
        expect(resolveNewProfileFormState(false, editing).form).toEqual(INITIAL_PROFILE_FORM);
        expect(resolveNewProfileFormState(false, editing).selectedSessionId).toBeNull();
    });
});

describe('useNewProfileForm close reset (#471)', () => {
    it('reopen after a filled create shows the session picker, not leftover values', () => {
        type FormApi = ReturnType<typeof useNewProfileForm>;
        const host = document.createElement('div');
        const root = createRoot(host);
        let open = true;
        let api: FormApi | undefined;
        const Probe = () => {
            api = useNewProfileForm({
                open,
                onClose: () => {
                    open = false;
                },
                onCreated: () => undefined,
            });
            return null;
        };
        const render = () => {
            act(() => {
                root.render(createElement(Probe));
            });
        };

        render();
        if (!api) throw new Error('Hook did not render');
        expect(api.mode).toBe('session-list');

        act(() => {
            api?.handleSessionSelect('s1');
        });
        expect(api.mode).toBe('from-session');
        expect(api.form.name).toContain('Ethiopia');

        open = false;
        render();
        open = true;
        render();

        expect(api.mode).toBe('session-list');
        expect(api.form).toEqual(INITIAL_PROFILE_FORM);
        act(() => root.unmount());
    });
});
