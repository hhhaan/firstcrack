// @vitest-environment jsdom
/**
 * read≠write 기계 특성화 테스트 — 기센처럼 읽기(실측 duty)와 쓰기(세트포인트)가
 * 다른 레지스터인 기계에서, 실측이 세트포인트를 충실히 추종하지 못할 때 어떤 일이
 * 생기는지 useMachineControl + useReplayControl을 실제로 물려서 검증한다.
 *
 * 핵심 불변식(안전 바닥): 어떤 프로파일에서도 실패는 "재생 중지·write 중단" 방향이다.
 * 엉뚱한 화력이 추가로 나가는 경로는 없다 — setControl 호출 수로 박제한다.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    subscribeSidecarSettings: vi.fn(() => () => {}),
    sidecar: {
        getStatus: vi.fn(),
        setControl: vi.fn(),
        pidOn: vi.fn(),
        pidOff: vi.fn(),
        pidSetSv: vi.fn(),
    },
}));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));

import type { PidRuntime } from '@entities/machine';
import { sidecar } from '@shared/lib/sidecar';
import type { ReplayPoint } from '../lib/replay';
import type { MachineFeedback } from './useMachineControl';
import { useMachineControlComposition } from './useMachineControlComposition';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatus = vi.mocked(sidecar.getStatus);
const setControl = vi.mocked(sidecar.setControl);

// TP: t=60/bt=95. 이벤트: t=0 h=60(초기), t=120 bt=110 h=40(BT 트리거)
const POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heaterSet: 60 },
    { t: 60, bt: 95, heaterSet: 60 },
    { t: 120, bt: 110, heaterSet: 40 },
    { t: 600, bt: 205, heaterSet: 40 },
];

interface Sample {
    heater: number;
    liveBt?: number;
    confirmedTurningPoint?: { fallback?: boolean } | null;
}

const COARSE_POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heaterSet: 6 },
    { t: 60, bt: 95, heaterSet: 6 },
    { t: 120, bt: 110, heaterSet: 4 },
    { t: 600, bt: 205, heaterSet: 4 },
];

const runningPid = { state: 'running', sv: null, duty: null, pv: null, p: 0, i: 0, d: 0, error: null } as PidRuntime;

/** Production composition — the same hook ActiveRoast mounts above the panel. */
const renderRig = async (opts: { heaterMax?: number; points?: ReplayPoint[]; dropBehavior?: 'hold' | 'zero' } = {}) => {
    const heaterMax = opts.heaterMax ?? 100;
    const points = opts.points ?? POINTS;
    getStatus.mockReset();
    setControl.mockReset();
    getStatus.mockResolvedValue({
        control: { writable: true, limits: { heater: { min: 0, max: heaterMax } } },
    } as Awaited<ReturnType<typeof sidecar.getStatus>>);
    setControl.mockImplementation(async (cmd) => ({ applied: cmd }) as Awaited<ReturnType<typeof sidecar.setControl>>);

    const root = createRoot(document.createElement('div'));
    const committed = vi.fn();
    let latest!: ReturnType<typeof useMachineControlComposition>;
    interface Inputs {
        feedback: MachineFeedback;
        elapsed: number;
        liveBt: number;
        confirmedTurningPoint: { fallback?: boolean } | null;
        pidEngaged: boolean;
        roastFinished: boolean;
        dropBehavior: 'hold' | 'zero';
        roasting: boolean;
        points: ReplayPoint[];
    }
    const Probe = ({ inputs }: { inputs: Inputs }) => {
        latest = useMachineControlComposition({
            sidecarConnected: true,
            reconnecting: false,
            liveData: inputs.feedback,
            pidRuntime: inputs.pidEngaged ? runningPid : null,
            roastFinished: inputs.roastFinished,
            pidDropBehavior: inputs.dropBehavior,
            replayPoints: inputs.points,
            replayMachineMismatch: false,
            replayDropTime: null,
            liveBt: inputs.liveBt,
            elapsed: inputs.elapsed,
            roasting: inputs.roasting,
            confirmedTurningPoint: inputs.confirmedTurningPoint,
            observationQuality: 'valid',
            onCommitted: committed,
        });
        return null;
    };

    let elapsed = 0;
    let current: Inputs = {
        feedback: { heater: 30, fan: 0, drum: 0 },
        elapsed,
        liveBt: 180,
        confirmedTurningPoint: null,
        pidEngaged: false,
        roastFinished: false,
        dropBehavior: opts.dropBehavior ?? 'hold',
        roasting: true,
        points,
    };
    const render = (inputs: Inputs) => {
        current = inputs;
        elapsed = inputs.elapsed;
        return act(async () => root.render(createElement(Probe, { inputs })));
    };
    // 초기 렌더 + capability 로드 대기 (실측은 아직 idle 값)
    await render(current);

    return {
        get: () => ({ replay: latest.replay, mc: latest.machine }),
        committed,
        toggle: () => act(async () => latest.replay.toggle()),
        /** 1폴 = 1초 진행 — 기계가 보고한 실측 한 샘플을 먹인다 */
        poll: (s: Sample) =>
            render({
                ...current,
                feedback: { heater: s.heater, fan: 0, drum: 0 },
                elapsed: elapsed + 1,
                liveBt: s.liveBt ?? 180,
                confirmedTurningPoint: s.confirmedTurningPoint ?? null,
            }),
        update: (partial: Partial<Inputs>) => render({ ...current, ...partial }),
        unmount: () => act(() => root.unmount()),
    };
};

