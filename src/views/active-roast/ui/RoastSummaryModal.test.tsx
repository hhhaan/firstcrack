// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RoastSummaryModal } from './RoastSummaryModal';

vi.mock('@entities/blend', () => ({ useBlends: () => ({ data: [{ id: 'blend-1', name: 'Modern' }] }) }));
vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({ batchCounters: { total: 12 } }),
}));

vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({
        data: [{ id: 'bean-1', name: 'Yirg', origin: 'ET', region: null, farm: null, variety: null, process: null }],
    }),
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1', isWorkspaceReady: true }),
}));

const planMock = vi.hoisted(() => ({
    batches: [] as Array<Record<string, unknown>>,
}));

vi.mock('@entities/plan', () => ({
    useDayBatches: () => ({ data: planMock.batches }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    ask: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summaryData = {
    totalTime: '10:00',
    development: '2:00',
    finalBt: '205°C',
    logEntries: [],
};

const handoff: PlanBatchHandoff = {
    planBatchId: 'batch-1',
    planId: 'plan-1',
    beanId: 'bean-1',
    blendId: null,
    beanName: 'Yirg',
    batchCount: 2,
    completedSessions: 1,
    batchSizeKg: 5,
    profileId: null,
};

const baseProps = {
    open: true,
    summaryData,
    onClose: () => {},
    onDiscard: () => {},
    onCancelDrop: () => {},
    canCancelDrop: false,
    onSave: async () => {},
};

afterEach(() => {
    planMock.batches = [];
    useRoastingStore.getState().reset();
    useBbpStore.setState({ active: false, recording: false, startMs: 0, points: [] });
});

const renderModal = (props: Partial<Parameters<typeof RoastSummaryModal>[0]> = {}) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(RoastSummaryModal, { ...baseProps, ...props })));
    return {
        host,
        unmount: () => {
            act(() => root.unmount());
            host.remove();
        },
    };
};

it('keeps live BBP time visible and ticking inside the summary while saving', () => {
    vi.useFakeTimers();
    useBbpStore.setState({ active: true, recording: true, startMs: Date.now() - 15_000, points: [] });
    const { unmount } = renderModal({ bbpEnabled: true, isSaving: true, ambientTemp: 13, ambientHumidity: 60 });
    try {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.querySelector('[data-testid="roast-summary-bbp"]')?.textContent).toContain('0:15');
        act(() => vi.advanceTimersByTime(2_000));
        expect(dialog?.querySelector('[data-testid="roast-summary-bbp"]')?.textContent).toContain('0:17');
        expect(dialog?.textContent).toContain('activeRoast.summary.temperature 13°C');
    } finally {
        unmount();
        vi.useRealTimers();
    }
});

it('hides the live BBP readout when BBP is disabled', () => {
    useBbpStore.setState({ active: true, recording: true, startMs: Date.now() - 15_000, points: [] });
    const { unmount } = renderModal({ bbpEnabled: false });
    expect(document.querySelector('[data-testid="roast-summary-bbp"]')).toBeNull();
    unmount();
});

it('keeps the overlay from passing clicks through to the roast screen', () => {
    const { unmount } = renderModal();
    const overlay = document.querySelector('[role="presentation"]');
    expect(overlay?.className).not.toContain('pointer-events-none');
    unmount();
});

it('shows stored TP in the summary log', () => {
    const { unmount } = renderModal({
        summaryData: {
            ...summaryData,
            logEntries: [
                { id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '200°C', tempC: 200, note: '' },
                { id: '2', time: '1:00', timeSec: 60, event: 'TP', temp: '90°C', tempC: 90, note: '' },
            ],
        },
    });
    expect(document.body.textContent).toContain('Charge');
    expect(document.body.textContent).toContain('TP');
    unmount();
});

it('checks deductStock when schedule handoff is present', () => {
    const { unmount } = renderModal({ planBatchHandoff: handoff });
    const checkbox = document.querySelector('[data-testid="roast-summary-deduct"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    unmount();
});

it('checks deductStock when selectedBeanId is set without handoff', () => {
    useRoastingStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: null });
    const { unmount } = renderModal({ selectedBeanId: 'bean-1' });
    const checkbox = document.querySelector('[data-testid="roast-summary-deduct"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    unmount();
});

it('keeps the opened bean and weight when a later batch selection arrives', () => {
    useRoastingStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: null });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = { ...baseProps, selectedBeanId: 'bean-1' as string | null };
    act(() => root.render(createElement(RoastSummaryModal, props)));
    act(() => {
        root.render(createElement(RoastSummaryModal, { ...props, selectedBeanId: 'bean-2' }));
    });
    const weight = document.querySelector('[data-testid="roast-summary-weight"]') as HTMLInputElement;
    const bean = document.querySelector('[data-testid="roast-summary-bean"] input') as HTMLInputElement;
    expect(weight.value).toBe('5');
    expect(bean.value).toBe('Yirg');
    act(() => root.unmount());
    host.remove();
});

const setInputValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
};

it('prefills the roast title and submits an edit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderModal({
        onSave,
        summaryData: { ...summaryData, batchName: 'Morning roast' },
        fallbackBeanName: 'Yirg',
    });
    const title = document.querySelector('[data-testid="roast-summary-title"]') as HTMLInputElement;
    expect(title.value).toBe('Morning roast');
    expect(title.maxLength).toBe(120);
    expect(title.placeholder).toBe('Yirg');
    act(() => setInputValue(title, 'Renamed roast'));
    const save = document.querySelector('[data-testid="roast-summary-save"]') as HTMLButtonElement;
    await act(async () => {
        save.click();
    });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ batchName: 'Renamed roast' }));
    unmount();
});

