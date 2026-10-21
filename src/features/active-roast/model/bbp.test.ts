import { parseTsv } from '@shared/lib/tsv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BBP_MAX_SECONDS, bbpPointsToTsv, hydrateLiveBbp, useBbpStore } from './bbp';
import { updateRoastSettings } from './settings';

const sample = (bt: number) => ({ bt, et: 200, heater: 50, fan: 40, drum: 60 });

describe('bbp store', () => {
    it('archives sensor clock and calculation settings with BBP samples', () => {
        const processing = {
            algorithm_version: 'ema-least-squares-v1',
            temperature_unit: 'C',
            ror_unit: 'C/min',
            timestamp_clock: 'sidecar-monotonic-seconds',
            display_ema_alpha: 0.16,
            ror_ema_alpha: 0.2,
            ror_window_sec: 30,
            ror_warmup_reads: 3,
        } as const;
        const point = {
            ...sample(200),
            t: 0,
            btRaw: 199.75,
            etRaw: 201.25,
            ror_et: 4,
            sensorTimestamp: 123.456789,
            sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
            processing,
            extraReadings: [{ id: 'inlet-2', label: 'Inlet 2', unit: '°C', value: null }],
        };
        const tsv = bbpPointsToTsv([point, { ...point, t: 1, etRaw: -1 }, { ...point, t: 2, etRaw: undefined }]);
        expect(tsv.match(/# processing\t/g)).toHaveLength(1);
        const noFeedback = bbpPointsToTsv([
            { ...point, heater: 0, fan: 0, drum: 0, processing: { ...processing, read_units: {} } },
        ]);
        expect(parseTsv(noFeedback)[0]).toMatchObject({ heater: null, fan: null, drum: null });
        expect(parseTsv(tsv)).toMatchObject([
            {
                bt: 200,
                btRaw: 199.75,
                etRaw: 201.25,
                rorEt: 4,
                sensorTimestamp: 123.456789,
                sensorClock: point.sensorClock,
                processing,
                extraReadings: point.extraReadings,
            },
            { t: 1, etRaw: -1, processing },
            { t: 2, etRaw: null, processing },
        ]);
    });
    beforeEach(() => {
        useBbpStore.setState({
            active: false,
            recording: false,
            liveGeneration: '',
            startMs: 0,
            points: [],
            events: [],
            finalized: null,
            finalizedPoints: [],
        });
    });

    it('저장된 기록 범위 값은 FIFO 상한을 바꾸지 않는다', () => {
        const legacyWindow = { bbpEnabled: true, bbpWindowMinutes: 5 };
        updateRoastSettings(legacyWindow);
        const bbp = useBbpStore.getState();
        bbp.begin(1_000);
        for (const t of [0, 60, 300, 360]) bbp.append(sample(200 + t / 60), 1_000 + t * 1_000);

        expect(useBbpStore.getState().points.map((p) => p.t)).toEqual([0, 60, 300, 360]);
        expect(bbp.finalize(361_000, 'session-1')?.seconds).toBe(360);
    });

    it('begin은 기록을 시작한다', () => {
        useBbpStore.getState().begin(1_000);
        const s = useBbpStore.getState();
        expect(s.active).toBe(true);
        expect(s.startMs).toBe(1_000);
        expect(s.points).toEqual([]);
        expect(s.finalizedPoints).toEqual([]);
    });

    it('append는 1초 미만 간격 샘플을 무시한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(209), 1_400); // <1s 후속 → 무시
        st.append(sample(208), 2_100);
        expect(useBbpStore.getState().points.map((p) => p.t)).toEqual([1, 2.1]);
    });

    it('append는 비활성 상태의 샘플을 무시한다', () => {
        useBbpStore.getState().append(sample(210), 1_000); // begin 전
        expect(useBbpStore.getState().points).toHaveLength(0);
    });

    it('append는 15분을 넘으면 오래된 헤드를 버리고 Charge 직전 15분만 남긴다', () => {
        expect(BBP_MAX_SECONDS).toBe(900);
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(208), 2_000);
        st.append(sample(200), 60_000);
        st.append(sample(199), 61_000);
        st.append(sample(195), 960_000); // 16분 — 헤드 t=1,2 폐기

        expect(useBbpStore.getState().points.map((p) => [p.t, p.bt])).toEqual([
            [60, 200],
            [61, 199],
            [960, 195],
        ]);
    });

    it('finalize는 요약과 TSV를 반환하고 세션에 귀속된 finalized를 저장한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(195.4), 2_000);

        const result = useBbpStore.getState().finalize(180_000, 's1');
        expect(result).not.toBeNull();
        expect(result?.seconds).toBe(1);
        expect(result?.chargeTemp).toBe(195.4); // 마지막 pre-charge 포인트 BT
        expect(result?.tsv).toBe(
            'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et\tsensor_timestamp\tsensor_clock\textra_readings\n' +
                '1.0\t210\t200\t\t50\t40\t60\t\t\t\t\t\t\t\n' +
                '2.0\t195.4\t200\t\t50\t40\t60\t\t\t\t\t\t\t\n',
        );
        const s = useBbpStore.getState();
        expect(s.finalized).toEqual({ sessionId: 's1', seconds: 1, chargeTemp: 195.4, events: [] });
        expect(s.active).toBe(false);
        expect(s.points).toEqual([]);
        expect(s.finalizedPoints.map((p) => [p.t, p.bt])).toEqual([
            [1, 210],
            [2, 195.4],
        ]);
    });

    // 회귀: 드롭(begin) → 요약 모달 → 저장(finalized 읽기) 순서라서,
    // begin이 finalized를 지우면 BBP가 DB에 영구히 저장되지 않는다.
    it('begin은 아직 저장되지 않은 직전 세션의 finalized를 보존한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(195.4), 2_000);
        useBbpStore.getState().finalize(180_000, 's1');

        // 다음 배치 드롭 — s1은 아직 저장 전이므로 요약이 살아있어야 한다
        useBbpStore.getState().begin(500_000);
        expect(useBbpStore.getState().finalized).toEqual({
            sessionId: 's1',
            seconds: 1,
            chargeTemp: 195.4,
            events: [],
        });
        expect(useBbpStore.getState().active).toBe(true);
        expect(useBbpStore.getState().finalizedPoints).toHaveLength(2);
    });

    it('finalize는 charge 시각 이후 샘플(auto-charge lookback)을 잘라낸다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 10_000); // t=10
        st.append(sample(205), 20_000); // t=20
        st.append(sample(150), 30_000); // t=30 — 투입 직후 급락, charge 이후 샘플

        // auto-charge onset lookback: 실제 charge는 t=25
        const result = useBbpStore.getState().finalize(25_000, 's1');
        expect(result?.chargeTemp).toBe(205); // 150(투입 후)이 아니라 205
        expect(result?.tsv).not.toContain('150');
        expect(useBbpStore.getState().finalizedPoints.map((p) => p.bt)).toEqual([210, 205]);
    });

    it('finalize는 포인트 부족이면 null을 반환하고 finalized를 클리어한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        // 포인트 1개 → 무효
        expect(useBbpStore.getState().finalize(60_000, 's1')).toBeNull();
        expect(useBbpStore.getState().finalized).toBeNull();
        expect(useBbpStore.getState().finalizedPoints).toEqual([]);
    });

    it.each([
        { waitSec: 960, label: '16분' },
        { waitSec: 2940, label: '49분' },
        { waitSec: 1800, label: '구 30분 폐기 경계' },
    ])('finalize는 Charge가 $label이어도 직전 900초만 저장하고 null이 아니다', ({ waitSec }) => {
        const origin = waitSec - 900;
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(208), 2_000);
        st.append(sample(200), origin * 1000);
        st.append(sample(199), (origin + 1) * 1000);
        st.append(sample(195.4), waitSec * 1000);

        const result = useBbpStore.getState().finalize(waitSec * 1000, 's2');
        expect(result).not.toBeNull();
        expect(result?.seconds).toBe(900);
        expect(result?.chargeTemp).toBe(195.4);
        expect(result?.tsv).toBe(
            'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et\tsensor_timestamp\tsensor_clock\textra_readings\n' +
                '0.0\t200\t200\t\t50\t40\t60\t\t\t\t\t\t\t\n' +
                '1.0\t199\t200\t\t50\t40\t60\t\t\t\t\t\t\t\n' +
                '900.0\t195.4\t200\t\t50\t40\t60\t\t\t\t\t\t\t\n',
        );
        expect(result?.tsv).not.toContain(String(waitSec));
        expect(useBbpStore.getState().finalized).toEqual({
            sessionId: 's2',
            seconds: 900,
            chargeTemp: 195.4,
            events: [],
        });
        expect(useBbpStore.getState().finalizedPoints.map((p) => p.t)).toEqual([0, 1, 900]);
    });

    it('begin은 auto Drop lookback seed를 시작점에 붙인다', () => {
        useBbpStore.getState().begin(1_000, [
            { t: 0, ...sample(205) },
            { t: 1.5, ...sample(150) },
        ]);
        expect(useBbpStore.getState().points.map((p) => [p.t, p.bt])).toEqual([
            [0, 205],
            [1.5, 150],
        ]);
        useBbpStore.getState().append(sample(148), 4_000);
        expect(useBbpStore.getState().points.map((p) => p.t)).toEqual([0, 1.5, 3]);
    });

    it('abort는 진행 중 BBP만 지우고 직전 세션 finalized를 남긴다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(195.4), 2_000);
        useBbpStore.getState().finalize(180_000, 's1');
        useBbpStore.getState().begin(500_000, [{ t: 0, ...sample(190) }]);
        useBbpStore.getState().abort();
        const s = useBbpStore.getState();
        expect(s.active).toBe(false);
        expect(s.points).toEqual([]);
        expect(s.finalized).toEqual({ sessionId: 's1', seconds: 1, chargeTemp: 195.4, events: [] });
    });

    it('finalize seconds follow the kept samples, not the window cutoff', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(180), 47 * 60 * 1000);
        st.append(sample(190), 48 * 60 * 1000);
        const result = st.finalize(48 * 60 * 1000, 's-gap');
        const kept = useBbpStore.getState().finalizedPoints;
        expect(result?.seconds).toBe(60);
        expect(kept[kept.length - 1].t - kept[0].t).toBe(60);
    });

    it('same-tab reload continues the current BBP; a new session does not', () => {
        const { local, session } = installStorage();
        try {
            useBbpStore.getState().begin(1_000, [{ t: 0, ...sample(200) }]);
            expect(JSON.parse(local.fc_bbp_live ?? '{}').startMs).toBe(1_000);
            expect(session.fc_bbp_live_gen).toBeTruthy();

            useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
            expect(hydrateLiveBbp()).toBe(true);
            expect(useBbpStore.getState()).toMatchObject({ active: true, recording: true, startMs: 1_000 });

            useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
            delete session.fc_bbp_live_gen;
            expect(hydrateLiveBbp()).toBe(false);
            expect(useBbpStore.getState().active).toBe(false);
            expect(local.fc_bbp_live).toBeTruthy();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('a stale tab stops writing once another tab claims the blob', () => {
        const { local, session } = installStorage();
        try {
            useBbpStore.getState().begin(1_000, [{ t: 0, ...sample(200) }]);
            const staleGen = session.fc_bbp_live_gen ?? '';
            const stalePoints = useBbpStore.getState().points;

            delete session.fc_bbp_live_gen;
            useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
            useBbpStore.getState().begin(9_000, [{ t: 0, ...sample(180) }]);
            expect(JSON.parse(local.fc_bbp_live ?? '{}').startMs).toBe(9_000);

            session.fc_bbp_live_gen = staleGen;
            useBbpStore.setState({
                active: true,
                recording: true,
                liveGeneration: staleGen,
                startMs: 1_000,
                points: stalePoints,
            });
            useBbpStore.getState().append(sample(210), 2_000);
            expect(JSON.parse(local.fc_bbp_live ?? '{}').startMs).toBe(9_000);

            useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
            expect(hydrateLiveBbp()).toBe(false);
            session.fc_bbp_live_gen = JSON.parse(local.fc_bbp_live ?? '{}').generation;
            expect(hydrateLiveBbp()).toBe(true);
            expect(useBbpStore.getState().startMs).toBe(9_000);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('a failed setItem drops the blob so reload cannot restore it', () => {
        const { local } = installStorage();
        try {
            useBbpStore.getState().begin(1_000, [{ t: 0, ...sample(200) }]);
            expect(local.fc_bbp_live).toBeTruthy();
            vi.stubGlobal('localStorage', {
                getItem: (k: string) => local[k] ?? null,
                setItem: () => {
                    throw new Error('quota');
                },
                removeItem: (k: string) => {
                    delete local[k];
                },
            });
            useBbpStore.getState().append(sample(210), 2_000);
            expect(local.fc_bbp_live).toBeUndefined();
            useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
            expect(hydrateLiveBbp()).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('chart-only preheat does not claim the tab token', () => {
        const { local, session } = installStorage();
        try {
            useBbpStore.getState().begin(2_000, [], false);
            useBbpStore.getState().append(sample(200), 3_000);
            useBbpStore.getState().append(sample(201), 4_000);
            expect(useBbpStore.getState().points).toHaveLength(2);
            expect(local.fc_bbp_live).toBeUndefined();
            expect(session.fc_bbp_live_gen).toBeUndefined();
            expect(useBbpStore.getState().finalize(5_000, 'first-batch')).toBeNull();
            expect(useBbpStore.getState()).toMatchObject({ active: false, recording: false, finalized: null });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('keeps a BBP note across reload and stores it at Charge-relative negative time', () => {
        const { local, session } = installStorage();
        try {
            vi.stubGlobal('crypto', {
                randomUUID: vi.fn().mockReturnValueOnce('gen-1').mockReturnValueOnce('note-1'),
            });
            useBbpStore.getState().begin(1_000);
            useBbpStore.getState().append(sample(210), 1_000);
            useBbpStore.getState().append(sample(200), 241_000);
            useBbpStore.getState().setEvents([
                {
                    id: 'note-1',
                    event: 'Note',
                    time: '1:00',
                    timeSec: 60,
                    temp: '',
                    tempC: 205,
                    note: 'gas soak',
                    gas: '70',
                },
            ]);
            expect(JSON.parse(local.fc_bbp_live ?? '{}').events[0]).toMatchObject({
                id: 'note-1',
                timeSec: 60,
                gas: '70',
            });

            useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [], events: [] });
            expect(hydrateLiveBbp()).toBe(true);
            expect(useBbpStore.getState().events[0]?.note).toBe('gas soak');

            const result = useBbpStore.getState().finalize(241_000, 's-note');
            // startMs 1000, charge 241000 → cutoff 240s. Note at 60 → −180.
            expect(result?.events).toEqual([
                expect.objectContaining({ id: 'note-1', type: 'Note', time_sec: -180, gas: '70' }),
            ]);
            expect(session.fc_bbp_live_gen).toBeUndefined();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('drops an unscoped legacy blob instead of restoring it', () => {
        const { local } = installStorage();
        try {
            local.fc_bbp_live = JSON.stringify({
                startMs: Date.now() - (48 * 60 + 19) * 1000,
                points: [
                    { t: 0, ...sample(180) },
                    { t: 60, ...sample(190) },
                ],
            });
            expect(hydrateLiveBbp()).toBe(false);
            expect(local.fc_bbp_live).toBeUndefined();
            expect(useBbpStore.getState().active).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

const installStorage = () => {
    const local: Record<string, string> = {};
    const session: Record<string, string> = {};
    const api = (mem: Record<string, string>) => ({
        getItem: (k: string) => mem[k] ?? null,
        setItem: (k: string, v: string) => {
            mem[k] = v;
        },
        removeItem: (k: string) => {
            delete mem[k];
        },
    });
    vi.stubGlobal('localStorage', api(local));
    vi.stubGlobal('sessionStorage', api(session));
    return { local, session };
};
