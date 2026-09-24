import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BBP_MAX_SECONDS, hydrateLiveBbp, useBbpStore } from './bbp';

const sample = (bt: number) => ({ bt, et: 200, heater: 50, fan: 40, drum: 60 });

describe('bbp store', () => {
    beforeEach(() => {
        useBbpStore.setState({ active: false, startMs: 0, points: [], finalized: null, finalizedPoints: [] });
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

    it('append는 20분을 넘으면 오래된 헤드를 버리고 Charge 직전 20분만 남긴다', () => {
        expect(BBP_MAX_SECONDS).toBe(1200);
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(208), 2_000);
        st.append(sample(200), 60_000);
        st.append(sample(199), 61_000);
        st.append(sample(195), 1_260_000); // 21분 — 헤드 t=1,2 폐기

        expect(useBbpStore.getState().points.map((p) => [p.t, p.bt])).toEqual([
            [60, 200],
            [61, 199],
            [1260, 195],
        ]);
    });

    it('finalize는 요약과 TSV를 반환하고 세션에 귀속된 finalized를 저장한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(195.4), 2_000);

        const result = useBbpStore.getState().finalize(180_000, 's1');
        expect(result).not.toBeNull();
        expect(result?.seconds).toBe(180);
        expect(result?.chargeTemp).toBe(195.4); // 마지막 pre-charge 포인트 BT
        expect(result?.tsv).toBe(
            'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\n' +
                '1.0\t210\t200\t\t50\t40\t60\t\n' +
                '2.0\t195.4\t200\t\t50\t40\t60\t\n',
        );
        const s = useBbpStore.getState();
        expect(s.finalized).toEqual({ sessionId: 's1', seconds: 180, chargeTemp: 195.4 });
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
        expect(useBbpStore.getState().finalized).toEqual({ sessionId: 's1', seconds: 180, chargeTemp: 195.4 });
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
        { waitSec: 1260, label: '21분' },
        { waitSec: 2940, label: '49분' },
        { waitSec: 1800, label: '구 30분 폐기 경계' },
    ])('finalize는 Charge가 $label이어도 직전 1200초만 저장하고 null이 아니다', ({ waitSec }) => {
        const origin = waitSec - 1200;
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(208), 2_000);
        st.append(sample(200), origin * 1000);
        st.append(sample(199), (origin + 1) * 1000);
        st.append(sample(195.4), waitSec * 1000);

        const result = useBbpStore.getState().finalize(waitSec * 1000, 's2');
        expect(result).not.toBeNull();
        expect(result?.seconds).toBe(1200);
        expect(result?.chargeTemp).toBe(195.4);
        expect(result?.tsv).toBe(
            'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\n' +
                '0.0\t200\t200\t\t50\t40\t60\t\n' +
                '1.0\t199\t200\t\t50\t40\t60\t\n' +
                '1200.0\t195.4\t200\t\t50\t40\t60\t\n',
        );
        expect(result?.tsv).not.toContain(String(waitSec));
        expect(useBbpStore.getState().finalized).toEqual({
            sessionId: 's2',
            seconds: 1200,
            chargeTemp: 195.4,
        });
        expect(useBbpStore.getState().finalizedPoints.map((p) => p.t)).toEqual([0, 1, 1200]);
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
        expect(s.finalized).toEqual({ sessionId: 's1', seconds: 180, chargeTemp: 195.4 });
    });

    it('persists in-progress BBP so a restart can resume Charge wait', () => {
        const mem: Record<string, string> = {};
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => mem[k] ?? null,
            setItem: (k: string, v: string) => {
                mem[k] = v;
            },
            removeItem: (k: string) => {
                delete mem[k];
            },
            clear: () => {
                for (const k of Object.keys(mem)) delete mem[k];
            },
        });
        try {
            useBbpStore.getState().begin(1_000, [{ t: 0, ...sample(200) }]);
            expect(JSON.parse(mem.fc_bbp_live ?? '{}').startMs).toBe(1_000);
            useBbpStore.setState({ active: false, startMs: 0, points: [] });
            expect(hydrateLiveBbp()).toBe(true);
            expect(useBbpStore.getState()).toMatchObject({ active: true, startMs: 1_000 });
            useBbpStore.getState().abort();
            expect(mem.fc_bbp_live).toBeUndefined();
            expect(hydrateLiveBbp()).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
