// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    subscribeSidecarSettings: vi.fn(() => () => {}),
    sidecar: {
        getStatus: vi.fn(),
        setControl: vi.fn(),
    },
}));

import { sidecar, subscribeSidecarSettings } from '@shared/lib/sidecar';
import type { ControlCommand } from '../lib/controlSender';
import { useMachineControl } from './useMachineControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatus = vi.mocked(sidecar.getStatus);
const setControl = vi.mocked(sidecar.setControl);

const CONTROL = {
    writable: true,
    limits: { heater: { min: 0, max: 100 } },
} as NonNullable<Awaited<ReturnType<typeof sidecar.getStatus>>['control']>;

/** 실제 훅을 렌더해 반환값을 노출한다 (repo 표준 패턴 — useAutoDetection.test.ts). */
const renderHook = async (connected: boolean, onCommitted?: (committed: ControlCommand) => void) => {
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof useMachineControl>;
    const Probe = ({ on, onCommit }: { on: boolean; onCommit?: (committed: ControlCommand) => void }) => {
        latest = useMachineControl(on, null, onCommit);
        return null;
    };
    const render = (onCommit = onCommitted) =>
        act(async () => root.render(createElement(Probe, { on: connected, onCommit })));
    await render();
    return { get: () => latest, render, unmount: () => act(() => root.unmount()) };
};

describe('useMachineControl capability 조회 (#269 회귀)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getStatus.mockReset();
        setControl.mockReset();
        setControl.mockImplementation(async (cmd) => ({ ok: true, applied: cmd }));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('일시 /status 실패 시 capability를 지우지 않고 재시도해 결국 확보한다', async () => {
        getStatus
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue({ control: CONTROL } as Awaited<ReturnType<typeof sidecar.getStatus>>);

        const hook = await renderHook(true);
        expect(getStatus).toHaveBeenCalledTimes(1);
        expect(hook.get().writable).toBe(false); // 아직 — 하지만 포기하지 않는다

        // 재시도 타이머 발화 → 두 번째 조회 성공
        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        expect(getStatus).toHaveBeenCalledTimes(2);
        expect(hook.get().writable).toBe(true);
        expect(hook.get().limits.heater).toEqual({ min: 0, max: 100 });
        hook.unmount();
    });

    it('한 번 확보한 capability는 성공 이후 재조회로 지워지지 않는다', async () => {
        getStatus.mockResolvedValue({ control: CONTROL } as Awaited<ReturnType<typeof sidecar.getStatus>>);
        const hook = await renderHook(true);
        await act(async () => {
            await Promise.resolve();
        });
        expect(hook.get().writable).toBe(true);

        await act(async () => {
            vi.advanceTimersByTime(10_000);
        });
        expect(getStatus).toHaveBeenCalledTimes(2);
        expect(hook.get().writable).toBe(true);
        expect(hook.get().limits.heater).toEqual({ min: 0, max: 100 });
        hook.unmount();
    });

    it('ignores an older status response after settings refresh identifies a newer connection', async () => {
        let refresh = () => {};
        vi.mocked(subscribeSidecarSettings).mockImplementation((listener) => {
            refresh = listener;
            return () => {};
        });
        let resolveOld: (status: Awaited<ReturnType<typeof sidecar.getStatus>>) => void = () => {};
        getStatus.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveOld = resolve;
            }),
        );
        const newer = {
            connected: true,
            machine_id: 'b',
            connection_epoch: 2,
            roaster: 'giesen_w45a_w60a',
            control: CONTROL,
        } as Awaited<ReturnType<typeof sidecar.getStatus>>;
        getStatus.mockResolvedValue(newer);
        const hook = await renderHook(true);
        await act(async () => {
            refresh();
        });
        expect(hook.get().connectionStatus?.machine_id).toBe('b');
        await act(async () => {
            resolveOld({ ...newer, machine_id: 'a', connection_epoch: 1 });
        });
        expect(hook.get().connectionStatus?.machine_id).toBe('b');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(getStatus).toHaveBeenCalledTimes(3);
        hook.unmount();
        vi.mocked(subscribeSidecarSettings).mockImplementation(() => () => {});
    });

    it('does not resume polling when a pending status response resolves after unmount', async () => {
        let resolveStatus: (status: Awaited<ReturnType<typeof sidecar.getStatus>>) => void = () => {};
        getStatus.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveStatus = resolve;
            }),
        );
        const hook = await renderHook(true);
        hook.unmount();
        await act(async () => {
            resolveStatus({ connected: true, control: CONTROL } as Awaited<ReturnType<typeof sidecar.getStatus>>);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(getStatus).toHaveBeenCalledTimes(1);
    });

    it('언마운트 후에는 재시도 타이머가 조회를 다시 쏘지 않는다', async () => {
        getStatus.mockRejectedValue(new Error('down'));
        const hook = await renderHook(true);
        expect(getStatus).toHaveBeenCalledTimes(1);
        hook.unmount();
        await act(async () => {
            vi.advanceTimersByTime(10_000);
        });
        expect(getStatus).toHaveBeenCalledTimes(1);
    });

    it('연결이 없으면 env 기기의 제어 화면을 보여 주고, 연결되면 실측만 쓴다', async () => {
        vi.stubEnv('VITE_DEV_ROASTER', 'giesen_w45a_w60a');
        const hook = await renderHook(false);
        expect(hook.get().writable).toBe(true);
        expect(getStatus).not.toHaveBeenCalled();

        getStatus.mockResolvedValue({ control: CONTROL } as Awaited<ReturnType<typeof sidecar.getStatus>>);
        const connected = await renderHook(true);
        await act(async () => {
            await Promise.resolve();
        });
        expect(connected.get().limits).toEqual(CONTROL.limits);
        hook.unmount();
        connected.unmount();
        vi.unstubAllEnvs();
    });

    it('최신 onCommitted를 sender 재생성 없이 사용한다', async () => {
        getStatus.mockResolvedValue({ control: CONTROL } as Awaited<ReturnType<typeof sidecar.getStatus>>);
        const first = vi.fn();
        const second = vi.fn();
        const hook = await renderHook(true, first);

        act(() => hook.get().setValue('heater', 0));
        await hook.render(second);
        await act(async () => hook.get().commitNow());

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith({ heater: 0 });
        expect(setControl).toHaveBeenCalledWith(
            { heater: 0 },
            expect.objectContaining({ origin: 'manual', takeover: true }),
        );
        hook.unmount();
    });
});
