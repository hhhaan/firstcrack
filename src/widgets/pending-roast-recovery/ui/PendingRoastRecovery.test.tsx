// @vitest-environment jsdom
import { isPendingRoastSaveActive, resumePendingRoastSave } from '@features/active-roast/lib/resumePendingRoastSave';
import {
    createPendingRoastSave,
    type PendingRoastSave,
    readPendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
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
    ask: vi.fn(async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'invoke')");
    }),
}));
vi.mock('@entities/bean', () => ({ useBeans: () => ({ data: [] }) }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));
vi.mock('@entities/plan', () => ({ useDayBatches: () => ({ data: [] }) }));
vi.mock('@features/upload-roast-profile', () => ({ useUploadRoastProfile: () => ({ mutateAsync: mocks.upload }) }));
vi.mock('@features/active-roast/model/useSaveRoast', () => ({ useSaveRoast: () => ({ resumeSave: mocks.resume }) }));
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
    const result = [...host.querySelectorAll('button')].find((el) => el.textContent === `activeRoast.recovery.${name}`);
    if (!result) throw new Error(`Missing button: ${name}`);
    return result;
};
const discardModal = () => host.querySelector('[data-testid="pending-roast-discard-modal"]');
const confirmDiscard = () => {
    const result = host.querySelector('[data-testid="pending-roast-discard-confirm"]') as HTMLButtonElement | null;
    if (!result) throw new Error('Missing in-app discard confirm');
    return result;
};
const mount = async (item: PendingRoastSave) => {
    writePendingRoastSave(item);
    await act(async () => root.render(<PendingRoastRecovery />));
    await act(async () => button('pending').click());
};

beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
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
            expect(host.querySelector('fieldset')?.disabled).toBe(true);
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
        expect(host.querySelector('fieldset')?.disabled).toBe(false);
        expect(host.textContent).toContain('network offline');
    });

    it('keeps discard blocked while the curve uploads after the row is saved', async () => {
        let release = () => {};
        mocks.find.mockResolvedValue({ id: ID, user_id: 'owner', status: 'completed', plan_batch_id: null });
        mocks.upload.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        await mount(pending({ db: 'saved' }));
        try {
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            expect(button('discard').disabled).toBe(true);
            expect(discardModal()).toBeNull();
        } finally {
            await act(async () => {
                release();
            });
        }
        expect(isPendingRoastSaveActive('owner', ID)).toBe(false);
    });

    it.each([false, true])(
        'keeps submitted=%s after closing the modal and cancelling discard; only confirmed discard clears',
        async (submitted) => {
            await mount(pending({ submitted }));
            expect(mocks.resume).toHaveBeenCalledTimes(submitted ? 1 : 0);
            expect(readPendingRoastSave('owner', ID)?.submitted).toBe(submitted);
            await act(async () => (host.querySelector('[role="presentation"]') as HTMLElement).click());
            expect(host.querySelector('[role="dialog"]')).toBeNull();
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
        await act(async () => root.render(<PendingRoastRecovery />));
        await act(async () => button('pending').click());
        expect(host.querySelectorAll('section').length).toBe(2);
        await act(async () => button('discard').click());
        expect(mocks.ask).not.toHaveBeenCalled();
        expect(discardModal()).toBeTruthy();
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
        expect(readPendingRoastSave('owner', OTHER_ID)).not.toBeNull();
        await act(async () => confirmDiscard().click());
        expect(readPendingRoastSave('owner', ID)).toBeNull();
        expect(readPendingRoastSave('owner', OTHER_ID)).not.toBeNull();
        expect(host.querySelectorAll('section').length).toBe(1);
        expect(button('pending')).toBeDefined();
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
        expect(host.textContent).toContain('activeRoast.recovery.syncPending');
        expect(host.querySelector('fieldset')).toBeNull();
        expect(host.querySelector('select')).toBeNull();
        expect(host.querySelector('input[type="number"]')).toBeNull();
        await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
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
        expect(host.textContent).toContain('upload offline');
    });
});
