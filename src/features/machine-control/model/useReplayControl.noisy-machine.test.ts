// @vitest-environment jsdom
/**
 * read≠write 기계 특성화 테스트 — 기센처럼 읽기(실측 duty)와 쓰기(세트포인트)가
 * 다른 레지스터인 기계에서, 실측이 세트포인트를 충실히 추종하지 못할 때 어떤 일이
 * 생기는지 useMachineControl + useReplayControl을 실제로 물려서 검증한다.
 *
 * 핵심 불변식(안전 바닥): 어떤 프로파일에서도 실패는 "재생 중지·write 중단" 방향이다.
 * 엉뚱한 화력이 추가로 나가는 경로는 없다 — setControl 호출 수로 박제한다.
 */
import { act, createElement, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getStatus: vi.fn(),
        setControl: vi.fn(),
    },
}));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));

import { sidecar } from '@shared/lib/sidecar';
import type { ReplayPoint } from '../lib/replay';
import { type MachineFeedback, useMachineControl } from './useMachineControl';
import { useReplayControl } from './useReplayControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatus = vi.mocked(sidecar.getStatus);
const setControl = vi.mocked(sidecar.setControl);

// TP: t=60/bt=95. 이벤트: t=0 h=60(초기), t=120 bt=110 h=40(BT 트리거)
const POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heater: 60 },
    { t: 60, bt: 95, heater: 60 },
    { t: 120, bt: 110, heater: 40 },
    { t: 600, bt: 205, heater: 40 },
];

interface Sample {
    heater: number;
    liveBt?: number;
    afterTurningPoint?: boolean;
}

/** 두 훅을 MachineControlPanel과 동일하게 배선한 합성 하네스 */
const renderRig = async () => {
    getStatus.mockReset();
    setControl.mockReset();
    getStatus.mockResolvedValue({
        control: { writable: true, limits: { heater: { min: 0, max: 100 } } },
    } as Awaited<ReturnType<typeof sidecar.getStatus>>);
    setControl.mockImplementation(async (cmd) => ({ applied: cmd }) as Awaited<ReturnType<typeof sidecar.setControl>>);

    const root = createRoot(document.createElement('div'));
    let latest!: { replay: ReturnType<typeof useReplayControl>; mc: ReturnType<typeof useMachineControl> };
    interface Inputs {
        feedback: MachineFeedback;
        elapsed: number;
        liveBt: number;
        afterTurningPoint: boolean;
    }
    const Probe = ({ inputs }: { inputs: Inputs }) => {
        const mc = useMachineControl(true, inputs.feedback);
        const { setValue, commitNow } = mc;
        const writeHeater = useCallback(
            (value: number) => {
                setValue('heater', value);
                void commitNow();
            },
            [setValue, commitNow],
        );
        const replay = useReplayControl({
            referencePoints: POINTS,
            referenceDropTime: null,
            liveBt: inputs.liveBt,
            elapsed: inputs.elapsed,
            roasting: true,
            afterTurningPoint: inputs.afterTurningPoint,
            heaterWritable: mc.writable && mc.limits.heater != null,
            pidEngaged: false,
            roastFinished: false,
            sidecarConnected: true,
            heaterUnacknowledged: mc.unacknowledged.has('heater'),
            dropBehavior: 'hold',
            heaterFeedback: inputs.feedback?.heater ?? null,
            heaterPending: mc.desired.heater != null,
            reconnecting: false,
            referenceMachineMismatch: false,
            writeHeater,
        });
        latest = { replay, mc };
        return null;
    };

    let elapsed = 0;
    const render = (inputs: Inputs) => act(async () => root.render(createElement(Probe, { inputs })));
    // 초기 렌더 + capability 로드 대기 (실측은 아직 idle 값)
    await render({ feedback: { heater: 30, fan: 0, drum: 0 }, elapsed, liveBt: 180, afterTurningPoint: false });

    return {
        get: () => latest,
        toggle: () => act(async () => latest.replay.toggle()),
        /** 1폴 = 1초 진행 — 기계가 보고한 실측 한 샘플을 먹인다 */
        poll: (s: Sample) => {
            elapsed += 1;
            return render({
                feedback: { heater: s.heater, fan: 0, drum: 0 },
                elapsed,
                liveBt: s.liveBt ?? 180,
                afterTurningPoint: s.afterTurningPoint ?? false,
            });
        },
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
        await rig.poll({ heater: 60, liveBt: 111, afterTurningPoint: true });
        expect(heaterWrites()).toEqual([60, 40]);
        expect(rig.get().replay.active).toBe(true);
        rig.unmount();
    });
});
