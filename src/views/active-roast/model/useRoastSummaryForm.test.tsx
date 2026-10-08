// @vitest-environment jsdom

import * as pendingRoastSave from '@features/active-roast/model/pendingRoastSave';
import type { SaveRoastParams } from '@features/active-roast/model/useSaveRoast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoastSummaryForm } from './useRoastSummaryForm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@entities/bean/queries', () => ({ useBeans: () => ({ data: [] }) }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));
vi.mock('@entities/plan', () => ({ useDayBatches: () => ({ data: [] }) }));

const summaryData = {
    totalTime: '10:00',
    development: '20%',
    finalBt: '200',
    logEntries: [],
    sessionId: 'session-color-1',
};

const basePendingParams = (): SaveRoastParams => ({
    formData: {
        notes: '',
        weightGrams: 1,
        roastLevel: null,
        beanId: 'bean-1',
        beanLabel: null,
        deductStock: false,
        colorWhole: '58.4, 58.7, 59.0',
        colorGround: 'WB 58.4 (avg)',
    },
    handoffBeanName: null,
    sessionId: summaryData.sessionId,
    userId: 'owner',
    elapsed: 600,
    roastStartTime: 1,
    rawBT: 200,
    selectedBeanId: 'bean-1',
    targetProfileId: null,
    planBatchHandoff: null,
    logEntries: [],
});

describe('useRoastSummaryForm color checkpoint', () => {
    let host: HTMLDivElement;
    let root: Root;
    let api: ReturnType<typeof useRoastSummaryForm>;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    const flushMicrotasks = async () => {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    };

    const renderHook = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const Probe = () => {
            api = useRoastSummaryForm({
                open: true,
                summaryData,
                selectedBeanId: null,
                planBatchHandoff: null,
            });
            return null;
        };
        await act(async () => {
            root.render(createElement(Probe));
        });
        await flushMicrotasks();
    };

    it('does not clobber stored pending colors on first open after reset', async () => {
        const writeSpy = vi.spyOn(pendingRoastSave, 'writePendingRoastSave');
        pendingRoastSave.writePendingRoastSave(pendingRoastSave.createPendingRoastSave(basePendingParams(), false));

        await renderHook();

        const stored = pendingRoastSave.readPendingRoastSave('owner', summaryData.sessionId);
        expect(stored?.params.formData.colorWhole).toBe('58.4, 58.7, 59.0');
        expect(stored?.params.formData.colorGround).toBe('WB 58.4 (avg)');
        expect(api.form.getValues('colorWhole')).toBe('58.4, 58.7, 59.0');
        expect(api.form.getValues('colorGround')).toBe('WB 58.4 (avg)');
        for (const call of writeSpy.mock.calls) {
            expect(call[0].params.formData.colorWhole).not.toBe(null);
        }
    });

    it('syncs edited colors into the pending checkpoint', async () => {
        pendingRoastSave.writePendingRoastSave(pendingRoastSave.createPendingRoastSave(basePendingParams(), false));
        await renderHook();
        await act(async () => {
            api.form.setValue('colorGround', '58 / 60');
        });
        await flushMicrotasks();
        expect(pendingRoastSave.readPendingRoastSave('owner', summaryData.sessionId)?.params.formData.colorGround).toBe(
            '58 / 60',
        );
    });
});
