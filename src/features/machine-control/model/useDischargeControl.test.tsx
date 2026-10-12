// @vitest-environment jsdom

import { SidecarHttpError, sidecar } from '@shared/lib/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDischargeControl } from './useDischargeControl';

const mocks = vi.hoisted(() => ({ show: vi.fn(), captureNoResponse: vi.fn() }));
vi.mock('@shared/lib/sidecar', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sidecar')>();
    return { ...actual, sidecar: { setDischarge: vi.fn() } };
});
vi.mock('@shared/lib/sentry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sentry')>();
    return { ...actual, captureDoorWriteNoResponse: mocks.captureNoResponse, isSentryEnabled: true };
});
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: () => ({ show: mocks.show }) } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('W60A discharge control', () => {
    let root: ReturnType<typeof createRoot>;
    let model: ReturnType<typeof useDischargeControl>;
    const Harness = ({ supported }: { supported: boolean }) => {
        model = useDischargeControl(supported);
        return null;
    };
    const render = (supported: boolean) => act(() => root.render(createElement(Harness, { supported })));

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(sidecar.setDischarge).mockResolvedValue({ ok: true });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => act(() => root.unmount()));

    it('sends nothing on mount or capability changes', () => {
        render(true);
        render(false);
        render(true);
        expect(sidecar.setDischarge).not.toHaveBeenCalled();
    });

    it('rejects unsupported writes', async () => {
        render(false);
        await act(async () => expect(await model.send('open')).toBe(false));
        await act(async () => expect(await model.send('close')).toBe(false));
        expect(sidecar.setDischarge).not.toHaveBeenCalled();
    });

    it('sends explicit open and close actions', async () => {
        render(true);
        await act(async () => expect(await model.send('open')).toBe(true));
        await act(async () => expect(await model.send('close')).toBe(true));
        expect(vi.mocked(sidecar.setDischarge).mock.calls).toEqual([
            ['open', undefined],
            ['close', undefined],
        ]);
    });

    it('blocks duplicate requests until the in-flight write finishes', async () => {
        let resolve!: (value: { ok: boolean }) => void;
        vi.mocked(sidecar.setDischarge).mockImplementation(
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
        expect(sidecar.setDischarge).toHaveBeenCalledTimes(1);
        expect(model.sending).toBe(false);
    });

    it('reports an uncertain failure without retrying', async () => {
        vi.mocked(sidecar.setDischarge).mockRejectedValue(
            new SidecarHttpError('/discharge', 'timeout', 'timeout', false),
        );
        render(true);
        await act(async () => expect(await model.send('open')).toBe(false));
        expect(sidecar.setDischarge).toHaveBeenCalledTimes(1);
        expect(mocks.captureNoResponse).toHaveBeenCalledOnce();
        expect(mocks.captureNoResponse).toHaveBeenCalledWith({
            door: 'discharge',
            action: 'open',
            status: 'timeout',
        });
        const blob = JSON.stringify(mocks.captureNoResponse.mock.calls[0]);
        expect(blob).not.toMatch(/\/discharge|10\./);
        expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('조작반'), 'error');
        expect(model.sending).toBe(false);
    });

    it('does not capture sidecar 502 responses (sidecar owns that event)', async () => {
        vi.mocked(sidecar.setDischarge).mockRejectedValue(new SidecarHttpError('/discharge', 502, 'plc fail', false));
        render(true);
        await act(async () => expect(await model.send('close')).toBe(false));
        expect(mocks.captureNoResponse).not.toHaveBeenCalled();
    });
});
