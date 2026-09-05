import { describe, expect, it } from 'vitest';
import { isRoastBlockingScheduleStart } from './useScheduleDayView';

// Plan Day write flow tests moved to features/schedule/lib/plan-day-flow.test.ts

describe('isRoastBlockingScheduleStart', () => {
    it('머신 연결(preheating/standby)과 idle은 허용', () => {
        expect(isRoastBlockingScheduleStart('idle')).toBe(false);
        expect(isRoastBlockingScheduleStart('preheating')).toBe(false);
        expect(isRoastBlockingScheduleStart('standby')).toBe(false);
    });

    it('차지 중·미저장 종료만 차단', () => {
        expect(isRoastBlockingScheduleStart('roasting')).toBe(true);
        expect(isRoastBlockingScheduleStart('ended')).toBe(true);
    });
});
