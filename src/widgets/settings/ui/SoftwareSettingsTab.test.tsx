// @vitest-environment jsdom

import type { UpdateState } from '@features/updater';
import { useToastStore } from '@shared/store/toast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoftwareSettingsTab } from './SoftwareSettingsTab';

const updater = vi.hoisted(() => {
    const state: UpdateState = {
        status: 'idle',
        version: null,
        progress: 0,
        error: null,
    };
    return {
        state,
        checkForUpdate: vi.fn(() => Promise.resolve()),
        checkAndDownload: vi.fn(() => Promise.resolve()),
        applyAndRelaunch: vi.fn(() => Promise.resolve()),
        phase: 'idle',
    };
});

vi.mock('@features/updater', () => ({
    useUpdater: () => updater,
}));

vi.mock('@features/active-roast', () => ({
    useRoastingStore: (selector: (state: { phase: string }) => unknown) => selector({ phase: updater.phase }),
}));

vi.mock('@shared/lib/useAppVersion', () => ({
    useAppVersion: () => '1.3.2',
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SoftwareSettingsTab updates', () => {
    let container: HTMLDivElement;
    let root: Root;

    const render = () => {
        act(() => {
            root.render(createElement(SoftwareSettingsTab));
        });
    };

    beforeEach(() => {
        updater.state = { status: 'idle', version: null, progress: 0, error: null };
        vi.clearAllMocks();
        updater.phase = 'idle';
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
        container.remove();
    });

    it('shows the installed version and checks without downloading', () => {
        render();

        expect(container.textContent).toContain('v1.3.2');
        const button = container.querySelector('button');
        expect(button?.textContent).toContain('settings.tabs.software.check');

        act(() => button?.click());

        expect(updater.checkForUpdate).toHaveBeenCalledOnce();
        expect(updater.checkAndDownload).not.toHaveBeenCalled();
        expect(container.querySelector('[role="switch"]')).toBeNull();
    });

    it('offers an update when a newer version is available', () => {
        updater.state = { status: 'available', version: '1.4.0', progress: 0, error: null };
        render();

        const button = container.querySelector('button');
        expect(button?.textContent).toBe('updater.update');
        act(() => button?.click());

        expect(updater.checkAndDownload).toHaveBeenCalledOnce();
        expect(updater.checkForUpdate).not.toHaveBeenCalled();
    });

    it('shows the current-version result without offering an update', () => {
        updater.state = { status: 'current', version: null, progress: 0, error: null };
        render();

        expect(container.textContent).toContain('updater.upToDate');
        expect(container.querySelector('button')?.textContent).toBe('settings.tabs.software.check');
    });

    it.each(['preheating', 'standby', 'roasting', 'ended'])('asks to finish %s before restarting', (phase) => {
        updater.state = { status: 'ready', version: '1.4.0', progress: 100, error: null };
        updater.phase = phase;
        render();

        expect(container.querySelector('button')?.disabled).toBe(false);
        act(() => container.querySelector('button')?.click());
        expect(useToastStore.getState().toasts).toEqual([
            expect.objectContaining({
                message: phase === 'roasting' ? 'updater.finishRoastFirst' : 'updater.disconnectMachineFirst',
                tone: 'info',
            }),
        ]);
        expect(updater.applyAndRelaunch).not.toHaveBeenCalled();

        updater.phase = 'idle';
        render();
        expect(container.querySelector('button')?.textContent).toBe('updater.restart');
        act(() => container.querySelector('button')?.click());
        expect(updater.applyAndRelaunch).toHaveBeenCalledOnce();
    });

    it('shows checking and disables the button while a check is in flight', () => {
        updater.state = { status: 'checking', version: null, progress: 0, error: null };
        render();

        expect(container.textContent).toContain('updater.checking');
        expect(container.querySelector('button')?.disabled).toBe(true);
    });
});
