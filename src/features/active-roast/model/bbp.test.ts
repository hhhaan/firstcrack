import { beforeEach, describe, expect, it } from 'vitest';
import { BBP_MAX_SECONDS, useBbpStore } from './bbp';

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

    it('append는 비활성 상태·만료(BBP_MAX_SECONDS 초과) 이후 샘플을 무시한다', () => {
        useBbpStore.getState().append(sample(210), 1_000); // begin 전
        expect(useBbpStore.getState().points).toHaveLength(0);

        useBbpStore.getState().begin(0);
        useBbpStore.getState().append(sample(210), (BBP_MAX_SECONDS + 1) * 1000);
        expect(useBbpStore.getState().points).toHaveLength(0);
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

    it('finalize는 만료·포인트 부족이면 null을 반환하고 finalized를 클리어한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        // 포인트 1개 → 무효
        expect(useBbpStore.getState().finalize(60_000, 's1')).toBeNull();
        expect(useBbpStore.getState().finalized).toBeNull();
        expect(useBbpStore.getState().finalizedPoints).toEqual([]);

        // 만료: charge가 BBP_MAX_SECONDS 넘어 도착
        useBbpStore.getState().begin(0);
        useBbpStore.getState().append(sample(210), 1_000);
        useBbpStore.getState().append(sample(200), 2_000);
        expect(useBbpStore.getState().finalize((BBP_MAX_SECONDS + 10) * 1000, 's2')).toBeNull();
        expect(useBbpStore.getState().finalized).toBeNull();
    });
});
