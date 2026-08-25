// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ReplayPoint } from '../lib/replay';
import { type ReplayControlInputs, useReplayControl } from './useReplayControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// TP: t=60/bt=95. 이벤트: t=0 h=80(시간), t=120 bt=110 h=60(BT), t=300 bt=155 h=40(BT)
const POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heater: 80 },
    { t: 60, bt: 95, heater: 80 },
    { t: 120, bt: 110, heater: 60 },
    { t: 300, bt: 155, heater: 40 },
    { t: 600, bt: 205, heater: 40 },
];

const BASE: Omit<ReplayControlInputs, 'writeHeater'> = {
    referencePoints: POINTS,
    liveBt: 180,
    elapsed: 0,
    roasting: true,
    afterTurningPoint: false,
    heaterWritable: true,
    pidEngaged: false,
    roastFinished: false,
    sidecarConnected: true,
    heaterUnacknowledged: false,
};

/** repo 표준 패턴 — 실제 훅을 렌더해 반환값을 노출한다 */
const renderReplay = async (initial: Partial<ReplayControlInputs> = {}) => {
    const writeHeater = vi.fn();
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof useReplayControl>;
    const Probe = ({ inputs }: { inputs: Partial<ReplayControlInputs> }) => {
        latest = useReplayControl({ ...BASE, writeHeater, ...inputs });
        return null;
    };
    const rerender = (inputs: Partial<ReplayControlInputs>) =>
        act(async () => root.render(createElement(Probe, { inputs })));
    await rerender(initial);
    return { get: () => latest, rerender, writeHeater, unmount: () => act(() => root.unmount()) };
};

describe('useReplayControl', () => {
    it('토글 ON 직후 시간 트리거 이벤트(t=0 초기 화력)가 발화한다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.unmount();
    });

    it('TP 확정 후 레퍼런스 이벤트 BT 도달 시 발화하고, 하강 중에는 안 한다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();

        // 하강 중 bt=120 ≥ 이벤트 bt=110 이지만 TP 미확정 → 침묵
        await h.rerender({ liveBt: 120, elapsed: 30, afterTurningPoint: false });
        expect(h.writeHeater).not.toHaveBeenCalled();

        // TP 확정 + 도달 → 발화
        await h.rerender({ liveBt: 111, elapsed: 130, afterTurningPoint: true });
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        h.unmount();
    });

    it('roasting이 아니면 판정하지 않는다', async () => {
        const h = await renderReplay({ roasting: false, elapsed: 10 });
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('PID가 켜지면 즉시 중지된다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({ pidEngaged: true });
        expect(h.get().active).toBe(false);
        h.unmount();
    });

    it('연결 끊김 / 배출 시 중지된다', async () => {
        for (const cut of [{ sidecarConnected: false }, { roastFinished: true }]) {
            const h = await renderReplay();
            await act(async () => h.get().toggle());
            await h.rerender(cut);
            expect(h.get().active).toBe(false);
            h.unmount();
        }
    });

    it('쓰기 미반영(unacknowledged)이면 중지된다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({ heaterUnacknowledged: true });
        expect(h.get().active).toBe(false);
        h.unmount();
    });

    it('stop() — 수동 슬라이더 개입 — 후에는 이벤트가 더 발화하지 않는다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        await act(async () => h.get().stop());
        await h.rerender({ liveBt: 160, elapsed: 400, afterTurningPoint: true });
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('레퍼런스가 바뀌면 재생이 중지되고 인덱스가 초기화된다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({ referencePoints: [...POINTS.map((p) => ({ ...p, heater: (p.heater ?? 0) + 5 }))] });
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('profileChanged');
        h.unmount();
    });

    it('레퍼런스 교체 커밋에서 옛 인덱스로 새 계획을 판정하지 않는다 — stale write 회귀', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle()); // t=0 이벤트 발화, index=1
        h.writeHeater.mockClear();
        // 교체와 동시에 새 계획의 남은 이벤트가 전부 발화 가능한 조건을 준다.
        // 리셋이 effect였다면 판정 effect가 stale active로 한 번 실행돼 catch-up 쓰기가 나간다.
        await h.rerender({
            referencePoints: POINTS.map((p) => ({ ...p, heater: (p.heater ?? 0) + 5 })),
            liveBt: 160,
            elapsed: 400,
            afterTurningPoint: true,
        });
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('자동 중지 시 사유가 남고, 다시 켜면 지워진다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({ pidEngaged: true });
        expect(h.get().stopReason).toBe('pid');
        await h.rerender({ pidEngaged: false });
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.get().stopReason).toBeNull();
        h.unmount();
    });

    it('stop()은 active일 때만 manual 사유를 남기고, 직접 토글 OFF는 사유가 없다', async () => {
        const h = await renderReplay();
        // 비활성 상태의 슬라이더 조작(stop 호출)은 사유를 만들지 않는다
        await act(async () => h.get().stop());
        expect(h.get().stopReason).toBeNull();
        await act(async () => h.get().toggle());
        await act(async () => h.get().stop());
        expect(h.get().stopReason).toBe('manual');
        await act(async () => h.get().toggle());
        await act(async () => h.get().toggle()); // 직접 OFF
        expect(h.get().stopReason).toBeNull();
        h.unmount();
    });

    it('heater 기록이 없는 레퍼런스(합성)에서는 available=false, 토글해도 켜지지 않는다', async () => {
        const h = await renderReplay({ referencePoints: POINTS.map((p) => ({ ...p, heater: null })) });
        expect(h.get().available).toBe(false);
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });
});
