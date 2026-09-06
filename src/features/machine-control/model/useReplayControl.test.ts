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
    referenceMachineMismatch: false,
    referenceDropTime: null,
    liveBt: 180,
    elapsed: 0,
    roasting: true,
    afterTurningPoint: false,
    heaterWritable: true,
    pidEngaged: false,
    roastFinished: false,
    sidecarConnected: true,
    heaterUnacknowledged: false,
    dropBehavior: 'hold',
    heaterFeedback: null,
    heaterPending: false,
    reconnecting: false,
};

/** repo 표준 패턴 — 실제 훅을 렌더해 반환값을 노출한다 */
const renderReplay = async (initial: Partial<ReplayControlInputs> = {}) => {
    const writeHeater = vi.fn(async (_value: number) => true);
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof useReplayControl>;
    const Probe = ({ inputs }: { inputs: Partial<ReplayControlInputs> }) => {
        latest = useReplayControl({ ...BASE, writeHeater, ...inputs });
        return null;
    };
    const render = (inputs: Partial<ReplayControlInputs>) =>
        act(async () => root.render(createElement(Probe, { inputs })));
    // 실기에서는 elapsed가 1초씩 흐른다 — 테스트가 0→130으로 건너뛰면 #313 타이밍 갭으로
    // 오중지되므로, 직전 입력 그대로 SAMPLE_GAP 이내 간격의 중간 틱을 채워 시간을 흘린다.
    let last: Partial<ReplayControlInputs> = initial;
    const rerender = async (inputs: Partial<ReplayControlInputs>) => {
        const from = last.elapsed ?? BASE.elapsed;
        const to = inputs.elapsed ?? from;
        if (inputs.roasting == null || inputs.roasting === (last.roasting ?? BASE.roasting)) {
            for (let e = from + 5; e < to; e += 5) await render({ ...last, elapsed: e });
        }
        last = inputs;
        await render(inputs);
    };
    /** 중간 틱 없이 한 번에 점프 — webview 스로틀 복귀를 흉내낸다 (#313) */
    const jump = (inputs: Partial<ReplayControlInputs>) => {
        last = inputs;
        return render(inputs);
    };
    await render(initial);
    return { get: () => latest, rerender, jump, writeHeater, unmount: () => act(() => root.unmount()) };
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

    it('reconnecting 동안은 이벤트를 소비하지 않는다 — 복구 후 밀린 이벤트를 한 번에 따라잡는다', async () => {
        // t=30 시간축 이벤트 — 링크 복구 대기 중 elapsed만 흐르는 동안 409로 버려지면 안 된다
        const pts: ReplayPoint[] = [
            { t: 0, bt: 180, heater: 80 },
            { t: 30, bt: 140, heater: 70 },
            { t: 60, bt: 95, heater: 70 },
            { t: 300, bt: 155, heater: 40 },
        ];
        const h = await renderReplay({ referencePoints: pts });
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        await h.rerender({ referencePoints: pts, elapsed: 1, liveBt: 170, reconnecting: true });
        await h.rerender({ referencePoints: pts, elapsed: 31, liveBt: 140, reconnecting: true });
        await h.rerender({ referencePoints: pts, elapsed: 35, liveBt: 140, reconnecting: true });
        expect(h.writeHeater).toHaveBeenCalledTimes(1);
        expect(h.get().active).toBe(true);
        expect(h.get().nextEvent?.heater).toBe(70);
        await h.rerender({ referencePoints: pts, elapsed: 36, liveBt: 138, reconnecting: false });
        expect(h.writeHeater).toHaveBeenLastCalledWith(70);
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

    it('unacknowledged 중지 후 미반영이 풀려도 그 배치는 다시 켤 수 없다 (#374)', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({ heaterUnacknowledged: true });
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('unacknowledged');
        expect(h.get().locked).toBe(true);
        await h.rerender({ heaterUnacknowledged: false });
        expect(h.get().blocked).toBe(true);
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(false);
        await h.rerender({ roasting: false });
        await h.rerender({ liveBt: 180, elapsed: 0, afterTurningPoint: false });
        expect(h.get().locked).toBe(false);
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        h.unmount();
    });

    it('중지 조건과 새 샘플이 같은 커밋에 오면 쓰지 않는다 — stale write 회귀', async () => {
        // pidEngaged/unacknowledged는 새 liveBt와 같은 폴링 커밋에 바뀐다.
        // setActive(false)는 다음 렌더에나 반영되므로 판정 effect의 stopCause 가드가 막아야 한다.
        for (const cut of [{ pidEngaged: true }, { heaterUnacknowledged: true }]) {
            const h = await renderReplay();
            await act(async () => h.get().toggle()); // t=0 이벤트 발화
            h.writeHeater.mockClear();
            await h.rerender({ ...cut, liveBt: 111, elapsed: 130, afterTurningPoint: true });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        }
    });

    it('PID가 켜져 있으면 blocked=true — UI가 체크박스를 disabled로 보여야 한다', async () => {
        const h = await renderReplay({ pidEngaged: true });
        expect(h.get().blocked).toBe(true);
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(false);
        h.unmount();
    });

    it('stop() — 수동 슬라이더 개입 — 꺼진 동안은 이벤트가 발화하지 않는다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        await act(async () => h.get().stop());
        await h.rerender({ liveBt: 160, elapsed: 400, afterTurningPoint: true });
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('수동 중지 후 다시 켜면 지난 이벤트를 다시 쓰지 않고 남은 구간부터 이어간다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle()); // t=0 h=80, index=1
        h.writeHeater.mockClear();
        await act(async () => h.get().stop());
        // 앱 슬라이더는 배치 잠금 대상이 아니다 (#374)
        expect(h.get().locked).toBe(false);

        // 아직 다음 BT 이벤트(110°) 전 — 재개해도 즉시 쓰기 없음, 손 값이 유지
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).not.toHaveBeenCalled();

        await h.rerender({ liveBt: 111, elapsed: 130, afterTurningPoint: true });
        expect(h.writeHeater).toHaveBeenCalledTimes(1);
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        expect(h.writeHeater).not.toHaveBeenCalledWith(80);
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

    it('이전 배치에서 이벤트를 소진해도 새 배치가 시작되면 처음부터 재생한다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        // 배치 1: 늦은 시각 + 고온으로 전 이벤트 소진
        await h.rerender({ liveBt: 210, elapsed: 650, afterTurningPoint: true });
        expect(h.get().nextEvent).toBeNull();
        // 배출 → 종료
        await h.rerender({ liveBt: 210, elapsed: 660, afterTurningPoint: true, roastFinished: true, roasting: false });
        // 배치 2: 같은 레퍼런스로 새로 시작
        await h.rerender({ liveBt: 180, elapsed: 0, afterTurningPoint: false });
        h.writeHeater.mockClear();
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).toHaveBeenCalledWith(80); // 초기 화력 이벤트가 다시 발화
        h.unmount();
    });

    it('배치 종료 후 차지 전에 토글해도 stale index가 "완료"로 보이지 않는다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        // 배치 1: 전 이벤트 소진 → 배출로 종료
        await h.rerender({ liveBt: 210, elapsed: 650, afterTurningPoint: true });
        await h.rerender({ liveBt: 210, elapsed: 660, afterTurningPoint: true, roastFinished: true, roasting: false });
        // 차지 전(standby/preheat)에 미리 켠다 — 하강 에지에서 index가 리셋됐어야 한다
        await h.rerender({ liveBt: 180, elapsed: 0, afterTurningPoint: false, roasting: false });
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.get().nextEvent).not.toBeNull();
        expect(h.get().stopReason).toBeNull();
        h.unmount();
    });

    describe('배출 시 화력 정책 (#316) — pidDropBehavior 공용', () => {
        // 실제 흐름: Drop 마크 시점에 phase는 아직 'roasting'이다(endRoast까지 유지).
        const dropMarked = { liveBt: 205, elapsed: 650, afterTurningPoint: true, roastFinished: true };

        it('zero: 재생 중 배출되면 즉시 heater 0을 쓴다 — 반복 커밋에도 한 번만', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).toHaveBeenCalledWith(0);
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, liveBt: 200 });
            expect(h.writeHeater).toHaveBeenCalledTimes(1);
            h.unmount();
        });

        it('hold: 배출 시 아무 write도 하지 않는다 — 설정으로 선택된 잔류', async () => {
            const h = await renderReplay({ dropBehavior: 'hold' });
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'hold', ...dropMarked });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        });

        it('zero: 기기가 안 따라오면(unacknowledged) 다시 쓴다 — safe-off 재시도', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, heaterUnacknowledged: true });
            expect(h.writeHeater).toHaveBeenCalledWith(0);
            h.unmount();
        });

        it('zero: End Roast 확정(roasting 하강) 후에도 재시도가 살아 있다', async () => {
            // Drop(roasting 유지) → 몇 초 뒤 End Roast 확정이 실제 2단계 흐름이다.
            // roasting 에지에서 재시도 상태를 지우면 이 흐름에서 safe-off가 죽는다.
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, roasting: false });
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, roasting: false, heaterUnacknowledged: true });
            expect(h.writeHeater).toHaveBeenCalledWith(0);
            h.unmount();
        });

        it('zero: 새 배치가 시작되면 재시도를 멈춘다 — 이전 배치 정책이 새 배치 화력을 덮지 않는다', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, roasting: false });
            // 새 배치 차지
            await h.rerender({ dropBehavior: 'zero', liveBt: 180, elapsed: 0, afterTurningPoint: false });
            h.writeHeater.mockClear();
            await h.rerender({
                dropBehavior: 'zero',
                liveBt: 180,
                elapsed: 5,
                afterTurningPoint: false,
                heaterUnacknowledged: true,
            });
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        });

        it('zero: 수동 슬라이더 개입(stop)은 재시도를 취소한다 — 화력 소유권은 사람에게 넘어간다', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            await act(async () => h.get().stop());
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, heaterUnacknowledged: true });
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        });

        it('zero: 배출 전에 수동 중지된 상태였으면 쓰지 않는다 — 재생이 화력을 잡고 있던 경우만', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            await act(async () => h.get().stop());
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        });

        it('zero: 배출 시점에 끊겨 있어도 write를 시도한다 — 실패는 토스트/Sentry로 관측된다', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, sidecarConnected: false });
            expect(h.writeHeater).toHaveBeenCalledWith(0);
            h.unmount();
        });
    });

    describe('외부 개입 — controlDiverged (#307)', () => {
        // 토글 ON → t=0 이벤트가 80을 쓰고 lastWritten=80이 된다. 실측 80 = 수렴 상태.
        const armed = async () => {
            const h = await renderReplay({ heaterFeedback: 80 });
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            h.writeHeater.mockClear();
            return h;
        };

        it('수렴 후 실측이 지시에서 지속 이탈하면 재생 중지 — write 없음, 그 배치는 잠금 (#374)', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 10 });
            await h.rerender({ heaterFeedback: 50, elapsed: 11 });
            expect(h.get().active).toBe(true); // 2틱 — 아직 확정 아님
            await h.rerender({ heaterFeedback: 50, elapsed: 12 });
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('controlDiverged');
            // 개입 값을 존중한다 — 어떤 write도 없어야 한다
            expect(h.writeHeater).not.toHaveBeenCalled();
            // 실기 개입은 그 배치 잠금 — 재토글 침묵
            expect(h.get().locked).toBe(true);
            expect(h.get().blocked).toBe(true);
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('controlDiverged');
            h.unmount();
        });

        it('잠금은 새 배치에서만 풀린다 — 다음 배치에서 원인이 지속되면 다시 잠긴다 (#374)', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 10 });
            await h.rerender({ heaterFeedback: 50, elapsed: 11 });
            await h.rerender({ heaterFeedback: 50, elapsed: 12 });
            expect(h.get().locked).toBe(true);
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(false);
            // 배출 → 새 배치 차지 — 잠금 해제
            await h.rerender({ heaterFeedback: 50, elapsed: 20, roastFinished: true, roasting: false });
            await h.rerender({ heaterFeedback: 80, elapsed: 0 });
            expect(h.get().locked).toBe(false);
            h.writeHeater.mockClear();
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(true);
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            // 수렴 상태에서 다음 이벤트 발화(110°→60%) 후, 실측이 계속 벗어나면 재잠금
            await h.rerender({ heaterFeedback: 80, elapsed: 130, liveBt: 111, afterTurningPoint: true });
            expect(h.writeHeater).toHaveBeenCalledWith(60);
            await h.rerender({ heaterFeedback: 50, elapsed: 131, liveBt: 111, afterTurningPoint: true });
            await h.rerender({ heaterFeedback: 50, elapsed: 132, liveBt: 111, afterTurningPoint: true });
            await h.rerender({ heaterFeedback: 50, elapsed: 133, liveBt: 111, afterTurningPoint: true });
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('controlDiverged');
            expect(h.get().locked).toBe(true);
            h.unmount();
        });

        it('경계값: 이탈이 정확히 tolerance(수렴 잔차+노이즈 최악 정상치)면 중지하지 않는다', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 78, elapsed: 10 });
            await h.rerender({ heaterFeedback: 78, elapsed: 11 });
            await h.rerender({ heaterFeedback: 78, elapsed: 12 });
            await h.rerender({ heaterFeedback: 78, elapsed: 13 });
            expect(h.get().active).toBe(true);
            h.unmount();
        });

        it('settling(지시 미수렴) 동안은 판정하지 않는다 — 그 구간은 unacknowledged 경로가 잡는다', async () => {
            // 쓰기 직후 기기가 램프하는 동안 실측은 당연히 지시와 다르다. 이 창에서
            // 기기가 끝내 안 따라오면 STALE_COMMAND_POLLS(10폴) → 'unacknowledged'가
            // 중지시킨다. 두 경로가 시간축을 빈틈없이 나눈다.
            const h = await armed();
            await h.rerender({ heaterFeedback: 20, heaterPending: true, elapsed: 10 });
            await h.rerender({ heaterFeedback: 20, heaterPending: true, elapsed: 11 });
            await h.rerender({ heaterFeedback: 20, heaterPending: true, elapsed: 12 });
            await h.rerender({ heaterFeedback: 20, heaterPending: true, elapsed: 13 });
            expect(h.get().active).toBe(true);
            h.unmount();
        });

        it('일시 이탈 후 복귀하면 카운트가 리셋된다', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 10 });
            await h.rerender({ heaterFeedback: 50, elapsed: 11 });
            await h.rerender({ heaterFeedback: 80, elapsed: 12 }); // 복귀 → 리셋
            await h.rerender({ heaterFeedback: 50, elapsed: 13 });
            await h.rerender({ heaterFeedback: 50, elapsed: 14 });
            expect(h.get().active).toBe(true);
            h.unmount();
        });

        it('이탈 후보 1~2틱째에는 이벤트를 쓰지 않는다 — 확정 대기 중 개입 덮어쓰기 회귀', async () => {
            // 1틱째에 다음 BT 이벤트(110°→60%) 조건이 같이 성립해도 보류해야 한다.
            // 여기서 쓰면 개입을 덮는 동시에 lastWritten·pending으로 판정이 리셋된다.
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 130, liveBt: 111, afterTurningPoint: true });
            expect(h.writeHeater).not.toHaveBeenCalled();
            await h.rerender({ heaterFeedback: 50, elapsed: 131, liveBt: 111, afterTurningPoint: true });
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(true); // 아직 확정 전 — 보류 상태
            await h.rerender({ heaterFeedback: 50, elapsed: 132, liveBt: 111, afterTurningPoint: true });
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('controlDiverged');
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        });

        it('노이즈로 판명되면(복귀) 보류했던 이벤트를 따라잡는다', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 130, liveBt: 111, afterTurningPoint: true });
            await h.rerender({ heaterFeedback: 50, elapsed: 131, liveBt: 111, afterTurningPoint: true });
            expect(h.writeHeater).not.toHaveBeenCalled();
            // 실측 복귀 → 카운터 리셋 → 밀린 이벤트 catch-up
            await h.rerender({ heaterFeedback: 80, elapsed: 132, liveBt: 111, afterTurningPoint: true });
            expect(h.get().active).toBe(true);
            expect(h.writeHeater).toHaveBeenCalledWith(60);
            h.unmount();
        });

        it('이탈 확정 커밋에 이벤트 발화 조건이 같이 와도 쓰지 않는다 — stale write 회귀', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 10 });
            await h.rerender({ heaterFeedback: 50, elapsed: 11 });
            // 3번째 틱 + 다음 BT 이벤트(110°→60%) 발화 조건 동시 성립
            await h.rerender({ heaterFeedback: 50, elapsed: 130, liveBt: 111, afterTurningPoint: true });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        });

        it('reconnecting 동안은 카운트가 멈춘다 — 동결 실측 1샘플로 확정하지 않는다', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 10 }); // 1틱
            // 재연결 대기 — 실측 동결, elapsed만 흐른다
            await h.rerender({ heaterFeedback: 50, elapsed: 11, reconnecting: true });
            await h.rerender({ heaterFeedback: 50, elapsed: 12, reconnecting: true });
            await h.rerender({ heaterFeedback: 50, elapsed: 13, reconnecting: true });
            expect(h.get().active).toBe(true); // 정지 중 확정 금지 (리셋도 아님)
            // 복구 후 새 샘플로 이어 센다 — 2·3틱째
            await h.rerender({ heaterFeedback: 50, elapsed: 14 });
            await h.rerender({ heaterFeedback: 50, elapsed: 15 });
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('controlDiverged');
            h.unmount();
        });

        it('새 배치가 시작되면 이탈 상태(카운터·기준·사유)가 초기화된다', async () => {
            const h = await armed();
            await h.rerender({ heaterFeedback: 50, elapsed: 10 });
            await h.rerender({ heaterFeedback: 50, elapsed: 11 });
            await h.rerender({ heaterFeedback: 50, elapsed: 12 });
            expect(h.get().stopReason).toBe('controlDiverged');
            expect(h.get().locked).toBe(true);
            // 배출 → 종료 → 새 배치 차지
            await h.rerender({ heaterFeedback: 50, elapsed: 20, roastFinished: true, roasting: false });
            await h.rerender({ heaterFeedback: 80, elapsed: 0 });
            expect(h.get().locked).toBe(false);
            h.writeHeater.mockClear();
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(true);
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            h.unmount();
        });
    });

    it('heater 기록이 없는 레퍼런스(합성)에서는 available=false, 토글해도 켜지지 않는다', async () => {
        const h = await renderReplay({ referencePoints: POINTS.map((p) => ({ ...p, heater: null })) });
        expect(h.get().available).toBe(false);
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('다른 기종 기록(machine mismatch)이면 available=false, 토글해도 켜지지 않는다', async () => {
        const h = await renderReplay({ referenceMachineMismatch: true });
        expect(h.get().available).toBe(false);
        expect(h.get().machineMismatch).toBe(true);
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });
    it('elapsed가 크게 점프하면(webview 스로틀 복귀) 밀린 이벤트를 쓰지 않고 timingGap으로 멈춘다 (#313)', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        await h.rerender({ liveBt: 150, elapsed: 30 });
        // 5분 동안 JS가 멈췄다 — 복귀 렌더는 TP 확정·BT 도달 상태지만 write 없이 중지
        await h.jump({ liveBt: 160, elapsed: 330, afterTurningPoint: true });
        expect(h.writeHeater).not.toHaveBeenCalled();
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('timingGap');
        // 사람이 다시 켜면 남은 이벤트부터 이어간다
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(40);
        h.unmount();
    });

    it('lookback 자동 차지로 elapsed가 0보다 크게 시작해도 오중지하지 않는다', async () => {
        const h = await renderReplay({ roasting: false, elapsed: 0 });
        await h.rerender({ roasting: true, elapsed: 45 });
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.get().stopReason).toBeNull();
        h.unmount();
    });
    it('/control 실패 시 이벤트를 소진하지 않고 writeFailed로 멈춘다 — 재개하면 같은 이벤트부터 (#312)', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        h.writeHeater.mockResolvedValueOnce(false);
        await h.rerender({ liveBt: 111, elapsed: 130, afterTurningPoint: true });
        expect(h.writeHeater).toHaveBeenCalledTimes(1);
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('writeFailed');
        // 실측이 우연히 목표와 같아도 실패는 숨겨지지 않는다 — 다시 켜면 60부터 재발화
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenLastCalledWith(60);
        expect(h.get().nextEvent?.heater).toBe(40);
        h.unmount();
    });

    it('write 응답 대기 중 새 샘플은 같은 이벤트를 다시 쓰지 않는다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        let resolve!: (ok: boolean) => void;
        h.writeHeater.mockImplementationOnce(() => new Promise<boolean>((r) => (resolve = r)));
        await h.rerender({ liveBt: 111, elapsed: 130, afterTurningPoint: true });
        await h.rerender({ liveBt: 112, elapsed: 131, afterTurningPoint: true });
        expect(h.writeHeater).toHaveBeenCalledTimes(1);
        await act(async () => resolve(true));
        expect(h.get().nextEvent?.heater).toBe(40);
        h.unmount();
    });
});
