// @vitest-environment jsdom

import type { ProfileSource } from '@entities/roast-profile';
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileStartButton } from './ProfileStartButton';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const inventory = vi.hoisted(() => {
    const history: ProfileSource[] = [];
    return { ready: true, history, historyReady: true };
});
vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({ data: [{ id: 'b1', name: 'Single' }], isSuccess: inventory.ready }),
}));
vi.mock('@entities/blend', () => ({
    useBlends: () => ({ data: [{ id: 'x1', name: 'Modern' }], isSuccess: inventory.ready }),
}));
vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }) }));
vi.mock('@entities/roast-profile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@entities/roast-profile')>()),
    useProfileSourceHistory: () => ({ data: inventory.history, isSuccess: inventory.historyReady }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ProfileStartButton', () => {
    let root: Root;
    let host: HTMLDivElement;
    const onNavigate = vi.fn();
    const render = (sources: { bean_id: string | null; blend_id: string | null }[]) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() =>
            root.render(
                createElement(ProfileStartButton, {
                    profile: { id: 'p1', default_bean_id: null, default_blend_id: null, sources },
                    onNavigate,
                }),
            ),
        );
        const button = host.querySelector('button');
        if (!button) throw new Error('Start button missing');
        return button;
    };
    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        inventory.ready = true;
        inventory.history = [];
        inventory.historyReady = true;
        onNavigate.mockClear();
        useRoastingStore.getState().reset();
    });

    it.each([
        { beanId: 'b1', blendId: null, name: 'Single' },
        { beanId: null, blendId: 'x1', name: 'Modern' },
    ])('automatically starts with the sole registered source: $name', (source) => {
        const button = render([{ bean_id: source.beanId, blend_id: source.blendId }]);
        act(() => button.click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileId).toBe('p1');
        expect(useRoastingStore.getState().pendingProfileSource).toEqual(source);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('waits for a choice when several sources are registered, then starts with that source', () => {
        const button = render([
            { bean_id: 'b1', blend_id: null },
            { bean_id: null, blend_id: 'x1' },
        ]);
        act(() => button.click());
        expect(onNavigate).not.toHaveBeenCalled();
        const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
        expect(choices.map((choice) => choice.textContent)).toEqual([
            'SinglenewProfileModal.singleOrigin',
            'ModernnewProfileModal.blend',
        ]);
        act(() => choices[1].click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileSource).toEqual({
            beanId: null,
            blendId: 'x1',
            name: 'Modern',
        });
    });

    it('keeps source-free profiles usable', () => {
        const button = render([]);
        act(() => button.click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileSource).toBeNull();
    });

    it('offers sources found only in previous roasts before navigating', () => {
        inventory.history = [
            { bean_id: 'b1', blend_id: null },
            { bean_id: null, blend_id: 'x1' },
        ];
        const button = render([]);
        act(() => button.click());
        expect(onNavigate).not.toHaveBeenCalled();
        const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
        expect(choices).toHaveLength(2);
        act(() => choices[0].click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileSource).toEqual({
            beanId: 'b1',
            blendId: null,
            name: 'Single',
        });
    });

    it('automatically starts with the sole historical source', () => {
        inventory.history = [{ bean_id: null, blend_id: 'x1' }];
        const button = render([]);
        act(() => button.click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileSource?.blendId).toBe('x1');
    });

    it('waits for history before deciding whether a choice is needed', () => {
        inventory.historyReady = false;
        const button = render([{ bean_id: 'b1', blend_id: null }]);
        expect(button.disabled).toBe(true);
        act(() => button.click());
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('waits for inventory before deciding whether a choice is needed', () => {
        inventory.ready = false;
        const button = render([{ bean_id: 'b1', blend_id: null }]);
        expect(button.disabled).toBe(true);
        act(() => button.click());
        expect(onNavigate).not.toHaveBeenCalled();
    });
});
