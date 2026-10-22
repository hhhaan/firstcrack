// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SummaryMetaEditor } from './SummaryMetaEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
    updateBean,
    updateSession,
    setOutputWeight,
    invalidate,
    queryClient,
    patchOrigin,
    restoreCaches,
    stockRecorded,
} = vi.hoisted(() => ({
    updateBean: vi.fn(async () => ({ id: 'bean-1' })),
    updateSession: vi.fn(async () => ({ id: 's1' })),
    setOutputWeight: vi.fn(async () => undefined),
    invalidate: vi.fn(async () => undefined),
    queryClient: { cancelQueries: vi.fn(async () => undefined) },
    patchOrigin: vi.fn(),
    restoreCaches: vi.fn(),
    stockRecorded: { value: false },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => queryClient }));
vi.mock('../hooks/useRoastStockRecorded', () => ({
    useRoastStockRecorded: () => ({ data: stockRecorded.value, isPending: false }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));
vi.mock('@entities/bean', () => ({
    useBeans: () => ({
        data: [
            { id: 'bean-1', name: 'Aricha' },
            { id: 'bean-2', name: 'Kenya Nyeri' },
        ],
    }),
    useUpdateBean: () => ({ mutateAsync: updateBean, isPending: false }),
}));
vi.mock('@shared/store/auth', () => ({
    useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'owner' } }),
}));
vi.mock('@shared/store/catalog-visibility', () => ({
    useCatalogVisibility: () => ({ hidden: new Set<string>(), setHidden: vi.fn() }),
}));
vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({ data: [{ id: 'p1', name: 'Washed' }] }),
}));
vi.mock('@entities/roast', () => ({
    invalidateRoastSessionQueries: invalidate,
    roastSessionKeys: { all: (userId: string) => ['roast_sessions', userId] },
    snapshotRoastSessionCaches: () => [],
    restoreRoastSessionCaches: restoreCaches,
    applyOptimisticSessionBeanOrigin: patchOrigin,
    useUpdateRoastSession: () => ({ mutateAsync: updateSession, isPending: false }),
    useSetOutputWeight: () => ({ mutateAsync: setOutputWeight, isPending: false }),
}));

const session = {
    id: 's1',
    bean_id: 'bean-1',
    profile_id: null,
    roast_level: null,
    weight_grams: 1000,
    output_weight_grams: null,
    beans: { name: 'Aricha', origin: 'Ethiopia', region: null, variety: null, process: null, farm: null },
    roast_profiles: null,
} as RoastSessionWithRelations;

