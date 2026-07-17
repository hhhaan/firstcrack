import { describe, expect, it } from 'vitest';
import { createBtFilter } from './btFilter';

const T0 = 1_000_000;
const s = (sec: number) => T0 + sec * 1000;

describe('createBtFilter', () => {
    it('정상 로스팅 곡선 통과', () => {
        const f = createBtFilter();
        expect(f(180, s(0))).toBe(180);
        expect(f(178.5, s(1))).toBe(178.5);
        expect(f(177.2, s(2))).toBe(177.2);
    });

    it('범위 밖 거부: 0값(Modbus 에러)·음수·TC 단선 max', () => {
        const f = createBtFilter();
        expect(f(200, s(0))).toBe(200);
        expect(f(0, s(1))).toBeNull();
        expect(f(-5, s(2))).toBeNull();
        expect(f(1372, s(3))).toBeNull();
        expect(f(Number.NaN, s(4))).toBeNull();
        // 범위 거부는 baseline을 오염시키지 않음
        expect(f(199, s(5))).toBe(199);
    });

    it('단일 스파이크 거부 후 복귀 샘플 승인', () => {
        const f = createBtFilter();
        f(190, s(0));
        expect(f(120, s(1))).toBeNull(); // 프로브 접촉 글리치
        expect(f(189, s(2))).toBe(189); // 원래 궤적 복귀
    });

    it('투입(charge) 급락 통과: ~8°C/s 지속 하락', () => {
        const f = createBtFilter();
        f(200, s(0));
        expect(f(192, s(1))).toBe(192);
        expect(f(184, s(2))).toBe(184);
        expect(f(177, s(3))).toBe(177);
    });

    it('2연속 일치하는 실제 스텝(재연결·프로브 교체)은 소급 승인', () => {
        const f = createBtFilter();
        f(200, s(0));
        expect(f(150, s(1))).toBeNull(); // 1차: 보류
        expect(f(149, s(2))).toBe(149); // 2차: 보류값과 연속 → 실제 급변
        expect(f(148, s(3))).toBe(148);
    });

    it('긴 폴링 갭 후 큰 변화 허용 (dt 클램프 10s → 150°C)', () => {
        const f = createBtFilter();
        f(220, s(0));
        expect(f(100, s(30))).toBe(100);
    });
});
