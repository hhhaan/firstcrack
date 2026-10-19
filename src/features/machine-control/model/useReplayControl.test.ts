// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { type ControlCommand, createControlSender } from '../lib/controlSender';
import type { ReplayPoint } from '../lib/replay';
import { type ReplayControlInputs, useReplayControl } from './useReplayControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// TP: t=60/bt=95. 이벤트: t=0 h=80(시간), t=120 bt=110 h=60(BT), t=300 bt=155 h=40(BT)
const POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heaterSet: 80 },
    { t: 60, bt: 95, heaterSet: 80 },
    { t: 120, bt: 110, heaterSet: 60 },
    { t: 300, bt: 155, heaterSet: 40 },
    { t: 600, bt: 205, heaterSet: 40 },
];

const BASE: Omit<ReplayControlInputs, 'writeHeater' | 'cancelUnsentHeater'> = {
    referencePoints: POINTS,
    referenceMachineMismatch: false,
    referenceDropTime: null,
    liveBt: 180,
    elapsed: 0,
    roasting: true,
    confirmedTurningPoint: null,
    heaterWritable: true,
    pidEngaged: false,
    roastFinished: false,
    sidecarConnected: true,
    safeOffUnacknowledged: false,
    dropBehavior: 'hold',
    reconnecting: false,
    observationQuality: 'valid',
};

