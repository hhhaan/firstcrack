import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { patchDayBatchesCache, planKeys, reorderByIds, restoreDayBatchesCache } from './queries';

const row = (over: Partial<PlanBatchWithProgress>): PlanBatchWithProgress =>
    ({ bean_name: 'x', order_index: 0, recurrence_rule_id: null, ...over }) as PlanBatchWithProgress;

describe('reorderByIds', () => {
    it('나열된 id는 1-based 재부여, 미포함 행(다른 날짜·반복)은 보존', () => {
        const cache = [
            row({ id: 'rule-1:d', order_index: 0 }),
            row({ id: 'a', order_index: 1 }),
            row({ id: 'b', order_index: 2 }),
            row({ id: 'other-day', order_index: 1, scheduled_date: '2026-08-01' }),
        ];
        const result = reorderByIds(cache, ['b', 'a']);

        expect(result).toHaveLength(4);
        expect(result.find((r) => r.id === 'b')?.order_index).toBe(1);
        expect(result.find((r) => r.id === 'a')?.order_index).toBe(2);
        expect(result.find((r) => r.id === 'other-day')?.order_index).toBe(1);
        // 반복 행(order 0)이 항상 먼저
        expect(result[0].id).toBe('rule-1:d');
    });
});

describe('patchDayBatchesCache (낙관적 업데이트 키 매칭)', () => {
    it('lookback 변형 키(…, 14)의 캐시도 패치되고 스냅샷으로 롤백된다', () => {
        const qc = new QueryClient();
        const key14 = planKeys.dayBatches('u1', '2026-08-03', 14);
        const original = [row({ id: 'a', order_index: 1 })];
        qc.setQueryData(key14, original);

        const snapshot = patchDayBatchesCache(qc, 'u1', '2026-08-03', (prev) => [
            ...prev,
            row({ id: 'b', order_index: 2 }),
        ]);

        // day view가 실제로 보는 키가 즉시 갱신됨 (이전엔 2-인자 키만 패치 → 항상 miss)
        expect(qc.getQueryData<PlanBatchWithProgress[]>(key14)).toHaveLength(2);

        restoreDayBatchesCache(qc, snapshot);
        expect(qc.getQueryData<PlanBatchWithProgress[]>(key14)).toEqual(original);
    });
});
