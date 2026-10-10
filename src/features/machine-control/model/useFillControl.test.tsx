// @vitest-environment jsdom

import { sidecar } from '@shared/lib/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFillControl } from './useFillControl';

const mocks = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('@shared/lib/sidecar', () => ({ sidecar: { setFill: vi.fn() } }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: () => ({ show: mocks.show }) } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('W60A fill control', () => {
    let root: ReturnType<typeof createRoot>;
    let model: ReturnType<typeof useFillControl>;
    const Harness = ({ supported }: { supported: boolean }) => {
        model = useFillControl(supported);
        return null;
    };
    const render = (supported: boolean) => act(() => root.render(createElement(Harness, { supported })));

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(sidecar.setFill).mockResolvedValue({ ok: true });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => act(() => root.unmount()));

    it('sends nothing on mount or capability changes', () => {
        render(true);
        render(false);
        render(true);
        expect(sidecar.setFill).not.toHaveBeenCalled();
    });

    it('rejects unsupported writes', async () => {
        render(false);
        await act(async () => expect(await model.send('open')).toBe(false));
        await act(async () => expect(await model.send('close')).toBe(false));
        expect(sidecar.setFill).not.toHaveBeenCalled();
    });

    it('sends explicit open and close actions', async () => {
        render(true);
        await act(async () => expect(await model.send('open')).toBe(true));
        await act(async () => expect(await model.send('close')).toBe(true));
        expect(vi.mocked(sidecar.setFill).mock.calls).toEqual([['open'], ['close']]);
    });

    it('blocks duplicate requests until the in-flight write finishes', async () => {
        let resolve!: (value: { ok: boolean }) => void;
        vi.mocked(sidecar.setFill).mockImplementation(
            () =>
                new Promise((r) => {
                    resolve = r;
                }),
        );
        render(true);
        await act(async () => {
            const pending = model.send('open');
            expect(await model.send('open')).toBe(false);
            resolve({ ok: true });
            await pending;
        });
        expect(sidecar.setFill).toHaveBeenCalledTimes(1);
        expect(model.sending).toBe(false);
    });

    it('reports an uncertain failure without retrying', async () => {
        vi.mocked(sidecar.setFill).mockRejectedValue(new Error('timeout'));
        render(true);
        await act(async () => expect(await model.send('open')).toBe(false));
        expect(sidecar.setFill).toHaveBeenCalledTimes(1);
        expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('조작반'), 'error');
        expect(model.sending).toBe(false);
    });
});
