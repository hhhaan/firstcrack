// @vitest-environment jsdom
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RoastSummaryModal } from './RoastSummaryModal';

vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({
        data: [{ id: 'bean-1', name: 'Yirg', origin: 'ET', region: null, farm: null, variety: null, process: null }],
    }),
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1', isWorkspaceReady: true }),
}));

vi.mock('@entities/plan', () => ({
    useDayBatches: () => ({ data: [] }),
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
    onSave: async () => {},
};

afterEach(() => {
    useRoastSessionStore.setState({ planBatchHandoff: null, lastAdhocSave: null });
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

it('checks deductStock when schedule handoff is present', () => {
    const { host, unmount } = renderModal({ planBatchHandoff: handoff });
    const checkbox = host.querySelector('[data-testid="roast-summary-deduct"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    unmount();
});

it('checks deductStock when selectedBeanId is set without handoff', () => {
    useRoastSessionStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: null });
    const { host, unmount } = renderModal({ selectedBeanId: 'bean-1' });
    const checkbox = host.querySelector('[data-testid="roast-summary-deduct"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    unmount();
});

it('calls onClose from the header X without discarding', () => {
    const onClose = vi.fn();
    const onDiscard = vi.fn();
    const { host, unmount } = renderModal({ onClose, onDiscard });
    const close = host.querySelector('[data-testid="roast-summary-close"]') as HTMLButtonElement;
    expect(close).not.toBeNull();
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    unmount();
});

it('unchecks deductStock when a custom bean name is typed', () => {
    useRoastSessionStore.getState().recordAdhocSave({ beanId: 'bean-1', weightKg: 5, roastLevel: null });
    const { host, unmount } = renderModal({ selectedBeanId: 'bean-1' });
    const input = host.querySelector('[data-testid="roast-summary-bean"] input') as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'Custom Sample');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const checkbox = host.querySelector('[data-testid="roast-summary-deduct"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    unmount();
});