const heaterWrites = () => setControl.mock.calls.map(([cmd]) => cmd.heater);

describe('read≠write 기계 프로파일 특성화', () => {
    it('양자화 기계(5% 스텝, 60→55 보고): 미반영 경로가 10폴에 멈춘다 — 추가 write 없음', async () => {
        const rig = await renderRig();
        await rig.toggle(); // t=0 이벤트 → 60 전송
        expect(heaterWrites()).toEqual([60]);

        for (let i = 0; i < 10; i++) await rig.poll({ heater: 55 });

        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().replay.stopReason).toBe('unacknowledged');
        // 수렴 실패 동안 heaterPending이 참이라 controlDiverged는 열리지도 않는다 —
        // 두 경로가 겹치지 않고, 어느 쪽이든 결과는 "중지"다.
        expect(heaterWrites()).toEqual([60]); // 안전 바닥: 이후 write 없음
        rig.unmount();
    });

    it('느린 슬루 기계(1%/폴, 30→60 추종 중): 도달 전에 미반영으로 멈춘다 — 특성 문서화', async () => {
        // 특성: 점프 폭이 크고 슬루가 ~3%/폴보다 느리면 명령이 사실 먹혔어도
        // 10폴 안에 ±1로 못 들어와 false unack이 난다. 이런 기계가 실기에서
        // 확인되면 그 기계 한정으로 CONVERGE_TOLERANCE(및 유도된 이탈 허용치)를 넓힌다.
        const rig = await renderRig();
        await rig.toggle();

        for (let i = 1; i <= 10; i++) await rig.poll({ heater: 30 + i }); // 31..40

        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().replay.stopReason).toBe('unacknowledged');
        expect(heaterWrites()).toEqual([60]);
        rig.unmount();
    });

    it('지속 변조 기계(수렴 후 ±3 사이클링): controlDiverged 오탐 — 단 중지·무write로만 실패', async () => {
        const rig = await renderRig();
        await rig.toggle();

        await rig.poll({ heater: 60 }); // 수렴 — desired 폐기, 판정 개방
        await rig.poll({ heater: 63 }); // |63-60|=3 > 2 → 1틱
        await rig.poll({ heater: 57 }); // 2틱
        await rig.poll({ heater: 63 }); // 3틱 → 확정

        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().replay.stopReason).toBe('controlDiverged');
        expect(heaterWrites()).toEqual([60]); // 안전 바닥: 오탐이어도 write는 없다
        // 잠금 없음 — 사람이 토글하면 즉시 재개 가능 (오탐 비용 = 클릭 한 번)
        expect(rig.get().replay.blocked).toBe(false);
        rig.unmount();
    });

    it('정상 기계(±1 노이즈): 어떤 검사도 걸리지 않고 다음 이벤트까지 재생된다', async () => {
        const rig = await renderRig();
        await rig.toggle();

        await rig.poll({ heater: 60 }); // 수렴
        await rig.poll({ heater: 59 });
        await rig.poll({ heater: 61 });
        await rig.poll({ heater: 59 }); // 전부 허용 오차(2) 이내 — 이탈 카운트 0
        expect(rig.get().replay.active).toBe(true);

        // TP 확정 + BT 도달 → 다음 이벤트(40) 정상 발화
        await rig.poll({ heater: 60, liveBt: 111, confirmedTurningPoint: { fallback: false } });
        expect(heaterWrites()).toEqual([60, 40]);
        expect(rig.committed.mock.calls.map(([cmd]) => cmd.heater)).toEqual([60, 40]);
        expect(rig.get().replay.active).toBe(true);
        rig.unmount();
    });

    it('max=10: 수렴 잔차 1스텝(6→5)은 추종 — controlDiverged로 멈추지 않는다', async () => {
        const rig = await renderRig({ heaterMax: 10, points: COARSE_POINTS });
        await rig.toggle();
        expect(heaterWrites()).toEqual([6]);

        await rig.poll({ heater: 5 }); // |5-6|=1 → 수렴, pending 해제
        await rig.poll({ heater: 5 });
        await rig.poll({ heater: 5 });
        await rig.poll({ heater: 5 });

        expect(rig.get().replay.active).toBe(true);
        expect(rig.get().replay.stopReason).toBeNull();
        expect(heaterWrites()).toEqual([6]);
        rig.unmount();
    });

    it('max=10: 수렴 후 2스텝 손 조작은 controlDiverged (#428)', async () => {
        const rig = await renderRig({ heaterMax: 10, points: COARSE_POINTS });
        await rig.toggle();
        await rig.poll({ heater: 6 });
        await rig.poll({ heater: 8 });
        await rig.poll({ heater: 8 });
        expect(rig.get().replay.active).toBe(true);
        await rig.poll({ heater: 8 });
        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().replay.stopReason).toBe('controlDiverged');
        expect(heaterWrites()).toEqual([6]);
        rig.unmount();
    });
});

