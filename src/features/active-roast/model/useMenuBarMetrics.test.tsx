// @vitest-environment jsdom
import { invoke } from '@tauri-apps/api/core';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useMenuBarMetrics } from './useMenuBarMetrics';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });

const reading = { et: '210.2°C', bt: '198.4°C', ror: '12.0', time: '8:42' };
const Probe = ({ value }: { value: typeof reading | null }) => {
    useMenuBarMetrics(value);
    return null;
};
afterEach(() => vi.clearAllMocks());

it('sends native readings, skips unchanged readings, and removes the item on unmount', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { value: reading })));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('update_menu_bar_metrics', { reading });
    await act(async () => root.render(createElement(Probe, { value: { ...reading } })));
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(Probe, { value: null })));
    expect(invoke).toHaveBeenLastCalledWith('update_menu_bar_metrics', { reading: null });
    await act(async () => root.unmount());
    expect(invoke).toHaveBeenLastCalledWith('update_menu_bar_metrics', { reading: null });
});

it('waits for pending native updates before unmount cleanup', async () => {
    let resolvePending: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
        resolvePending = resolve;
    });
    vi.mocked(invoke).mockImplementationOnce(() => pending);
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { value: reading })));
    await act(async () => root.unmount());
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => resolvePending?.());
    expect(invoke).toHaveBeenLastCalledWith('update_menu_bar_metrics', { reading: null });
});
