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
    return {
        ownerId: 'owner',
        beansPending: false,
        blendsPending: false,
        historyPending: false,
        beans: [{ id: 'b1', name: 'Single' }],
        blends: [{ id: 'x1', name: 'Modern' }],
        history,
    };
});
vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({ data: inventory.beans, isPending: inventory.beansPending }),
}));
vi.mock('@entities/blend', () => ({
    useBlends: () => ({ data: inventory.blends, isPending: inventory.blendsPending }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: inventory.ownerId }),
}));
vi.mock('@entities/roast-profile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@entities/roast-profile')>()),
    useProfileSourceHistory: () => ({ data: inventory.history, isPending: inventory.historyPending }),
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
        inventory.ownerId = 'owner';
        inventory.beansPending = false;
        inventory.blendsPending = false;
        inventory.historyPending = false;
        inventory.beans = [{ id: 'b1', name: 'Single' }];
        inventory.blends = [{ id: 'x1', name: 'Modern' }];
        inventory.history = [];
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
        inventory.historyPending = true;
        const button = render([{ bean_id: 'b1', blend_id: null }]);
        expect(button.disabled).toBe(true);
        act(() => button.click());
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it.each(['beans', 'blends'] as const)('waits for %s before deciding whether a choice is needed', (list) => {
        inventory[list === 'beans' ? 'beansPending' : 'blendsPending'] = true;
        const button = render([{ bean_id: 'b1', blend_id: null }]);
        expect(button.disabled).toBe(true);
        act(() => button.click());
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('starts with the loaded blend when the bean list failed', () => {
        inventory.beans = [];
        const button = render([
            { bean_id: 'b1', blend_id: null },
            { bean_id: null, blend_id: 'x1' },
        ]);
        expect(button.disabled).toBe(false);
        act(() => button.click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileSource).toEqual({
            beanId: null,
            blendId: 'x1',
            name: 'Modern',
        });
    });

    it('starts with no source when a failed list was the only way to name one', () => {
        inventory.beans = [];
        const button = render([{ bean_id: 'b1', blend_id: null }]);
        expect(button.disabled).toBe(false);
        act(() => button.click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileSource).toBeNull();
    });

    it('does not wait when the workspace owner is missing', () => {
        inventory.ownerId = '';
        inventory.beansPending = true;
        inventory.blendsPending = true;
        inventory.historyPending = true;
        inventory.beans = [];
        inventory.blends = [];
        const button = render([{ bean_id: 'b1', blend_id: null }]);
        expect(button.disabled).toBe(false);
        act(() => button.click());
        expect(onNavigate).toHaveBeenCalledWith('roast');
        expect(useRoastingStore.getState().pendingProfileSource).toBeNull();
    });
});