it('shows the next batch number without adding it to the submitted title', async () => {
    const numbering = getRoastSettings().batchTitleNumbering;
    updateRoastSettings({ batchTitleNumbering: 'total' });
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderModal({ onSave, summaryData: { ...summaryData, batchName: 'Morning roast' } });
    try {
        expect(document.querySelector('[data-testid="roast-summary-batch-numbers"]')?.textContent).toBe('Σ#13');
        const save = document.querySelector<HTMLButtonElement>('[data-testid="roast-summary-save"]');
        await act(async () => save?.click());
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ batchName: 'Morning roast' }));
    } finally {
        unmount();
        updateRoastSettings({ batchTitleNumbering: numbering });
    }
});

it('applies a schedule batch, keeps a same-batch edit, and restores the opened weight on clear', () => {
    useRoastingStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: null });
    planMock.batches = [
        {
            id: 'batch-9',
            bean_id: 'bean-1',
            bean_name: 'Yirg',
            batch_size_kg: 8,
            batch_count: 2,
            completed_sessions: 0,
            blend_id: null,
        },
    ];
    const { unmount } = renderModal({ selectedBeanId: 'bean-1' });
    const weight = () => document.querySelector('[data-testid="roast-summary-weight"]') as HTMLInputElement;
    expect(weight().value).toBe('5');
    act(() => setInputValue(weight(), '6'));

    const schedule = [...document.querySelectorAll('button')].find(
        (b) => b.textContent === 'activeRoast.summary.linkSchedule',
    );
    act(() => schedule?.click());
    const select = document.querySelector('select') as HTMLSelectElement;
    act(() => setInputValue(select, 'batch-9'));
    expect(weight().value).toBe('8');

    act(() => setInputValue(weight(), '7'));
    act(() => setInputValue(select, 'batch-9'));
    expect(weight().value).toBe('7');

    const none = [...document.querySelectorAll('button')].find((b) => b.textContent === 'activeRoast.summary.linkNone');
    act(() => none?.click());
    expect(weight().value).toBe('5');
    unmount();
});

it('reopens from the opened batch after an edit', () => {
    useRoastingStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: null });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = { ...baseProps, selectedBeanId: 'bean-1' as string | null };
    act(() => root.render(createElement(RoastSummaryModal, props)));
    const weight = () => document.querySelector('[data-testid="roast-summary-weight"]') as HTMLInputElement;
    act(() => setInputValue(weight(), '9'));
    act(() => root.render(createElement(RoastSummaryModal, { ...props, open: false })));
    act(() => root.render(createElement(RoastSummaryModal, props)));
    expect(weight().value).toBe('5');
    const bean = document.querySelector('[data-testid="roast-summary-bean"] input') as HTMLInputElement;
    expect(bean.value).toBe('Yirg');
    act(() => root.unmount());
    host.remove();
});

it('calls onClose from the header X without discarding', () => {
    const onClose = vi.fn();
    const onDiscard = vi.fn();
    const { unmount } = renderModal({ onClose, onDiscard });
    const close = document.querySelector('[data-testid="roast-summary-close"]') as HTMLButtonElement;
    expect(close).not.toBeNull();
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    unmount();
});

it('cancels Drop from the header X while the roast can be restored', () => {
    const onClose = vi.fn();
    const onCancelDrop = vi.fn();
    const { unmount } = renderModal({ canCancelDrop: true, onClose, onCancelDrop });
    const close = document.querySelector('[data-testid="roast-summary-close"]') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toBe('activeRoast.unsaved.cancelDrop');
    act(() => close.click());
    expect(onCancelDrop).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
});

it('cancels Drop from the summary only while it can be restored', () => {
    const onCancelDrop = vi.fn();
    const { unmount } = renderModal({ canCancelDrop: true, onCancelDrop });
    const cancel = document.querySelector('[data-testid="roast-summary-cancel-drop"]') as HTMLButtonElement;
    expect(cancel.textContent).toBe('activeRoast.unsaved.cancelDrop');
    act(() => cancel.click());
    expect(onCancelDrop).toHaveBeenCalledTimes(1);
    unmount();

    const unavailable = renderModal({ canCancelDrop: false, onCancelDrop });
    expect(document.querySelector('[data-testid="roast-summary-cancel-drop"]')).toBeNull();
    unavailable.unmount();
});

it('unchecks deductStock when a custom bean name is typed', () => {
    useRoastingStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: null });
    const { unmount } = renderModal({ selectedBeanId: 'bean-1' });
    const input = document.querySelector('[data-testid="roast-summary-bean"] input') as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'Custom Sample');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const checkbox = document.querySelector('[data-testid="roast-summary-deduct"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    unmount();
});

it('prefills an ad-hoc blend independently of the previous single-origin roast', async () => {
    useRoastingStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: 'Medium' });
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderModal({ selectedBlendId: 'blend-1', onSave });
    const input =
        document.querySelector<HTMLInputElement>('[data-testid="roast-summary-bean"] input') ??
        document.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(input?.value).toBe('Modern');
    const save =
        document.querySelector<HTMLButtonElement>('[data-testid="roast-summary-save"]') ??
        [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('activeRoast.summary.save'));
    await act(async () => {
        save?.click();
    });
    expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ beanId: null, blendId: 'blend-1', weightGrams: 5, deductStock: true }),
    );
    unmount();
});
