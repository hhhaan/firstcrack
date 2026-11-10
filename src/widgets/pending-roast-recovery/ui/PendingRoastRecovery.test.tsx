// @vitest-environment jsdom
import { isPendingRoastSaveActive, resumePendingRoastSave } from '@features/active-roast/lib/resumePendingRoastSave';
import {
    createPendingRoastSave,
    type PendingRoastSave,
    readPendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingRoastRecovery } from './PendingRoastRecovery';

const mocks = vi.hoisted(() => ({
    resume: vi.fn(),
    access: vi.fn(),
    find: vi.fn(),
    upload: vi.fn(),
    save: vi.fn(),
    review: vi.fn(),
    workspaceOwnerId: 'owner',
    workspaceReady: true,
    ask: vi.fn(async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'invoke')");
    }),
}));
vi.mock('@entities/bean', () => ({ useBeans: () => ({ data: [] }) }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: mocks.workspaceOwnerId, isWorkspaceReady: mocks.workspaceReady }),
}));
vi.mock('@entities/plan', () => ({ useDayBatches: () => ({ data: [] }) }));
vi.mock('@features/upload-roast-profile', () => ({ useUploadRoastProfile: () => ({ mutateAsync: mocks.upload }) }));
vi.mock('@features/active-roast/model/useSaveRoast', () => ({ useSaveRoast: () => ({ resumeSave: mocks.resume }) }));
vi.mock('@features/active-roast/model/usePendingRoastCharges', () => ({ usePendingRoastCharges: vi.fn() }));
vi.mock('@features/machine-control/model/usePendingDischargeAudits', () => ({ usePendingDischargeAudits: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: mocks.ask }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let root: Root;
let host: HTMLDivElement;
const pending = (overrides: Partial<PendingRoastSave> = {}): PendingRoastSave => ({
    ...createPendingRoastSave(
        {
            userId: 'owner',
            sessionId: ID,
            roastStartTime: 1234,
            elapsed: 600,
            rawBT: 205,
            selectedBeanId: 'bean',
            targetProfileId: null,
            planBatchHandoff: null,
            handoffBeanName: 'Kenya',
            logEntries: [],
            formData: {
                beanId: 'bean',
                weightGrams: 5,
                outputWeightKg: 4.2,
                roastLevel: 'city',
                notes: 'frozen',
                deductStock: true,
            },
        },
        true,
    ),
    ...overrides,
});
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const button = (name: string) => {
    const names = name === 'retry' ? ['retry', 'saveAction', 'syncAction'] : [name];
    const result = [...document.querySelectorAll('button')].find((el) =>
        names.some((key) => el.textContent === `activeRoast.recovery.${key}`),
    );
    if (!result) throw new Error(`Missing button: ${name}`);
    return result;
};
const discardModal = () => document.querySelector('[data-testid="pending-roast-discard-modal"]');
const confirmDiscard = () => {
    const result = document.querySelector('[data-testid="pending-roast-discard-confirm"]') as HTMLButtonElement | null;
    if (!result) throw new Error('Missing in-app discard confirm');
    return result;
};
const mount = async (item: PendingRoastSave) => {
    writePendingRoastSave(item);
    await act(async () => root.render(<PendingRoastRecovery onReview={mocks.review} />));
    await act(async () => {
        button('pending').focus();
        button('pending').click();
    });
};

beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    useRoastingStore.setState(useRoastingStore.getInitialState(), true);
    mocks.workspaceOwnerId = 'owner';
    mocks.workspaceReady = true;
    mocks.find.mockRejectedValue(new Error('network offline'));
    mocks.resume.mockImplementation((item: PendingRoastSave) =>
        resumePendingRoastSave({
            pending: item,
            ownerId: 'owner',
            ensureAccess: mocks.access,
            findSession: mocks.find,
            resolveForRoast: vi.fn(),
            saveRoast: mocks.save,
            syncBatch: vi.fn(),
            refreshCaches: vi.fn(),
            syncRoastCurve: mocks.upload,
        }),
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
});

describe('PendingRoastRecovery safety', () => {
    it('disables edits, retry and discard while automatic recovery is active', async () => {
        let release = () => {};
        mocks.access.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        await mount(pending());
        try {
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            expect(document.querySelector('fieldset')?.disabled).toBe(true);
            expect(button('retry').disabled).toBe(true);
            expect(button('discard').disabled).toBe(true);
            await act(async () => {
                button('retry').click();
                button('discard').click();
            });
            expect(mocks.resume).toHaveBeenCalledTimes(1);
            expect(discardModal()).toBeNull();
            expect(readPendingRoastSave('owner', ID)).not.toBeNull();
        } finally {
            await act(async () => {
                release();
            });
        }
        expect(isPendingRoastSaveActive('owner', ID)).toBe(false);
        expect(button('retry').disabled).toBe(false);
        expect(button('discard').disabled).toBe(false);
        expect(document.querySelector('fieldset')?.disabled).toBe(false);
        expect(document.body.textContent).toContain('network offline');
    });

    it.each([false, true])(
        'keeps submitted=%s after closing the modal and cancelling discard; only confirmed discard clears',
        async (submitted) => {
            await mount(pending({ submitted }));
            expect(mocks.resume).toHaveBeenCalledTimes(submitted ? 1 : 0);
            expect(readPendingRoastSave('owner', ID)?.submitted).toBe(submitted);
            await act(async () => (document.querySelector('[role="presentation"]') as HTMLElement).click());
            expect(document.querySelector('[role="dialog"]')).toBeNull();
            expect(readPendingRoastSave('owner', ID)).not.toBeNull();
            await act(async () => button('pending').click());
            await act(async () => button('discard').click());
            expect(discardModal()?.textContent).toContain('activeRoast.recovery.discardConfirm');
            expect(readPendingRoastSave('owner', ID)).not.toBeNull();
            const cancel = [...(discardModal()?.querySelectorAll('button') ?? [])].find(
                (el) => el.textContent === 'common.cancel',
            );
            if (!cancel) throw new Error('Missing in-app discard cancel');
            await act(async () => cancel.click());
            expect(discardModal()).toBeNull();
            expect(readPendingRoastSave('owner', ID)).not.toBeNull();
            expect(button('pending')).toBeDefined();
            await act(async () => button('discard').click());
            await act(async () => confirmDiscard().click());
            expect(readPendingRoastSave('owner', ID)).toBeNull();
            expect(host.textContent).toBe('');
        },
    );

    it('shows an in-app confirm and clears the pending roast when Tauri dialog invoke is missing', async () => {
        writePendingRoastSave(pending({ submitted: false }));
        writePendingRoastSave(
            pending({
                submitted: false,
                params: { ...pending().params, sessionId: OTHER_ID, handoffBeanName: 'Ethiopia' },
            }),
        );
        await act(async () => root.render(<PendingRoastRecovery onReview={mocks.review} />));
        await act(async () => button('pending').click());
        expect(document.querySelectorAll('section').length).toBe(2);
        await act(async () => button('discard').click());
        expect(mocks.ask).not.toHaveBeenCalled();
        expect(discardModal()).toBeTruthy();
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
        expect(readPendingRoastSave('owner', OTHER_ID)).not.toBeNull();
        await act(async () => confirmDiscard().click());
        expect(readPendingRoastSave('owner', ID)).toBeNull();
        expect(readPendingRoastSave('owner', OTHER_ID)).not.toBeNull();
        expect(document.querySelectorAll('section').length).toBe(1);
        expect(button('pending')).toBeDefined();
    });

    it('Escape and the confirm overlay cancel discard and leave the recovery list open', async () => {
        await mount(pending({ submitted: false }));
        const pressEscape = (target: EventTarget = document) => {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        };
        await act(async () => button('discard').click());
        expect(discardModal()).toBeTruthy();
        await act(async () => pressEscape());
        expect(discardModal()).toBeNull();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
        expect(button('pending')).toBeDefined();

        await act(async () => button('discard').click());
        confirmDiscard().focus();
        await act(async () => pressEscape(confirmDiscard()));
        expect(discardModal()).toBeNull();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();

        await act(async () => button('discard').click());
        const overlays = document.querySelectorAll('[role="presentation"]');
        await act(async () => (overlays[overlays.length - 1] as HTMLElement).click());
        expect(discardModal()).toBeNull();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
        expect(button('discard')).toBeDefined();
    });

    it('does not discard if recovery starts while the confirmation dialog is open', async () => {
        let release = () => {};
        mocks.access.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        const item = pending({ submitted: false });
        await mount(item);
        await act(async () => button('discard').click());
        expect(discardModal()).toBeTruthy();
        await act(async () => writePendingRoastSave({ ...item, submitted: true }));
        try {
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            await act(async () => confirmDiscard().click());
            expect(readPendingRoastSave('owner', ID)).not.toBeNull();
            expect(discardModal()).toBeNull();
        } finally {
            await act(async () => release());
        }
    });

    it('hides payload editors for a saved roast and preserves its payload when retrying synchronization', async () => {
        const item = pending({ db: 'saved', needsAttention: true, legacyBbpUnknown: true, bbp: 'pending' });
        mocks.find.mockResolvedValue({ id: ID, user_id: 'owner', status: 'completed', plan_batch_id: null });
        mocks.upload.mockRejectedValue(new Error('upload offline'));
        await mount(item);
        expect(document.body.textContent).toContain('activeRoast.recovery.syncStatus');
        expect(document.querySelector('fieldset')).toBeNull();
        expect(document.querySelector('[role="combobox"]')).toBeNull();
        expect(document.querySelector('input[type="number"]')).toBeNull();
        await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
        await act(async () => button('retry').click());
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.upload).toHaveBeenCalledWith({
            sessionId: ID,
            roastSessionId: ID,
            ownerId: 'owner',
            profileRequired: true,
            bbpRequired: false,
        });
        expect(readPendingRoastSave('owner', ID)?.params).toEqual(item.params);
        expect(readPendingRoastSave('owner', ID)?.db).toBe('saved');
        expect(document.body.textContent).toContain('upload offline');
    });
});

