// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getStatus: vi.fn(),
        setControl: vi.fn(),
    },
}));

import { sidecar } from '@shared/lib/sidecar';
import { useMachineControl } from './useMachineControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatus = vi.mocked(sidecar.getStatus);

const CONTROL = {
    writable: true,
    limits: { heater: { min: 0, max: 100 } },
} as Awaited<ReturnType<typeof sidecar.getStatus>>['control'];

/** 실제 훅을 렌더해 반환값을 노출한다 (repo 표준 패턴 — useAutoDetection.test.ts). */
const renderHook = async (connected: boolean) => {
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof useMachineControl>;
    const Probe = ({ on }: { on: boolean }) => {
        latest = useMachineControl(on, null);
        return null;
    };
    await act(async () => root.render(createElement(Probe, { on: connected })));
    return { get: () => latest, unmount: () => act(() => root.unmount()) };
};

describe('useMachineControl capability 조회 (#269 회귀)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getStatus.mockReset();
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
        expect(getStatus).toHaveBeenCalledTimes(1);
        expect(hook.get().writable).toBe(true);
        expect(hook.get().limits.heater).toEqual({ min: 0, max: 100 });
        hook.unmount();
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
});