/** repo 표준 패턴 — 실제 훅을 렌더해 반환값을 노출한다 */
const renderReplay = async (initial: Partial<ReplayControlInputs> = {}) => {
    const writeHeater = vi.fn(async (value: number): Promise<number | null> => value);
    const cancelUnsentHeater = vi.fn();
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof useReplayControl>;
    const Probe = ({ inputs }: { inputs: Partial<ReplayControlInputs> }) => {
        latest = useReplayControl({ ...BASE, writeHeater, cancelUnsentHeater, ...inputs });
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
    return {
        get: () => latest,
        rerender,
        jump,
        writeHeater,
        cancelUnsentHeater,
        unmount: () => act(() => root.unmount()),
    };
};

describe('192°C gas cutoff across batches', () => {
    it('stops without consuming gas-off when the writer acknowledges a nonzero setting', async () => {
        const h = await renderReplay({
            referencePoints: [],
            profileHeaterEvents: [{ t: 0, bt: 192, heater: 0, trigger: 'time' }],
        });
        try {
            h.writeHeater.mockResolvedValue(1);
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(0);
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('writeFailed');
            expect(h.get().firedCount).toBe(0);
            h.writeHeater.mockClear().mockResolvedValue(0);
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(0);
            expect(h.get().firedCount).toBe(1);
        } finally {
            h.unmount();
        }
    });

    it('fires zero after crossing 192°C, including recovery from a rejected sample in later batches', async () => {
        const source = {
            referencePoints: [],
            profileHeaterEvents: [
                { t: 0, bt: 180, heater: 80, trigger: 'time' },
                { t: 600, bt: 192, heater: 0, trigger: 'bt' },
            ],
            elapsed: 130,
            liveBt: 191.8,
            confirmedTurningPoint: {},
        };
        const h = await renderReplay(source);
        try {
            for (let batch = 0; batch < 3; batch += 1) {
                if (batch > 0) {
                    await h.rerender({ ...source, roasting: false, roastFinished: true });
                    await h.rerender({ ...source, roasting: true, roastFinished: false });
                }
                await act(async () => h.get().toggle());
                expect(h.writeHeater).toHaveBeenLastCalledWith(80);
                const before = h.writeHeater.mock.calls.length;
                await h.rerender({ ...source, elapsed: 131, liveBt: 192.2, observationQuality: 'spike' });
                expect(h.writeHeater).toHaveBeenCalledTimes(before);
                await h.rerender({ ...source, elapsed: 132, liveBt: 192.3, observationQuality: 'valid' });
                expect(h.writeHeater).toHaveBeenLastCalledWith(0);
                expect(h.get().firedCount).toBe(2);
                await h.rerender({ ...source, elapsed: 133, liveBt: 192.4 });
                expect(h.writeHeater).toHaveBeenCalledTimes(before + 1);
            }
        } finally {
            h.unmount();
        }
    });
});

describe('stored reference TP', () => {
    it.each([false, true])('stops on a reference boundary change with savedOnly=%s', async (savedOnly) => {
        const source = savedOnly
            ? {
                  referencePoints: [],
                  profileHeaterEvents: [
                      { t: 0, bt: 180, heater: 80 },
                      { t: 120, bt: 110, heater: 60 },
                      { t: 300, bt: 155, heater: 40 },
                  ],
              }
            : {};
        const h = await renderReplay({ ...source, referenceTpTime: 120, elapsed: 130, liveBt: 100 });
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenLastCalledWith(60);
        expect(h.get().nextEventTrigger).toBe('bt');
        h.writeHeater.mockClear();

        await h.rerender({ ...source, referenceTpTime: 60, elapsed: 130, liveBt: 100 });
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('profileChanged');
        expect(h.get().tpTime).toBe(60);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });
});

describe('Replay state restored on Drop cancel', () => {
    it.each([true, false])('restores the prior On/Off state: %s', async (wasActive) => {
        const h = await renderReplay({ dropBehavior: 'zero' });
        if (wasActive) await act(async () => h.get().toggle());
        await h.rerender({ roastFinished: true, roasting: false, dropBehavior: 'zero' });
        expect(h.get().active).toBe(false);
        h.writeHeater.mockClear();
        await act(async () => {
            h.get().restore(wasActive);
            await h.rerender({
                roastFinished: false,
                roasting: true,
                elapsed: 130,
                liveBt: 120,
                confirmedTurningPoint: {},
            });
        });
        expect(h.get().active).toBe(wasActive);
        if (wasActive) expect(h.writeHeater).toHaveBeenLastCalledWith(60);
        else expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('keeps safety guards when restoring On after a disconnection', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({ roastFinished: true, roasting: false });
        h.writeHeater.mockClear();
        await act(async () => {
            h.get().restore(true);
            await h.rerender({ roastFinished: false, roasting: true, sidecarConnected: false });
        });
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('disconnected');
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });
});

describe('useReplayControl', () => {
    it('profile confirmation after Drop preserves zero retries', async () => {
        const h = await renderReplay({ dropBehavior: 'zero' });
        await act(async () => h.get().toggle());
        await h.rerender({ dropBehavior: 'zero', roastFinished: true });
        expect(h.writeHeater).toHaveBeenLastCalledWith(0, 'safety');
        await act(async () => h.get().stop('profileChanged'));
        h.writeHeater.mockClear();
        await h.rerender({ dropBehavior: 'zero', roastFinished: true, safeOffUnacknowledged: true });
        expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
        h.unmount();
    });
    it('invalid observation cancels queued Replay heater without cancelling manual fan', async () => {
        let resolveFan!: (value: ControlCommand) => void;
        const send = vi.fn(async (value: ControlCommand) => value);
        send.mockImplementationOnce(
            () =>
                new Promise<ControlCommand>((resolve) => {
                    resolveFan = resolve;
                }),
        );
        const sender = createControlSender({ send });
        sender.queue('fan', 40);
        const fan = sender.commitNow('manual');
        const inputs: Partial<ReplayControlInputs> = {
            writeHeater: async (value) => {
                sender.queue('heater', value);
                return (await sender.commitNow('replay'))?.heater ?? null;
            },
            cancelUnsentHeater: () => {
                sender.cancelUnsent({ origin: 'replay', role: 'heater' });
            },
        };
        const h = await renderReplay(inputs);
        await act(async () => h.get().toggle());
        expect(send).toHaveBeenCalledTimes(1);
        await h.rerender({ ...inputs, observationQuality: 'stale', elapsed: 1 });
        await act(async () => {
            resolveFan({ fan: 40 });
            await fan;
        });
        expect(send).toHaveBeenCalledTimes(1);
        expect(h.get().active).toBe(true);
        expect(h.get().stopReason).toBeNull();
        expect(h.get().nextEvent?.heater).toBe(80);
        await h.rerender({ ...inputs, observationQuality: 'valid', elapsed: 2 });
        expect(send).toHaveBeenLastCalledWith({ heater: 80 });
        expect(h.get().nextEvent?.heater).toBe(60);
        h.unmount();
    });

    it.each([80, null])('invalid observations ignore late applied response %s', async (applied) => {
        let resolve!: (value: number | null) => void;
        const h = await renderReplay();
        h.writeHeater.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done;
                }),
        );
        await act(async () => h.get().toggle());
        await h.rerender({ observationQuality: 'poll_error', elapsed: 1 });
        await act(async () => resolve(applied));
        expect(h.get().active).toBe(true);
        expect(h.get().stopReason).toBeNull();
        expect(h.get().nextEvent?.heater).toBe(80);
        h.unmount();
    });

    it('healthy precharge observations keep armed Replay ready at Charge', async () => {
        const h = await renderReplay({ roasting: false, lastValidReceivedAtMs: 1_000, nowMs: 1_000 });
        await act(async () => h.get().toggle());
        for (const nowMs of [3_000, 5_000, 7_000, 9_000]) {
            await h.rerender({ roasting: false, lastValidReceivedAtMs: nowMs, nowMs });
        }
        await h.rerender({ roasting: true, lastValidReceivedAtMs: 10_000, nowMs: 10_000 });
        expect(h.get().active).toBe(true);
        expect(h.get().stopReason).toBeNull();
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.unmount();
    });

    it.each([{ heaterMax: 10 }, { heaterMin: 50 }])(
        'rejects an entire plan outside machine limits %j',
        async (limits) => {
            const h = await renderReplay(limits);
            expect(h.get().available).toBe(false);
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).not.toHaveBeenCalled();
            h.unmount();
        },
    );

    it('토글 ON 직후 시간 트리거 이벤트(t=0 초기 화력)가 발화한다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.unmount();
    });

    it('다음 이벤트 trigger는 판정 경로와 같다 — TP 이전/동일은 time, 이후는 bt', async () => {
        const pre = await renderReplay({
            referencePoints: [
                { t: 0, bt: 180, heaterSet: 80 },
                { t: 30, bt: 140, heaterSet: 70 },
                { t: 60, bt: 95, heaterSet: 70 },
                { t: 120, bt: 110, heaterSet: 60 },
            ],
        });
        await act(async () => pre.get().toggle());
        expect(pre.get().nextEvent?.heater).toBe(70);
        expect(pre.get().nextEventTrigger).toBe('time');
        pre.unmount();

        const atTp = await renderReplay({
            referencePoints: [
                { t: 0, bt: 180, heaterSet: 80 },
                { t: 60, bt: 95, heaterSet: 70 },
                { t: 120, bt: 110, heaterSet: 60 },
            ],
        });
        await act(async () => atTp.get().toggle());
        expect(atTp.get().nextEvent?.t).toBe(60);
        expect(atTp.get().nextEventTrigger).toBe('time');
        atTp.unmount();

        const post = await renderReplay();
        await act(async () => post.get().toggle());
        expect(post.get().nextEvent?.heater).toBe(60);
        expect(post.get().nextEventTrigger).toBe('bt');
        post.unmount();
    });

    it('TP 확정 후 레퍼런스 이벤트 BT 도달 시 발화하고, 하강 중에는 안 한다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();

        // 하강 중 bt=120 ≥ 이벤트 bt=110 이지만 TP 미확정 → 침묵
        await h.rerender({ liveBt: 120, elapsed: 30, confirmedTurningPoint: null });
        expect(h.writeHeater).not.toHaveBeenCalled();

        // TP 확정 + 도달 → 발화
        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        h.unmount();
    });

    it('fallback TP는 BT를 열지 않고, TIME은 이미 발화한 채 실감지 승격 후 BT가 나간다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.writeHeater.mockClear();

        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: true } });
        expect(h.writeHeater).not.toHaveBeenCalled();
        expect(h.get().active).toBe(true);
        expect(h.get().nextEvent?.t).toBe(120);
        expect(h.get().confirmedTurningPoint?.fallback).toBe(true);

        await h.rerender({ liveBt: 111, elapsed: 135, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        h.unmount();
    });

    it('reconnecting 동안은 이벤트를 소비하지 않는다 — 복구 후 밀린 이벤트를 한 번에 따라잡는다', async () => {
        // t=30 시간축 이벤트 — 링크 복구 대기 중 elapsed만 흐르는 동안 409로 버려지면 안 된다
        const pts: ReplayPoint[] = [
            { t: 0, bt: 180, heaterSet: 80 },
            { t: 30, bt: 140, heaterSet: 70 },
            { t: 60, bt: 95, heaterSet: 70 },
            { t: 300, bt: 155, heaterSet: 40 },
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

    it('Drop-zero retry signal does not stop ordinary Replay', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({ safeOffUnacknowledged: true });
        expect(h.get().active).toBe(true);
        expect(h.get().blocked).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalledWith(0, 'safety');
        h.unmount();
    });

    it('중지 조건과 새 샘플이 같은 커밋에 오면 쓰지 않는다 — stale write 회귀', async () => {
        // PID·연결·제어 권한은 새 liveBt와 같은 커밋에 바뀔 수 있다.
        // setActive(false)는 다음 렌더에나 반영되므로 판정 effect의 stopCause 가드가 막아야 한다.
        for (const cut of [{ pidEngaged: true }, { sidecarConnected: false }, { heaterWritable: false }]) {
            const h = await renderReplay();
            await act(async () => h.get().toggle()); // t=0 이벤트 발화
            h.writeHeater.mockClear();
            await h.rerender({ ...cut, liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
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
        await h.rerender({ liveBt: 160, elapsed: 400, confirmedTurningPoint: { fallback: false } });
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('stop(profileChanged)는 수동이 아니라 프로파일 변경 사유를 남긴다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await act(async () => h.get().stop('profileChanged'));
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('profileChanged');
        h.unmount();
    });

    it('수동 중지 후 다시 켜면 현재 레퍼런스 화력을 복원하고 이어간다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle()); // t=0 h=80, index=1
        h.writeHeater.mockClear();
        await act(async () => h.get().stop());

        // 다음 BT 이벤트(110°) 전에도 수동 화력을 현재 레퍼런스 값으로 복원한다.
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(80);
        h.writeHeater.mockClear();

        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledTimes(1);
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        expect(h.writeHeater).not.toHaveBeenCalledWith(80);
        h.unmount();
    });

    it.each([30, 50])('TP 이전 %s초 시작·재개는 마지막 시간 이벤트 하나만 적용한다', async (elapsed) => {
        const h = await renderReplay({
            elapsed,
            referencePoints: [
                { t: 15, bt: 160, heaterSet: 70 },
                { t: 45, bt: 110, heaterSet: 60 },
                { t: 60, bt: 95, heaterSet: 60 },
                { t: 120, bt: 110, heaterSet: 50 },
            ],
        });
        const expected = elapsed < 45 ? 70 : 60;
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(expected);
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(expected);
        h.unmount();
    });

    it.each([160, 140])('전체 소진 후 BT %s에서 재개하면 현재 조건으로 다시 맞춘다', async (liveBt) => {
        const inputs = { elapsed: 400, liveBt: 160, confirmedTurningPoint: { fallback: false } };
        const h = await renderReplay(inputs);
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(40);
        expect(h.get().nextEvent).toBeNull();
        await act(async () => h.get().stop());
        await h.rerender({ ...inputs, liveBt });
        h.writeHeater.mockClear();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(liveBt >= 155 ? 40 : 60);
        h.unmount();
    });

    it('재개 관측 보류 후 최신 BT로 동기화한다', async () => {
        const inputs = { elapsed: 200, liveBt: 120, confirmedTurningPoint: { fallback: false } };
        const h = await renderReplay(inputs);
        await act(async () => h.get().toggle());
        await act(async () => h.get().stop());
        h.writeHeater.mockClear();
        await h.rerender({ ...inputs, observationQuality: 'stale' });
        await act(async () => h.get().toggle());
        expect(h.writeHeater).not.toHaveBeenCalled();
        await h.rerender({ ...inputs, liveBt: 160, elapsed: 201 });
        expect(h.writeHeater).toHaveBeenCalledExactlyOnceWith(40);
        h.unmount();
    });

    it('첫 이벤트 이전에 시작·재개해도 화력을 쓰지 않는다', async () => {
        const h = await renderReplay({ referencePoints: POINTS.map((p) => ({ ...p, t: p.t + 15 })) });
        await act(async () => h.get().toggle());
        await act(async () => h.get().stop());
        await act(async () => h.get().toggle());
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('레퍼런스가 바뀌면 재생이 중지되고 인덱스가 초기화된다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        await h.rerender({
            referencePoints: [...POINTS.map((p) => ({ ...p, heaterSet: (p.heaterSet ?? 0) + 5 }))],
        });
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
            referencePoints: POINTS.map((p) => ({ ...p, heaterSet: (p.heaterSet ?? 0) + 5 })),
            liveBt: 160,
            elapsed: 400,
            confirmedTurningPoint: { fallback: false },
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
        await h.rerender({ liveBt: 210, elapsed: 650, confirmedTurningPoint: { fallback: false } });
        expect(h.get().nextEvent).toBeNull();
        // 배출 → 종료
        await h.rerender({
            liveBt: 210,
            elapsed: 660,
            confirmedTurningPoint: { fallback: false },
            roastFinished: true,
            roasting: false,
        });
        // 배치 2: 같은 레퍼런스로 새로 시작
        await h.rerender({ liveBt: 180, elapsed: 0, confirmedTurningPoint: null });
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
        await h.rerender({ liveBt: 210, elapsed: 650, confirmedTurningPoint: { fallback: false } });
        await h.rerender({
            liveBt: 210,
            elapsed: 660,
            confirmedTurningPoint: { fallback: false },
            roastFinished: true,
            roasting: false,
        });
        // 차지 전(standby/preheat)에 미리 켠다 — 하강 에지에서 index가 리셋됐어야 한다
        await h.rerender({ liveBt: 180, elapsed: 0, confirmedTurningPoint: null, roasting: false });
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        expect(h.get().nextEvent).not.toBeNull();
        expect(h.get().stopReason).toBeNull();
        h.unmount();
    });

    describe('배출 시 화력 정책 (#316) — pidDropBehavior 공용', () => {
        // 실제 흐름: Drop 마크 시점에 phase는 아직 'roasting'이다(endRoast까지 유지).
        const dropMarked = {
            liveBt: 205,
            elapsed: 650,
            confirmedTurningPoint: { fallback: false },
            roastFinished: true,
        };

        it('zero: 재생 중 배출되면 즉시 heater 0을 쓴다 — 반복 커밋에도 한 번만', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
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
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, safeOffUnacknowledged: true });
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
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
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, roasting: false, safeOffUnacknowledged: true });
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
            h.unmount();
        });

        it('zero: 새 배치가 시작되면 재시도를 멈춘다 — 이전 배치 정책이 새 배치 화력을 덮지 않는다', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, roasting: false });
            // 새 배치 차지
            await h.rerender({ dropBehavior: 'zero', liveBt: 180, elapsed: 0, confirmedTurningPoint: null });
            h.writeHeater.mockClear();
            await h.rerender({
                dropBehavior: 'zero',
                liveBt: 180,
                elapsed: 5,
                confirmedTurningPoint: null,
                safeOffUnacknowledged: true,
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
            await h.rerender({ dropBehavior: 'zero', ...dropMarked, safeOffUnacknowledged: true });
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
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
            h.unmount();
        });

        it('zero: Drop 언토글 후 unack이어도 0 재시도 없음 — 재개된 재생을 덮지 않는다', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({ dropBehavior: 'zero', ...dropMarked });
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
            expect(h.writeHeater).toHaveBeenCalledTimes(1);

            // un-drop. unack는 아직 false — 같은 커밋에서 retry effect가 stale safeOffIssued로
            // 한 번 더 쓰는 레이스를 피하고, 다음 렌더의 유지된 unack으로 재시도를 검증한다.
            await h.rerender({
                dropBehavior: 'zero',
                liveBt: 205,
                elapsed: 650,
                confirmedTurningPoint: { fallback: false },
                roastFinished: false,
            });
            h.writeHeater.mockClear();
            await h.rerender({
                dropBehavior: 'zero',
                liveBt: 205,
                elapsed: 651,
                confirmedTurningPoint: { fallback: false },
                roastFinished: false,
                safeOffUnacknowledged: true,
            });
            expect(h.writeHeater).not.toHaveBeenCalled();

            await h.rerender({
                dropBehavior: 'zero',
                liveBt: 205,
                elapsed: 652,
                confirmedTurningPoint: { fallback: false },
                roastFinished: false,
            });
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalled();
            expect(h.writeHeater).not.toHaveBeenCalledWith(0);
            expect(h.writeHeater).not.toHaveBeenCalledWith(0, 'safety');
            h.unmount();
        });
    });

    it('heater 기록이 없는 레퍼런스(합성)에서는 available=false, 토글해도 켜지지 않는다', async () => {
        const h = await renderReplay({
            referencePoints: POINTS.map((p) => ({ ...p, heater: p.heaterSet ?? 80, heaterSet: null })),
        });
        expect(h.get().available).toBe(false);
        expect(h.get().missingHeatSet).toBe(true);
        expect(h.get().referenceLoading).toBe(false);
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        h.unmount();
    });

    it('referencePoints null이면 로딩으로 보고 이전 계획을 쓰지 않는다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(true);
        h.writeHeater.mockClear();
        await h.rerender({ referencePoints: null });
        expect(h.get().active).toBe(false);
        expect(h.get().referenceLoading).toBe(true);
        expect(h.get().missingHeatSet).toBe(false);
        expect(h.get().available).toBe(false);
        expect(h.writeHeater).not.toHaveBeenCalled();
        await act(async () => h.get().toggle());
        expect(h.get().active).toBe(false);
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
        await h.jump({ liveBt: 160, elapsed: 330, confirmedTurningPoint: { fallback: false } });
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
        h.writeHeater.mockResolvedValueOnce(null);
        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
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

    describe('무효 관측 중 일반 이벤트 보류 (R05)', () => {
        const timePts: ReplayPoint[] = [
            { t: 0, bt: 180, heaterSet: 80 },
            { t: 30, bt: 140, heaterSet: 70 },
            { t: 60, bt: 95, heaterSet: 70 },
            { t: 300, bt: 155, heaterSet: 40 },
        ];

        it.each(['stale', 'null', 'spike', 'poll_error'] as const)(
            '%s + TIME 충족이어도 write 없고 index·active를 유지한다',
            async (quality) => {
                const h = await renderReplay({ referencePoints: timePts });
                await act(async () => h.get().toggle());
                expect(h.writeHeater).toHaveBeenCalledWith(80);
                await h.rerender({ referencePoints: timePts, elapsed: 26, liveBt: 150 });
                h.writeHeater.mockClear();
                await h.jump({
                    referencePoints: timePts,
                    elapsed: 31,
                    liveBt: 140,
                    observationQuality: quality,
                });
                expect(h.writeHeater).not.toHaveBeenCalled();
                expect(h.get().active).toBe(true);
                expect(h.get().observationHold).toBe(true);
                expect(h.get().nextEvent?.heater).toBe(70);
                h.unmount();
            },
        );

        it('null 관측 + BT 충족이어도 write 없다', async () => {
            const h = await renderReplay();
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({ liveBt: 100, elapsed: 125, confirmedTurningPoint: { fallback: false } });
            await h.jump({
                liveBt: 111,
                elapsed: 130,
                confirmedTurningPoint: { fallback: false },
                observationQuality: 'null',
            });
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(60);
            h.unmount();
        });

        it('무효 관측 중 elapsed 틱만으로 TIME을 쓰지 않는다', async () => {
            const h = await renderReplay({ referencePoints: timePts });
            await act(async () => h.get().toggle());
            await h.rerender({ referencePoints: timePts, elapsed: 25, liveBt: 150 });
            await h.rerender({
                referencePoints: timePts,
                elapsed: 25,
                liveBt: 150,
                observationQuality: 'stale',
            });
            h.writeHeater.mockClear();
            await h.rerender({
                referencePoints: timePts,
                elapsed: 31,
                liveBt: 150,
                observationQuality: 'stale',
            });
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().observationHold).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(70);
            h.unmount();
        });

        it('invalid 전환과 threshold가 같은 커밋이면 낡은 정상 상태로 쓰지 않는다', async () => {
            const h = await renderReplay({ referencePoints: timePts });
            await act(async () => h.get().toggle());
            await h.rerender({ referencePoints: timePts, elapsed: 26, liveBt: 150 });
            h.writeHeater.mockClear();
            await h.jump({
                referencePoints: timePts,
                elapsed: 30,
                liveBt: 140,
                observationQuality: 'stale',
            });
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(70);
            h.unmount();
        });

        it('정상 관측 복귀 후 밀린 이벤트를 catch-up하고 순서를 유지한다', async () => {
            const h = await renderReplay({ referencePoints: timePts });
            await act(async () => h.get().toggle());
            await h.rerender({ referencePoints: timePts, elapsed: 26, liveBt: 150 });
            await h.jump({
                referencePoints: timePts,
                elapsed: 31,
                liveBt: 140,
                observationQuality: 'stale',
            });
            expect(h.get().nextEvent?.heater).toBe(70);
            h.writeHeater.mockClear();
            await h.rerender({
                referencePoints: timePts,
                elapsed: 32,
                liveBt: 138,
                observationQuality: 'valid',
            });
            expect(h.writeHeater).toHaveBeenCalledWith(70);
            expect(h.get().observationHold).toBe(false);
            expect(h.get().active).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(40);
            h.unmount();
        });

        it('DROP zero는 무효 관측 gate에 막히지 않는다', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({
                dropBehavior: 'zero',
                liveBt: 205,
                elapsed: 650,
                confirmedTurningPoint: { fallback: false },
                roastFinished: true,
                observationQuality: 'stale',
            });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
            h.unmount();
        });

        it('DROP zero는 관측 없음(null)에도 막히지 않는다', async () => {
            const h = await renderReplay({ dropBehavior: 'zero' });
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({
                dropBehavior: 'zero',
                liveBt: 205,
                elapsed: 650,
                confirmedTurningPoint: { fallback: false },
                roastFinished: true,
                observationQuality: null,
            });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
            h.unmount();
        });

        it('관측 없음(null) + 이전 BT로 켜도 write 없다', async () => {
            const h = await renderReplay({ observationQuality: null, liveBt: 180, elapsed: 0 });
            await act(async () => h.get().toggle());
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(true);
            expect(h.get().observationHold).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(80);
            h.unmount();
        });

        it('unknown(null) 상태에서 elapsed만 흘러도 TIME을 쓰지 않는다', async () => {
            const h = await renderReplay({
                referencePoints: timePts,
                observationQuality: null,
                liveBt: 180,
            });
            await act(async () => h.get().toggle());
            await h.rerender({
                referencePoints: timePts,
                observationQuality: null,
                liveBt: 180,
                elapsed: 31,
            });
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(true);
            expect(h.get().observationHold).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(80);
            h.unmount();
        });

        it('장비/사이드카 generation 초기화(관측 null, 표시 BT 유지) 후 첫 valid에서만 발화한다', async () => {
            const h = await renderReplay({ referencePoints: timePts });
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            await h.rerender({ referencePoints: timePts, elapsed: 26, liveBt: 150 });
            h.writeHeater.mockClear();
            await h.jump({
                referencePoints: timePts,
                elapsed: 31,
                liveBt: 150,
                observationQuality: null,
            });
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().observationHold).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(70);
            await h.rerender({
                referencePoints: timePts,
                elapsed: 32,
                liveBt: 138,
                observationQuality: 'valid',
            });
            expect(h.writeHeater).toHaveBeenCalledWith(70);
            expect(h.get().observationHold).toBe(false);
            expect(h.get().active).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(40);
            h.unmount();
        });
    });

    it('write 응답 대기 중 새 샘플은 같은 이벤트를 다시 쓰지 않는다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        let resolve!: (applied: number | null) => void;
        h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolve = r)));
        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
        await h.rerender({ liveBt: 112, elapsed: 131, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledTimes(1);
        await act(async () => resolve(60));
        expect(h.get().nextEvent?.heater).toBe(40);
        h.unmount();
    });

    describe('중단된 실행의 늦은 응답 무효화 (#368 R02)', () => {
        it('write pending → OFF → 늦은 성공: OFF 유지, 재개해도 같은 이벤트를 다시 쓴다', async () => {
            const h = await renderReplay();
            let resolveWrite!: (applied: number | null) => void;
            h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBeNull();

            await act(async () => resolveWrite(80));
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBeNull();

            h.writeHeater.mockClear();
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(true);
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            expect(h.writeHeater).not.toHaveBeenCalledWith(60);
            h.unmount();
        });

        it('write pending → 수동 중단 → 늦은 실패: writeFailed가 manual을 덮지 않는다', async () => {
            const h = await renderReplay();
            let resolveWrite!: (applied: number | null) => void;
            h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
            await act(async () => h.get().toggle());
            await act(async () => h.get().stop());
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('manual');

            await act(async () => resolveWrite(null));
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('manual');
            h.unmount();
        });

        it('write pending → PID 중단 → 늦은 실패: writeFailed가 pid를 덮지 않는다', async () => {
            const h = await renderReplay();
            let resolveWrite!: (applied: number | null) => void;
            h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
            await act(async () => h.get().toggle());
            await h.rerender({ pidEngaged: true });
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('pid');

            await act(async () => resolveWrite(null));
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('pid');
            h.unmount();
        });

        it('write pending → PID 중단 → 늦은 성공: index를 소비하지 않는다', async () => {
            const h = await renderReplay();
            let resolveWrite!: (applied: number | null) => void;
            h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
            await act(async () => h.get().toggle());
            await h.rerender({ pidEngaged: true });
            expect(h.get().stopReason).toBe('pid');

            await act(async () => resolveWrite(80));
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('pid');

            await h.rerender({ pidEngaged: false });
            h.writeHeater.mockClear();
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            h.unmount();
        });

        it('OFF→ON 후 옛 응답이 새 요청의 writing을 해제하거나 index를 소비하지 않는다', async () => {
            const h = await renderReplay();
            let resolveOld!: (applied: number | null) => void;
            let resolveNew!: (applied: number | null) => void;
            h.writeHeater
                .mockImplementationOnce(() => new Promise<number | null>((r) => (resolveOld = r)))
                .mockImplementationOnce(() => new Promise<number | null>((r) => (resolveNew = r)));
            await act(async () => h.get().toggle());
            await act(async () => h.get().toggle());
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledTimes(2);
            expect(h.get().active).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(80);

            await act(async () => resolveOld(80));
            expect(h.get().active).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(80);

            await h.rerender({ liveBt: 180, elapsed: 1 });
            expect(h.writeHeater).toHaveBeenCalledTimes(2);

            await act(async () => resolveNew(80));
            expect(h.get().nextEvent?.heater).toBe(60);
            h.unmount();
        });

        it('현재 실행에서 정상 완료된 요청은 인덱스를 정확히 한 번 전진한다', async () => {
            const h = await renderReplay();
            let resolveWrite!: (applied: number | null) => void;
            h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
            await act(async () => h.get().toggle());
            expect(h.get().nextEvent?.heater).toBe(80);
            await h.rerender({ liveBt: 180, elapsed: 1 });
            expect(h.writeHeater).toHaveBeenCalledTimes(1);

            await act(async () => resolveWrite(80));
            expect(h.get().active).toBe(true);
            expect(h.get().nextEvent?.heater).toBe(60);

            await h.rerender({ liveBt: 180, elapsed: 2 });
            expect(h.writeHeater).toHaveBeenCalledTimes(1);
            expect(h.get().nextEvent?.heater).toBe(60);
            h.unmount();
        });
    });

    describe('중단 시 미전송 heater 취소 연결 (#368 R03)', () => {
        it('toggle OFF / 수동 / PID / 프로파일·배치에서 cancelUnsentHeater를 호출한다', async () => {
            const h = await renderReplay();
            await act(async () => h.get().toggle());
            h.cancelUnsentHeater.mockClear();
            await act(async () => h.get().toggle());
            expect(h.cancelUnsentHeater).toHaveBeenCalled();
            h.unmount();

            const manual = await renderReplay();
            await act(async () => manual.get().toggle());
            manual.cancelUnsentHeater.mockClear();
            await act(async () => manual.get().stop());
            expect(manual.cancelUnsentHeater).toHaveBeenCalled();
            manual.unmount();

            const pid = await renderReplay();
            await act(async () => pid.get().toggle());
            pid.cancelUnsentHeater.mockClear();
            await pid.rerender({ pidEngaged: true });
            expect(pid.cancelUnsentHeater).toHaveBeenCalled();
            pid.unmount();

            const profile = await renderReplay();
            await act(async () => profile.get().toggle());
            profile.cancelUnsentHeater.mockClear();
            await profile.rerender({
                referencePoints: [
                    { t: 0, bt: 180, heaterSet: 40 },
                    { t: 60, bt: 95, heaterSet: 40 },
                    { t: 300, bt: 155, heaterSet: 20 },
                ],
            });
            expect(profile.cancelUnsentHeater).toHaveBeenCalled();
            profile.unmount();

            const batch = await renderReplay();
            await act(async () => batch.get().toggle());
            batch.cancelUnsentHeater.mockClear();
            await batch.rerender({ roasting: false });
            expect(batch.cancelUnsentHeater).toHaveBeenCalled();
            batch.unmount();
        });
    });

    it('TP 미확정 119/120/121초에도 시간만으로 중지하지 않고 BT 이벤트를 보류한다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        h.writeHeater.mockClear();
        for (const elapsed of [119, 120, 121]) {
            await h.rerender({ liveBt: 180, elapsed, confirmedTurningPoint: null });
            expect(h.get().active).toBe(true);
            expect(h.get().stopReason).toBeNull();
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().nextEvent?.heater).toBe(60);
        }
        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        expect(h.get().active).toBe(true);
        h.unmount();
    });

    describe('장기 센서 공백 중단 (R06, 제안 정책 last-valid >5s)', () => {
        const LAST = 1_000;
        const timePts: ReplayPoint[] = [
            { t: 0, bt: 180, heaterSet: 80 },
            { t: 30, bt: 140, heaterSet: 70 },
            { t: 60, bt: 95, heaterSet: 70 },
            { t: 300, bt: 155, heaterSet: 40 },
        ];
        const clock = (nowMs: number, over: Partial<ReplayControlInputs> = {}): Partial<ReplayControlInputs> => ({
            referencePoints: timePts,
            lastValidReceivedAtMs: LAST,
            nowMs,
            ...over,
        });
        const recovered = (over: Partial<ReplayControlInputs> = {}) =>
            clock(LAST + 8_000, {
                observationQuality: 'valid',
                lastValidReceivedAtMs: LAST + 8_000,
                ...over,
            });

        it('elapsed가 흘러도 last-valid age가 5초이면 짧은 보류만 하고 중지하지 않는다', async () => {
            const h = await renderReplay(clock(LAST));
            await act(async () => h.get().toggle());
            expect(h.writeHeater).toHaveBeenCalledWith(80);
            h.writeHeater.mockClear();
            await h.rerender(clock(LAST + 5_000, { elapsed: 4, liveBt: 150, observationQuality: 'stale' }));
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(true);
            expect(h.get().observationHold).toBe(true);
            expect(h.get().stopReason).toBeNull();
            expect(h.get().nextEvent?.heater).toBe(70);
            h.unmount();
        });

        it('elapsed 진행 + last-valid age >5초이면 중지하고 index를 유지한다', async () => {
            const h = await renderReplay(clock(LAST));
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender(clock(LAST + 5_001, { elapsed: 6, liveBt: 150, observationQuality: 'stale' }));
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(false);
            expect(h.get().observationHold).toBe(false);
            expect(h.get().stopReason).toBe('observationStale');
            expect(h.writeHeater).not.toHaveBeenCalledWith(0);
            await h.rerender(recovered({ elapsed: 32, liveBt: 138 }));
            expect(h.get().active).toBe(false);
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(true);
            expect(h.writeHeater).toHaveBeenCalledWith(70);
            expect(h.writeHeater).not.toHaveBeenCalledWith(80);
            h.unmount();
        });

        it('새 센서 샘플이 없어도 elapsed 틱의 age로 중단한다 — 품질이 valid로 남아 있어도', async () => {
            const h = await renderReplay(clock(LAST));
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender(clock(LAST + 5_001, { elapsed: 6, liveBt: 150, observationQuality: 'valid' }));
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('observationStale');
            h.unmount();
        });

        it('첫 복구 sample이 last-valid를 갱신해도 catch-up write 전에 중단한다', async () => {
            const h = await renderReplay(clock(LAST));
            await act(async () => h.get().toggle());
            await h.rerender(clock(LAST, { elapsed: 26, liveBt: 150 }));
            h.writeHeater.mockClear();
            await h.rerender(recovered({ elapsed: 31, liveBt: 140 }));
            expect(h.writeHeater).not.toHaveBeenCalled();
            expect(h.get().active).toBe(false);
            expect(h.get().stopReason).toBe('observationStale');
            h.unmount();
        });

        it('정상 값이 돌아와도 자동 On되지 않고 stopCause가 있으면 재개도 막는다', async () => {
            const h = await renderReplay(clock(LAST));
            await act(async () => h.get().toggle());
            await h.rerender(clock(LAST + 5_001, { elapsed: 6, liveBt: 150, observationQuality: 'stale' }));
            expect(h.get().active).toBe(false);
            h.writeHeater.mockClear();
            await h.rerender(recovered({ elapsed: 8, liveBt: 150 }));
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).not.toHaveBeenCalled();
            await h.rerender(recovered({ elapsed: 8, liveBt: 150, pidEngaged: true }));
            await act(async () => h.get().toggle());
            expect(h.get().active).toBe(false);
            h.unmount();
        });

        it('same-commit stale + DROP zero는 0을 쓰고, stale만이면 쓰지 않는다', async () => {
            const dropOn = {
                dropBehavior: 'zero' as const,
                elapsed: 4,
                nowMs: 4_000,
                lastValidReceivedAtMs: 0,
                observationQuality: 'valid' as const,
            };
            const h = await renderReplay(dropOn);
            await act(async () => h.get().toggle());
            h.writeHeater.mockClear();
            await h.rerender({
                ...dropOn,
                elapsed: 6,
                nowMs: 6_000,
                liveBt: 205,
                confirmedTurningPoint: { fallback: false },
                roastFinished: true,
                observationQuality: 'stale',
            });
            expect(h.get().active).toBe(false);
            expect(h.writeHeater).toHaveBeenCalledWith(0, 'safety');
            h.unmount();

            const staleOnly = await renderReplay(clock(LAST));
            await act(async () => staleOnly.get().toggle());
            staleOnly.writeHeater.mockClear();
            await staleOnly.rerender(clock(LAST + 5_001, { elapsed: 6, liveBt: 150, observationQuality: 'stale' }));
            expect(staleOnly.writeHeater).not.toHaveBeenCalled();
            staleOnly.unmount();
        });
    });

    it('프로파일 heater_events가 TSV 추출보다 우선한다', async () => {
        const h = await renderReplay({
            profileHeaterEvents: [{ t: 0, bt: 180, heater: 90, trigger: 'time' }],
        });
        expect(h.get().source).toBe('profile');
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(90);
        h.unmount();
    });

    it('배치 편집은 재생을 끄지 않고 다음 이벤트부터 이어간다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.writeHeater.mockClear();
        await act(async () =>
            h.get().applyBatchEvents([
                { t: 0, bt: 180, heater: 80, trigger: 'time' },
                { t: 120, bt: 110, heater: 45, trigger: 'bt' },
            ]),
        );
        expect(h.get().active).toBe(true);
        expect(h.get().source).toBe('batch');
        expect(h.get().stopReason).toBeNull();
        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledWith(45);
        h.unmount();
    });

    it('실행한 행을 지우면 다음 미실행 스텝을 건너뛰지 않는다', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.writeHeater.mockClear();
        const rest = h.get().plan?.events.slice(1) ?? [];
        await act(async () => h.get().applyBatchEvents(rest));
        expect(h.get().active).toBe(true);
        expect(h.get().nextEvent?.heater).toBe(60);
        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        h.unmount();
    });

    it('already-acked heater edit does not re-write', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.writeHeater.mockClear();
        await act(async () =>
            h.get().applyBatchEvents([
                { t: 0, bt: 180, heater: 90, trigger: 'time' },
                { t: 120, bt: 110, heater: 60, trigger: 'bt' },
            ]),
        );
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).not.toHaveBeenCalled();
        expect(h.get().nextEvent?.heater).toBe(60);
        await h.rerender({ liveBt: 111, elapsed: 130, confirmedTurningPoint: { fallback: false } });
        expect(h.writeHeater).toHaveBeenCalledWith(60);
        expect(h.writeHeater).not.toHaveBeenCalledWith(90);
        h.unmount();
    });

    it('pending edit keeps in-flight success and then writes the new step', async () => {
        const h = await renderReplay();
        let resolveWrite!: (applied: number | null) => void;
        h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.cancelUnsentHeater.mockClear();
        await act(async () =>
            h.get().applyBatchEvents([
                { t: 0, bt: 180, heater: 80, trigger: 'time' },
                { t: 30, bt: 160, heater: 55, trigger: 'time' },
            ]),
        );
        expect(h.get().active).toBe(true);
        expect(h.cancelUnsentHeater).not.toHaveBeenCalled();
        await act(async () => resolveWrite(80));
        expect(h.get().active).toBe(true);
        expect(h.get().stopReason).toBeNull();
        expect(h.get().firedCount).toBe(1);
        h.writeHeater.mockClear();
        await h.rerender({ elapsed: 35, liveBt: 160 });
        expect(h.writeHeater).toHaveBeenCalledWith(55);
        expect(h.writeHeater).not.toHaveBeenCalledWith(80);
        h.unmount();
    });

    it('pending edit keeps in-flight failure and does not skip the failed step', async () => {
        const h = await renderReplay();
        let resolveWrite!: (applied: number | null) => void;
        h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.cancelUnsentHeater.mockClear();
        await act(async () =>
            h.get().applyBatchEvents([
                { t: 0, bt: 180, heater: 80, trigger: 'time' },
                { t: 30, bt: 160, heater: 55, trigger: 'time' },
            ]),
        );
        await act(async () => resolveWrite(null));
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('writeFailed');
        expect(h.get().firedCount).toBe(0);
        h.writeHeater.mockClear();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        expect(h.writeHeater).not.toHaveBeenCalledWith(55);
        h.unmount();
    });

    it('rejects a profile override that is not on the device step', async () => {
        const h = await renderReplay({
            heaterStep: 1,
            profileHeaterEvents: [{ t: 0, bt: 180, heater: 50.5, trigger: 'time' }],
        });
        expect(h.get().available).toBe(false);
        expect(h.get().overrideInvalid).toBe(true);
        h.unmount();
    });

    it('catch-up in-flight failure survives an unrelated pending edit', async () => {
        const h = await renderReplay();
        let resolveWrite!: (applied: number | null) => void;
        h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
        await act(async () =>
            h.get().applyBatchEvents([
                { t: 0, bt: 180, heater: 80, trigger: 'time' },
                { t: 0, bt: 175, heater: 70, trigger: 'time' },
                { t: 30, bt: 160, heater: 55, trigger: 'time' },
            ]),
        );
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        const inFlight = h.get().plan?.events.slice(0, 2) ?? [];
        await act(async () => h.get().applyBatchEvents([...inFlight, { t: 30, bt: 160, heater: 50, trigger: 'time' }]));
        await act(async () => resolveWrite(null));
        expect(h.get().active).toBe(false);
        expect(h.get().stopReason).toBe('writeFailed');
        expect(h.get().firedCount).toBe(0);
        h.writeHeater.mockClear();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        expect(h.writeHeater).not.toHaveBeenCalledWith(50);
        h.unmount();
    });

    it('catch-up in-flight success consumes result.nextIndex then writes the pending edit', async () => {
        const h = await renderReplay();
        let resolveWrite!: (applied: number | null) => void;
        h.writeHeater.mockImplementationOnce(() => new Promise<number | null>((r) => (resolveWrite = r)));
        await act(async () =>
            h.get().applyBatchEvents([
                { t: 0, bt: 180, heater: 80, trigger: 'time' },
                { t: 0, bt: 175, heater: 70, trigger: 'time' },
                { t: 30, bt: 160, heater: 55, trigger: 'time' },
            ]),
        );
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        const inFlight = h.get().plan?.events.slice(0, 2) ?? [];
        await act(async () => h.get().applyBatchEvents([...inFlight, { t: 30, bt: 160, heater: 50, trigger: 'time' }]));
        await act(async () => resolveWrite(80));
        expect(h.get().active).toBe(true);
        expect(h.get().firedCount).toBe(2);
        h.writeHeater.mockClear();
        await h.rerender({ elapsed: 35, liveBt: 160 });
        expect(h.writeHeater).toHaveBeenCalledWith(50);
        expect(h.writeHeater).not.toHaveBeenCalledWith(80);
        h.unmount();
    });

    it('insert before acked rows does not re-run them', async () => {
        const h = await renderReplay();
        await act(async () => h.get().toggle());
        expect(h.writeHeater).toHaveBeenCalledWith(80);
        h.writeHeater.mockClear();
        const events = h.get().plan?.events ?? [];
        await act(async () =>
            h.get().applyBatchEvents([{ id: 'new', t: 0, bt: 10, heater: 75, trigger: 'time' }, ...events]),
        );
        expect(h.get().active).toBe(true);
        expect(h.writeHeater).not.toHaveBeenCalled();
        expect(h.get().nextEvent?.heater).toBe(60);
        h.unmount();
    });
});
