import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { format } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { resolveInitialBatchDate } from './useBatchFormReset';

describe('resolveInitialBatchDate (#305-7 overdue batch date preservation)', () => {
    it('지연 배치 수정 시: scheduled_date가 currentDateKey(오늘)보다 우선 적용된다', () => {
        const overdueBatch = {
            id: 'b-1',
            scheduled_date: '2026-08-20',
        } as PlanBatchWithProgress;

        const resolved = resolveInitialBatchDate(overdueBatch, '2026-08-30');
        expect(format(resolved, 'yyyy-MM-dd')).toBe('2026-08-20');
    });

    it('배치 수정 시 scheduled_date가 없으면 currentDateKey로 폴백한다', () => {
        const batchNoDate = {
            id: 'b-2',
            scheduled_date: null,
        } as unknown as PlanBatchWithProgress;

        const resolved = resolveInitialBatchDate(batchNoDate, '2026-08-30');
        expect(format(resolved, 'yyyy-MM-dd')).toBe('2026-08-30');
    });

    it('신규 배치 추가 시: currentDateKey가 지정되어 있으면 해당 날짜를 사용한다', () => {
        const resolved = resolveInitialBatchDate(null, '2026-09-01');
        expect(format(resolved, 'yyyy-MM-dd')).toBe('2026-09-01');
    });

    it('신규 배치 추가 시: currentDateKey가 없으면 오늘 날짜를 사용한다', () => {
        const resolved = resolveInitialBatchDate(null, undefined);
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        expect(format(resolved, 'yyyy-MM-dd')).toBe(todayStr);
    });
});