describe('겹친 commit 실제 전송 결과 (#368 R01)', () => {
    it('fan 전송 중 Replay heater 실패는 실제 응답 전에 index를 소비하지 않는다', async () => {
        const rig = await renderRig();
        const pending: Array<{
            cmd: Parameters<typeof sidecar.setControl>[0];
            resolve: (value: Awaited<ReturnType<typeof sidecar.setControl>>) => void;
            reject: (err: unknown) => void;
        }> = [];
        setControl.mockImplementation(
            (cmd) =>
                new Promise((resolve, reject) => {
                    pending.push({ cmd, resolve, reject });
                }),
        );

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);

        await rig.toggle();
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);
        expect(rig.get().replay.active).toBe(true);
        expect(rig.get().replay.nextEvent?.heater).toBe(60);

        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }, { heater: 60 }]);
        expect(rig.get().replay.active).toBe(true);
        expect(rig.get().replay.nextEvent?.heater).toBe(60);

        pending[1].reject(new Error('heater write failed'));
        await act(async () => {
            await Promise.resolve();
        });
        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().replay.stopReason).toBe('writeFailed');
        expect(setControl.mock.calls.map(([cmd]) => cmd)).toEqual([{ fan: 80 }, { heater: 60 }]);

        await rig.toggle();
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }, { heater: 60 }, { heater: 60 }]);
        pending[2].resolve({ ok: true, applied: { heater: 60 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(rig.get().replay.active).toBe(true);
        expect(rig.get().replay.nextEvent?.heater).toBe(40);
        rig.unmount();
    });
});

