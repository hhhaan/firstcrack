// @vitest-environment jsdom

import type { PidCapability, PidRuntime } from '@entities/machine';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        pidOn: vi.fn(),
        pidOff: vi.fn(),
        pidSetSv: vi.fn(),
    },
}));
vi.mock('@shared/lib/logger', () => ({
    logger: { capture: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn(), info: vi.fn() },
}));
vi.mock('@shared/store/toast', () => ({
    useToastStore: { getState: () => ({ show: vi.fn() }) },
}));

import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { usePidControl } from './usePidControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pidOff = vi.mocked(sidecar.pidOff);
const pidOn = vi.mocked(sidecar.pidOn);
const capture = vi.mocked(logger.capture);

const CAP: PidCapability = { supported: true, sv_min: 50, sv_max: 250 };

const runtime = (state: PidRuntime['state'], error: string | null = null): PidRuntime => ({
    state,
    sv: 200,
    duty: 50,
    pv: 180,
    p: 0,
    i: 0,
    d: 0,
    error,
});

const renderPid = async (props: Parameters<typeof usePidControl>[0]) => {
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof usePidControl>;
    const Probe = ({ p }: { p: Parameters<typeof usePidControl>[0] }) => {
        latest = usePidControl(p);
        return null;
    };
    const rerender = (p: Parameters<typeof usePidControl>[0]) =>
        act(async () => root.render(createElement(Probe, { p })));
    await rerender(props);
    return { get: () => latest, rerender, unmount: () => act(() => root.unmount()) };
};

const base = {
    sidecarConnected: true,
    capability: CAP,
    dropBehavior: 'zero' as const,
    roasting: false,
};

describe('usePidControl DROP 자동 해제 (#269)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        pidOff.mockReset();
        pidOn.mockReset();
        capture.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('배출 후 running이면 즉시 해제한다', async () => {
        pidOff.mockResolvedValue({ ok: true, pid: runtime('off') } as Awaited<ReturnType<typeof sidecar.pidOff>>);
        const hook = await renderPid({ ...base, runtime: runtime('running'), roastFinished: true });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledTimes(1);
        expect(pidOff).toHaveBeenCalledWith('zero');
        hook.unmount();
    });

    it('safe-off 실패 시 OFF로 축소하지 않고 재시도한다', async () => {
        pidOff.mockRejectedValue(new Error('PLC unreachable'));
        const hook = await renderPid({ ...base, runtime: runtime('running'), roastFinished: true });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledTimes(1);
        expect(capture).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(4999);
        });
        expect(pidOff).toHaveBeenCalledTimes(1);

        pidOff.mockResolvedValue({ ok: true, pid: runtime('off') } as Awaited<ReturnType<typeof sidecar.pidOff>>);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(pidOff).toHaveBeenCalledTimes(2);
        expect(capture).toHaveBeenCalledTimes(1);
        hook.unmount();
    });

    it('FAULT 상태에서도 자동 해제를 재시도한다', async () => {
        pidOff.mockRejectedValue(new Error('PLC unreachable'));
        const hook = await renderPid({
            ...base,
            runtime: runtime('fault', 'PID 해제 중 화력을 쓰지 못했습니다'),
            roastFinished: true,
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledTimes(1);
        hook.unmount();
    });

    it('turnOn uses an explicit SV instead of the stale slider closure', async () => {
        pidOn.mockResolvedValue({ ok: true, pid: runtime('running') } as Awaited<ReturnType<typeof sidecar.pidOn>>);
        const hook = await renderPid({ ...base, runtime: runtime('off'), roastFinished: false });
        let ok = false;
        await act(async () => {
            ok = await hook.get().turnOn(215);
        });
        expect(ok).toBe(true);
        expect(pidOn).toHaveBeenCalledWith(215);
        hook.unmount();
    });

    it('Cancel Drop이 roastFinished를 false로 바꿔도 safe-off 재시도를 취소하지 않는다', async () => {
        pidOff.mockRejectedValueOnce(new Error('busy')).mockResolvedValue({
            ok: true,
            pid: runtime('off'),
        } as Awaited<ReturnType<typeof sidecar.pidOff>>);
        const hook = await renderPid({ ...base, runtime: runtime('running'), roastFinished: true, roasting: false });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledTimes(1);
        await hook.rerender({ ...base, runtime: runtime('running'), roastFinished: false, roasting: true });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        expect(pidOff).toHaveBeenCalledTimes(2);
        hook.unmount();
    });

    it('로스트 밖에 PID가 남아 있으면 자동 해제한다 (리로드/READY)', async () => {
        pidOff.mockResolvedValue({ ok: true, pid: runtime('off') } as Awaited<ReturnType<typeof sidecar.pidOff>>);
        const hook = await renderPid({
            ...base,
            runtime: runtime('running'),
            roastFinished: false,
            roasting: false,
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledWith('zero');
        hook.unmount();
    });

    it('blockAutoEngage는 사용자 복원 전 pidOn을 막는다', async () => {
        const hook = await renderPid({
            ...base,
            runtime: runtime('off'),
            roastFinished: false,
            roasting: true,
            blockAutoEngage: true,
        });
        let ok = true;
        await act(async () => {
            ok = await hook.get().turnOn(215);
        });
        expect(ok).toBe(false);
        expect(pidOn).not.toHaveBeenCalled();
        await act(async () => {
            ok = await hook.get().turnOn(215, { userInitiated: true });
        });
        expect(pidOn).toHaveBeenCalled();
        hook.unmount();
    });

    it('연결이 없으면 해제 요청을 보내지 않는다', async () => {
        const hook = await renderPid({
            ...base,
            sidecarConnected: false,
            runtime: runtime('running'),
            roastFinished: true,
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(pidOff).not.toHaveBeenCalled();
        hook.unmount();
    });
});