describe('Unified roast recovery', () => {
    const capture = (ownerId = 'owner', sessionId = ID) => {
        useRoastingStore.getState().captureSummary(
            {
                sessionId,
                batchName: 'Completed Kenya',
                totalTime: '10:00',
                development: '20%',
                finalBt: '205',
                logEntries: [],
            },
            ownerId,
            205,
        );
    };

    it('deduplicates the current checkpoint and opens its full summary without saving or discarding', async () => {
        capture();
        const completed = useRoastingStore.getState().completed;
        await mount(pending({ submitted: false }));
        expect(document.querySelectorAll('section')).toHaveLength(1);
        expect(document.querySelector('[data-testid="pending-roast-current"]')).not.toBeNull();
        expect(document.body.textContent).toContain('Completed Kenya');
        expect(document.querySelector('fieldset')).toBeNull();
        await act(async () => button('review').click());
        expect(mocks.review).toHaveBeenCalledWith('owner', ID);
        expect(mocks.resume).not.toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(readPendingRoastSave('owner', ID)?.submitted).toBe(false);
        expect(useRoastingStore.getState().completed).toBe(completed);
    });

    it('keeps a memory-only summary reachable when no checkpoint could be written', async () => {
        capture();
        await act(async () => root.render(<PendingRoastRecovery onReview={mocks.review} />));
        await act(async () => button('pending').click());
        expect(document.querySelectorAll('section')).toHaveLength(1);
        await act(async () => button('review').click());
        expect(mocks.review).toHaveBeenCalledWith('owner', ID);
        expect(readPendingRoastSave('owner', ID)).toBeNull();
        expect(useRoastingStore.getState().completed?.summary).not.toBeNull();
    });

    it('keeps an explicitly unlinked current checkpoint correctable across a transient retry failure', async () => {
        capture();
        const item = pending({ submitted: true, needsAttention: true, error: 'This batch is complete' });
        item.params.planBatchHandoff = {
            planBatchId: 'completed-batch',
            planId: 'plan',
            beanId: 'bean',
            blendId: null,
            beanName: 'Kenya',
            batchSizeKg: 5,
            profileId: null,
            batchCount: 1,
            completedSessions: 1,
        };
        item.batch = 'pending';
        mocks.find.mockResolvedValue(null);
        mocks.save.mockRejectedValueOnce(new Error('network offline')).mockResolvedValue({
            savedSession: { id: ID, user_id: 'owner', status: 'completed', plan_batch_id: null },
        });
        await mount(item);
        expect(document.querySelectorAll('section')).toHaveLength(1);
        expect(button('review')).toBeDefined();
        expect(document.querySelector('details')?.open).toBe(false);
        expect(
            [...document.querySelectorAll('button')].some((el) => el.textContent === 'activeRoast.recovery.discard'),
        ).toBe(false);
        Element.prototype.scrollIntoView = () => {};
        const selects = document.querySelectorAll('[role="combobox"]');
        await act(async () => selects[selects.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        const unlink = document.querySelector('[role="option"][data-value=""]');
        expect(unlink).not.toBeNull();
        await act(async () => {
            unlink?.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' }),
            );
            unlink?.dispatchEvent(
                new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' }),
            );
        });
        await act(async () => button('retry').click());
        expect(readPendingRoastSave('owner', ID)).toMatchObject({
            submitted: true,
            needsAttention: false,
            params: { planBatchHandoff: null, formData: { linkedBatch: null, linkedBatchId: null } },
        });
        expect(document.querySelector('fieldset')).not.toBeNull();
        expect(document.body.textContent).toContain('network offline');
        await act(async () => button('retry').click());
        expect(mocks.save).toHaveBeenCalledTimes(2);
        expect(mocks.save).toHaveBeenCalledWith(
            expect.objectContaining({
                planBatchHandoff: null,
                formData: expect.objectContaining({ linkedBatch: null, linkedBatchId: null }),
            }),
        );
        expect(readPendingRoastSave('owner', ID)).toBeNull();
        expect(useRoastingStore.getState().completed?.summary).toBeNull();
    });

    it('shows historical saves collapsed and closes the list with Escape without removing data', async () => {
        await mount(pending({ submitted: false }));
        expect(document.querySelector('details')?.open).toBe(false);
        expect(document.body.textContent).toContain('activeRoast.recovery.savePending');
        expect(document.body.textContent).not.toContain('activeRoast.recovery.failed');
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
    });

    it('scopes memory summaries and stored checkpoints to the ready workspace', async () => {
        capture('other-owner');
        writePendingRoastSave(pending({ submitted: false, params: { ...pending().params, userId: 'other-owner' } }));
        await act(async () => root.render(<PendingRoastRecovery onReview={mocks.review} />));
        expect(host.textContent).toBe('');
        mocks.workspaceOwnerId = 'other-owner';
        mocks.workspaceReady = false;
        await act(async () => root.render(<PendingRoastRecovery onReview={mocks.review} />));
        expect(host.textContent).toBe('');
        expect(mocks.resume).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'clears the matching memory summary after auto recovery (syncPending=%s)',
        async (syncPending) => {
            capture();
            mocks.find.mockResolvedValue({
                id: ID,
                user_id: 'owner',
                status: 'completed',
                plan_batch_id: null,
                batch_name: 'Server title',
            });
            if (syncPending) mocks.upload.mockRejectedValue(new Error('upload offline'));
            writePendingRoastSave(pending());
            await act(async () => root.render(<PendingRoastRecovery onReview={mocks.review} />));
            expect(useRoastingStore.getState().completed?.summary).toBeNull();
            expect(useRoastingStore.getState().completed?.snapshot.selection.identity?.title).toBe('Server title');
            expect(document.querySelector('[data-testid="pending-roast-current"]')).toBeNull();
            if (syncPending) {
                expect(readPendingRoastSave('owner', ID)?.db).toBe('saved');
                await act(async () => button('pending').click());
                expect(document.body.textContent).toContain('activeRoast.recovery.syncStatus');
                expect(document.querySelector('fieldset')).toBeNull();
            } else {
                expect(readPendingRoastSave('owner', ID)).toBeNull();
                expect(host.textContent).toBe('');
            }
        },
    );
});

describe('Recovery modal keyboard and intent', () => {
    const press = (element: Element | Window, key: string, shiftKey = false) =>
        element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    const listClose = () => document.querySelector<HTMLButtonElement>('[data-testid="pending-roast-close"]');

    it('focuses the list, wraps Tab in both directions and restores its trigger on close', async () => {
        await mount(pending({ submitted: false }));
        expect(document.activeElement).toBe(listClose());
        expect(host.inert).toBe(true);
        const footerClose = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            (el) => el.textContent === 'common.close',
        );
        expect(footerClose).toBeDefined();
        await act(async () => {
            footerClose?.focus();
            if (footerClose) press(footerClose, 'Tab');
        });
        expect(document.activeElement).toBe(listClose());
        await act(async () => {
            const close = listClose();
            if (close) press(close, 'Tab', true);
        });
        expect(document.activeElement).toBe(footerClose);
        await act(async () => press(window, 'Escape'));
        expect(host.inert).toBe(false);
        expect(document.activeElement).toBe(button('pending'));
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
    });

    it('focuses Cancel in a nested discard dialog and restores the original discard action', async () => {
        await mount(pending({ submitted: false }));
        const discard = button('discard');
        await act(async () => {
            discard.focus();
            discard.click();
        });
        const cancel = [...(discardModal()?.querySelectorAll('button') ?? [])].find(
            (el) => el.textContent === 'common.cancel',
        );
        if (!cancel) throw new Error('Missing discard cancel');
        expect(document.activeElement).toBe(cancel);
        await act(async () => {
            confirmDiscard().focus();
            press(confirmDiscard(), 'Tab');
        });
        expect(document.activeElement).toBe(cancel);
        await act(async () => press(cancel, 'Escape'));
        expect(discardModal()).toBeNull();
        expect(document.activeElement).toBe(discard);
        expect(host.inert).toBe(true);
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
    });

    it('releases background inertness when confirming the final item', async () => {
        await mount(pending({ submitted: false }));
        await act(async () => button('discard').click());
        await act(async () => confirmDiscard().click());
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(host.inert).toBe(false);
    });

    it.each(['unmount', 'workspace'])('releases both focus scopes when %s removes nested dialogs', async (reason) => {
        await mount(pending({ submitted: false }));
        await act(async () => button('discard').click());
        expect(host.inert).toBe(true);
        if (reason === 'workspace') mocks.workspaceReady = false;
        await act(async () =>
            root.render(reason === 'unmount' ? null : <PendingRoastRecovery onReview={mocks.review} />),
        );
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(host.inert).toBe(false);
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
        if (reason === 'workspace') {
            mocks.workspaceReady = true;
            await act(async () => root.render(<PendingRoastRecovery onReview={mocks.review} />));
            expect(document.querySelector('[role="dialog"]')).toBeNull();
            expect(host.inert).toBe(false);
            await act(async () => button('pending').click());
            expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
            expect(listClose()?.closest('[inert]')).toBeNull();
        }
    });

    it('leaves the recovery dialog open when a Radix selection consumes Escape', async () => {
        await mount(pending({ submitted: false }));
        const details = document.querySelector('details');
        if (details) details.open = true;
        Element.prototype.scrollIntoView = () => {};
        await act(async () => document.querySelector<HTMLElement>('[role="combobox"]')?.click());
        expect(document.querySelector('[role="listbox"]')).not.toBeNull();
        const listbox = document.querySelector('[role="listbox"]');
        if (!listbox) throw new Error('Missing open dropdown');
        await act(async () => press(listbox, 'Escape'));
        expect(document.querySelector('[role="listbox"]')).toBeNull();
        expect(document.querySelector('[aria-labelledby="pending-roasts-title"]')).not.toBeNull();
        expect(host.inert).toBe(true);
    });

    it('uses different save and sync actions, with recovery guidance beside errors', async () => {
        await mount(pending({ submitted: false, error: 'network offline' }));
        expect(button('saveAction')).toBeDefined();
        expect(document.body.textContent).toContain('activeRoast.recovery.retryHelp');
        expect(document.body.textContent).toContain('activeRoast.recovery.errorDetails');
        await act(async () =>
            writePendingRoastSave(pending({ db: 'saved', submitted: false, error: 'upload offline' })),
        );
        expect(button('syncAction')).toBeDefined();
        expect(document.body.textContent).toContain('activeRoast.recovery.syncHelp');
        expect(document.querySelector('fieldset')).toBeNull();
        await act(async () => button('discard').click());
        expect(discardModal()?.textContent).toContain('activeRoast.recovery.discardSavedConfirm');
    });

    it('restores background interaction when the final open item finishes automatic recovery', async () => {
        const item = pending({ submitted: false });
        await mount(item);
        expect(host.inert).toBe(true);
        mocks.find.mockResolvedValue({ id: ID, user_id: 'owner', status: 'completed', plan_batch_id: null });
        await act(async () => writePendingRoastSave({ ...item, submitted: true }));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(host.inert).toBe(false);
        expect(readPendingRoastSave('owner', ID)).toBeNull();
    });
});