describe('SummaryMetaEditor', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        stockRecorded.value = false;
        updateBean.mockClear();
        updateSession.mockClear();
        setOutputWeight.mockClear();
        invalidate.mockClear();
        patchOrigin.mockClear();
        restoreCaches.mockClear();
    });

    const render = async (value: RoastSessionWithRelations = session) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(createElement(SummaryMetaEditor, { session: value }));
        });
    };

    const setControl = async (testId: string, value: string) => {
        const el = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | HTMLSelectElement;
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const setValue = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        await act(async () => {
            setValue?.call(el, value);
            el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
        });
        return el;
    };

    const beanInput = () => host.querySelector('[data-testid="history-bean"] input') as HTMLInputElement;

    const pickBean = async (name: string) => {
        await act(async () => {
            beanInput().focus();
        });
        const option = [...host.querySelectorAll('[role="option"]')].find((el) => el.textContent === name);
        expect(option).not.toBeUndefined();
        await act(async () => {
            option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
    };

    /** Type into the bean combobox and commit it the way blur does (120ms close guard). */
    const typeBean = async (value: string) => {
        const input = beanInput();
        await act(async () => {
            input.focus();
        });
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            input.blur();
            await new Promise((resolve) => setTimeout(resolve, 150));
        });
    };

    it('writes the bean origin and refreshes sessions that join it', async () => {
        await render();
        const input = host.querySelector('[data-testid="history-origin"]') as HTMLInputElement;
        await act(async () => {
            input.focus();
        });
        await setControl('history-origin', 'Kenya');
        await act(async () => {
            input.blur();
        });
        expect(patchOrigin).toHaveBeenCalledWith(queryClient, 'owner', 'bean-1', 'Kenya');
        expect(updateBean).toHaveBeenCalledWith({ id: 'bean-1', origin: 'Kenya' });
        expect(patchOrigin.mock.invocationCallOrder[0]).toBeLessThan(updateBean.mock.invocationCallOrder[0]);
        expect(invalidate).toHaveBeenCalledWith(expect.anything(), 'owner');
        expect(restoreCaches).not.toHaveBeenCalled();
    });

    it('restores the session caches when the origin save fails', async () => {
        updateBean.mockRejectedValueOnce(new Error('nope'));
        await render();
        const input = host.querySelector('[data-testid="history-origin"]') as HTMLInputElement;
        await act(async () => {
            input.focus();
        });
        await setControl('history-origin', 'Kenya');
        await act(async () => {
            input.blur();
        });
        expect(restoreCaches).toHaveBeenCalledWith(queryClient, []);
        expect(input.value).toBe('Ethiopia');
    });

    it('shows the saved profile without an editable control', async () => {
        await render({
            ...session,
            profile_id: 'p1',
            roast_profiles: { name: 'Profile A', target_level: 'Medium' },
            profile_batch_number: 9,
            total_batch_number: 13,
        });
        const profile = host.querySelector('[data-testid="history-profile"]');
        expect(profile?.textContent).toBe('Profile A');
        expect(profile?.tagName).toBe('P');
        expect(updateSession).not.toHaveBeenCalled();
    });

    it('relinks the roast to another green bean and drops the free-text label', async () => {
        await render({ ...session, bean_id: null, beans: null, bean_label: 'Sample bag', batch_name: 'Batch C' });
        await pickBean('Kenya Nyeri');
        expect(updateSession).toHaveBeenCalledWith({ id: 's1', bean_id: 'bean-2', bean_label: null });
    });

    it('freezes the bean-derived title before relinking, so the title stops following the bean', async () => {
        await render({ ...session, batch_name: null });
        await pickBean('Kenya Nyeri');
        expect(updateSession).toHaveBeenCalledWith({
            id: 's1',
            bean_id: 'bean-2',
            bean_label: null,
            batch_name: 'Aricha',
        });
    });

    it('keeps a stored title when the green bean changes', async () => {
        await render({ ...session, batch_name: 'Batch C' });
        await pickBean('Kenya Nyeri');
        expect(updateSession).toHaveBeenCalledWith({ id: 's1', bean_id: 'bean-2', bean_label: null });
    });

    it('keeps a typed custom name as the bean label with no inventory link, freezing the old title', async () => {
        await render();
        await typeBean('Sample bag');
        expect(updateSession).toHaveBeenCalledWith({
            id: 's1',
            bean_id: null,
            bean_label: 'Sample bag',
            batch_name: 'Aricha',
        });
    });

    it('clears the green bean and the label when the text is emptied', async () => {
        await render();
        await typeBean('');
        expect(updateSession).toHaveBeenCalledWith({
            id: 's1',
            bean_id: null,
            bean_label: null,
            batch_name: 'Aricha',
        });
    });

    it('blocks every bean edit once stock has been recorded for the roast', async () => {
        stockRecorded.value = true;
        await render();
        expect(beanInput().disabled).toBe(true);
        expect(host.textContent).toContain('history.expanded.beanLocked');
        await typeBean('Sample bag');
        expect(updateSession).not.toHaveBeenCalled();
    });

    it('can link a green bean to a roast saved without one', async () => {
        await render({ ...session, bean_id: null, beans: null });
        await pickBean('Kenya Nyeri');
        expect(updateSession).toHaveBeenCalledWith({ id: 's1', bean_id: 'bean-2', bean_label: null });
    });

    it('shows a saved free-text label in the bean field', async () => {
        await render({ ...session, bean_id: null, beans: null, bean_label: 'Sample bag' });
        expect(beanInput().value).toBe('Sample bag');
    });

    it('saves roast level and refreshes the unmeasured inbound estimate', async () => {
        await render();
        await setControl('history-level', 'Dark');
        expect(updateSession).toHaveBeenCalledWith({ id: 's1', roast_level: 'Dark' });
        expect(setOutputWeight).toHaveBeenCalledWith({
            sessionId: 's1',
            outputGrams: null,
            inboundGrams: 820,
            inboundIsEstimate: true,
        });
    });

    it('does not rewrite measured output when only the level changes', async () => {
        await render({ ...session, output_weight_grams: 850, roast_level: 'Medium' });
        await setControl('history-level', 'Dark');
        expect(updateSession).toHaveBeenCalledWith({ id: 's1', roast_level: 'Dark' });
        expect(setOutputWeight).not.toHaveBeenCalled();
    });

    it('leaves origin read-only when the roast has no bean', async () => {
        await render({ ...session, bean_id: null, beans: null });
        expect(host.querySelector('[data-testid="history-origin"]')).toBeNull();
    });
});