const deferControl = () => {
    const pending: Array<{
        cmd: Parameters<typeof sidecar.setControl>[0];
        resolve: (value: Awaited<ReturnType<typeof sidecar.setControl>>) => void;
        reject: (err: unknown) => void;
    }> = [];
    setControl.mockImplementation(
        (cmd) =>
            new Promise((resolve, reject) => {
                pending.push({ cmd, resolve, reject });
            }),
    );
    return pending;
};

describe('중단 시 미전송 Replay heater 취소 (#368 R03)', () => {
    it('fan 전송 중 Replay heater 대기 → OFF → fan 완료: heater는 보내지 않는다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);

        await rig.toggle();
        expect(rig.get().replay.active).toBe(true);
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);

        await rig.toggle();
        expect(rig.get().replay.active).toBe(false);

        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);
        expect(setControl.mock.calls.map(([cmd]) => cmd)).toEqual([{ fan: 80 }]);
        rig.unmount();
    });

    it('혼합 snapshot에서 fan만 교체한 뒤 OFF는 Replay heater를 안 보내고 manual fan은 보낸다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('drum', 10);
            void rig.get().mc.commitNow();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ drum: 10 }]);

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
        });
        await rig.toggle();
        expect(rig.get().replay.active).toBe(true);
        expect(pending.map((p) => p.cmd)).toEqual([{ drum: 10 }]);

        await act(async () => {
            rig.get().mc.setValue('fan', 90);
            void rig.get().mc.commitNow();
        });
        expect(rig.get().replay.active).toBe(true);
        expect(rig.get().replay.stopReason).not.toBe('writeFailed');

        await rig.toggle();
        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().mc.desired.heater).toBeUndefined();
        expect(rig.get().mc.desired.fan).toBe(90);

        pending[0].resolve({ ok: true, applied: { drum: 10 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ drum: 10 }, { fan: 90 }]);
        expect(pending.some((p) => p.cmd.heater === 60)).toBe(false);

        pending[1].resolve({ ok: true, applied: { fan: 90 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(setControl.mock.calls.map(([cmd]) => cmd)).toEqual([{ drum: 10 }, { fan: 90 }]);
        rig.unmount();
    });

    it('혼합 Replay snapshot을 직접 취소해도 fan/drum은 남긴다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('heater', 10);
            void rig.get().mc.commitNow();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ heater: 10 }]);

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            rig.get().mc.setValue('drum', 40);
            rig.get().mc.setValue('heater', 50);
            void rig.get().mc.commitNow('replay');
        });

        await act(async () => {
            rig.get().mc.cancelUnsentReplayHeater();
        });
        expect(rig.get().mc.desired.heater).toBeUndefined();
        expect(rig.get().mc.desired.fan).toBe(80);
        expect(rig.get().mc.desired.drum).toBe(40);

        pending[0].resolve({ ok: true, applied: { heater: 10 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ heater: 10 }, { fan: 80, drum: 40 }]);
        expect(pending.some((p) => p.cmd.heater === 50)).toBe(false);

        pending[1].resolve({ ok: true, applied: { fan: 80, drum: 40 } });
        await act(async () => {
            await Promise.resolve();
        });
        rig.unmount();
    });

    it('취소된 Replay heater는 desired에 남아 미반영으로 막지 않는다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        await rig.toggle();
        expect(rig.get().mc.desired.heater).toBe(60);

        await rig.toggle();
        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().mc.desired.heater).toBeUndefined();
        expect(rig.get().replay.blocked).toBe(false);

        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        await rig.toggle();
        expect(rig.get().replay.active).toBe(true);
        rig.unmount();
    });

    it('같은 상황에서 수동 heater commit은 보존되어 전송된다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        await rig.toggle();
        await rig.toggle();
        expect(rig.get().replay.active).toBe(false);

        await act(async () => {
            rig.get().mc.setValue('heater', 70);
            void rig.get().mc.commitNow();
        });

        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }, { heater: 70 }]);

        pending[1].resolve({ ok: true, applied: { heater: 70 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(setControl.mock.calls.map(([cmd]) => cmd)).toEqual([{ fan: 80 }, { heater: 70 }]);
        rig.unmount();
    });

    it('fan/drum과 DROP zero는 Replay 취소에 휩쓸리지 않는다', async () => {
        const rig = await renderRig({ dropBehavior: 'zero' });
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        await act(async () => {
            rig.get().mc.setValue('drum', 40);
            void rig.get().mc.commitNow();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);

        await rig.toggle();
        await rig.update({ roastFinished: true, dropBehavior: 'zero' });
        expect(rig.get().replay.active).toBe(false);

        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }, { drum: 40, heater: 0 }]);
        expect(pending.some((p) => p.cmd.heater === 60)).toBe(false);

        pending[1].resolve({ ok: true, applied: { drum: 40, heater: 0 } });
        await act(async () => {
            await Promise.resolve();
        });
        rig.unmount();
    });

    it('취소 결과가 manual/PID 사유를 writeFailed로 바꾸지 않는다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        await rig.toggle();
        await act(async () => rig.get().replay.stop());
        expect(rig.get().replay.stopReason).toBe('manual');

        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(rig.get().replay.stopReason).toBe('manual');
        expect(pending.some((p) => p.cmd.heater === 60)).toBe(false);

        const pidRig = await renderRig();
        const pidPending = deferControl();
        await act(async () => {
            pidRig.get().mc.setValue('fan', 80);
            void pidRig.get().mc.commitNow();
        });
        await pidRig.toggle();
        await pidRig.update({ pidEngaged: true });
        expect(pidRig.get().replay.stopReason).toBe('pid');

        pidPending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pidRig.get().replay.stopReason).toBe('pid');
        expect(pidPending.some((p) => p.cmd.heater === 60)).toBe(false);
        pidRig.unmount();
        rig.unmount();
    });

    it('이미 전송된 Replay heater는 취소됐다고 표시하지 않는다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await rig.toggle();
        expect(pending.map((p) => p.cmd)).toEqual([{ heater: 60 }]);
        expect(rig.get().replay.nextEvent?.heater).toBe(60);

        await rig.toggle();
        expect(rig.get().replay.active).toBe(false);
        expect(pending).toHaveLength(1);

        pending[0].resolve({ ok: true, applied: { heater: 60 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().replay.stopReason).not.toBe('writeFailed');
        await rig.toggle();
        expect(rig.get().replay.nextEvent?.heater).toBe(60);
        rig.unmount();
    });

    it('프로파일 교체 경계에서 미전송 Replay heater는 보내지 않는다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        await rig.toggle();
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);

        await rig.update({
            points: [
                { t: 0, bt: 180, heaterSet: 40 },
                { t: 60, bt: 95, heaterSet: 40 },
                { t: 300, bt: 155, heaterSet: 20 },
            ],
        });
        expect(rig.get().replay.active).toBe(false);
        expect(rig.get().replay.stopReason).toBe('profileChanged');

        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);
        rig.unmount();
    });

    it('배치 경계에서 미전송 Replay heater는 보내지 않는다', async () => {
        const rig = await renderRig();
        const pending = deferControl();

        await act(async () => {
            rig.get().mc.setValue('fan', 80);
            void rig.get().mc.commitNow();
        });
        await rig.toggle();

        await rig.update({ roasting: false });
        pending[0].resolve({ ok: true, applied: { fan: 80 } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(pending.map((p) => p.cmd)).toEqual([{ fan: 80 }]);
        expect(pending.some((p) => p.cmd.heater === 60)).toBe(false);
        rig.unmount();
    });
});
