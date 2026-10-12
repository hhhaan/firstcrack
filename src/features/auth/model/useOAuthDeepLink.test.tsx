// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOAuthDeepLink } from './useOAuthDeepLink';

const mocks = vi.hoisted(() => ({
    listen: vi.fn(),
    onOpenUrl: vi.fn(),
    getCurrent: vi.fn(() => Promise.resolve([] as string[])),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({
    getCurrent: mocks.getCurrent,
    onOpenUrl: mocks.onOpenUrl,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = () => {
    useOAuthDeepLink();
    return null;
};

describe('useOAuthDeepLink', () => {
    afterEach(() => {
        mocks.listen.mockReset();
        mocks.onOpenUrl.mockReset();
        mocks.getCurrent.mockReset();
        mocks.getCurrent.mockImplementation(() => Promise.resolve([]));
    });

    it('unsubscribes when listen resolves after cleanup', async () => {
        let resolveListen: (fn: () => void) => void = () => {};
        let resolveOpen: (fn: () => void) => void = () => {};
        mocks.listen.mockReturnValue(
            new Promise((resolve) => {
                resolveListen = resolve;
            }),
        );
        mocks.onOpenUrl.mockReturnValue(
            new Promise((resolve) => {
                resolveOpen = resolve;
            }),
        );

        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => {
            root.render(createElement(Probe));
        });
        await act(async () => {
            root.unmount();
        });

        const unlistenBackup = vi.fn();
        const unlistenDeepLink = vi.fn();
        await act(async () => {
            resolveListen(unlistenBackup);
            resolveOpen(unlistenDeepLink);
        });

        expect(unlistenBackup).toHaveBeenCalledOnce();
        expect(unlistenDeepLink).toHaveBeenCalledOnce();
    });
});
