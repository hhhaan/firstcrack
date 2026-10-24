// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateCheckerProvider, useUpdater } from './UpdateCheckerProvider';
import type { UseUpdateCheckerReturn } from './useUpdateChecker';

const native = vi.hoisted(() => ({
    check: vi.fn(),
    platform: vi.fn(() => 'macos'),
    invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({ check: native.check }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: native.platform }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@sentry/react', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('UpdateCheckerProvider', () => {
    let root: Root;
    let container: HTMLDivElement;
    let checker: UseUpdateCheckerReturn | undefined;

    function Consumer() {
        checker = useUpdater();
        return null;
    }

    const api = () => {
        if (!checker) throw new Error('Updater did not mount');
        return checker;
    };

    const update = () => ({
        version: '1.4.0',
        currentVersion: '1.3.3',
        download: vi.fn().mockResolvedValue(undefined),
        downloadAndInstall: vi.fn().mockResolvedValue(undefined),
        install: vi.fn().mockResolvedValue(undefined),
    });

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubEnv('DEV', false);
        vi.clearAllMocks();
        native.platform.mockReturnValue('macos');
        native.check.mockResolvedValue(null);
        localStorage.clear();
        checker = undefined;
        container = document.createElement('div');
        root = createRoot(container);
        await act(async () => root.render(createElement(UpdateCheckerProvider, null, createElement(Consumer))));
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('checks on startup and downloads automatically after four hours', async () => {
        expect(native.check).toHaveBeenCalledOnce();
        const available = update();
        native.check.mockResolvedValue(available);

        await act(async () => vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000));

        expect(native.check).toHaveBeenCalledTimes(2);
        expect(available.downloadAndInstall).toHaveBeenCalledOnce();
        expect(api().state.status).toBe('ready');
        await act(async () => vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000));
        expect(native.check).toHaveBeenCalledTimes(2);
    });

    it.each(['macos', 'windows'])('checks manually and reuses the %s update path', async (os) => {
        native.platform.mockReturnValue(os);
        const available = update();
        native.check.mockResolvedValue(available);

        await act(async () => api().checkForUpdate());

        expect(api().state).toMatchObject({ status: 'available', version: '1.4.0' });
        expect(available.download).not.toHaveBeenCalled();
        expect(available.downloadAndInstall).not.toHaveBeenCalled();

        await act(async () => api().checkAndDownload());

        expect(api().state.status).toBe('ready');
        expect(os === 'windows' ? available.download : available.downloadAndInstall).toHaveBeenCalledOnce();

        await act(async () => api().applyAndRelaunch());

        if (os === 'windows') {
            expect(available.install).toHaveBeenCalledOnce();
            expect(native.invoke).not.toHaveBeenCalled();
        } else {
            expect(native.invoke).toHaveBeenCalledWith('relaunch_for_update');
            expect(available.install).not.toHaveBeenCalled();
        }
    });

    it('reports the installed version as current when no update exists', async () => {
        await act(async () => api().checkForUpdate());
        expect(api().state).toMatchObject({ status: 'current', version: null });
    });

    it('stops periodic checks when unmounted', async () => {
        act(() => root.unmount());
        root = createRoot(container);
        await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
        expect(native.check).toHaveBeenCalledOnce();
    });
});
