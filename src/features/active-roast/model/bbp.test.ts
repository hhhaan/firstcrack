import { beforeEach, describe, expect, it } from 'vitest';
import { BBP_MAX_SECONDS, useBbpStore } from './bbp';

const sample = (bt: number) => ({ bt, et: 200, heater: 50, fan: 40, drum: 60 });

describe('bbp store', () => {
    beforeEach(() => {
        useBbpStore.setState({ active: false, startMs: 0, points: [], finalized: null });
    });

    it('begin은 기록을 시작하고 이전 finalized를 클리어한다', () => {
        useBbpStore.setState({ finalized: { seconds: 10, chargeTemp: 180 } });
        useBbpStore.getState().begin(1_000);
        const s = useBbpStore.getState();
        expect(s.active).toBe(true);
        expect(s.startMs).toBe(1_000);
        expect(s.points).toEqual([]);
        expect(s.finalized).toBeNull();
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

    it('finalize는 요약과 TSV를 반환하고 finalized를 저장한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        st.append(sample(195.4), 2_000);

        const result = useBbpStore.getState().finalize(180_000);
        expect(result).not.toBeNull();
        expect(result?.seconds).toBe(180);
        expect(result?.chargeTemp).toBe(195.4); // 마지막 포인트 BT
        expect(result?.tsv).toBe(
            'time\tbt\tet\tror\theater\tfan\tdrum\n' +
                '1.0\t210\t200\t\t50\t40\t60\n' +
                '2.0\t195.4\t200\t\t50\t40\t60\n',
        );
        const s = useBbpStore.getState();
        expect(s.finalized).toEqual({ seconds: 180, chargeTemp: 195.4 });
        expect(s.active).toBe(false);
        expect(s.points).toEqual([]);
    });

    it('finalize는 만료·포인트 부족이면 null을 반환하고 finalized를 클리어한다', () => {
        const st = useBbpStore.getState();
        st.begin(0);
        st.append(sample(210), 1_000);
        // 포인트 1개 → 무효
        expect(useBbpStore.getState().finalize(60_000)).toBeNull();
        expect(useBbpStore.getState().finalized).toBeNull();

        // 만료: charge가 BBP_MAX_SECONDS 넘어 도착
        useBbpStore.getState().begin(0);
        useBbpStore.getState().append(sample(210), 1_000);
        useBbpStore.getState().append(sample(200), 2_000);
        expect(useBbpStore.getState().finalize((BBP_MAX_SECONDS + 10) * 1000)).toBeNull();
        expect(useBbpStore.getState().finalized).toBeNull();
    });
});
