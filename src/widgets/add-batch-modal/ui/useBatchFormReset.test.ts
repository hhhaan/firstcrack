// @vitest-environment jsdom
import type { Machine } from '@entities/machine';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { format } from 'date-fns';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { resolveInitialBatchDate, useBatchFormReset } from './useBatchFormReset';

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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = ({ batch }: { batch: PlanBatchWithProgress }) => {
    const [profileId, setProfileId] = useState('');
    const [beanId, setBeanId] = useState('');
    const [targetRoasted, setTargetRoasted] = useState('');
    const [profileCleared, setProfileCleared] = useState(true);
    useBatchFormReset({
        open: true,
        editingBatch: batch,
        machines: [{ id: 'm1' } as Machine],
        setDate: () => {},
        setRecurringInterval: () => {},
        setMachineId: () => {},
        setBatchType: () => {},
        setProfileId,
        setProfileCleared,
        setBeanId,
        setBlendId: () => {},
        setTargetRoasted,
        setBatchSize: () => {},
        setYieldPct: () => {},
        setNotes: () => {},
    });
    return createElement('div', {
        'data-profile': profileId,
        'data-bean': beanId,
        'data-target': targetRoasted,
        'data-cleared': String(profileCleared),
    });
};

describe('useBatchFormReset profile prefill (#481)', () => {
    it('반복 배치 편집을 열면 저장된 프로파일·로트·목표량을 채운다', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const batch = {
            id: 'rule-1:2026-09-22',
            roast_profile_id: 'prof-1',
            bean_id: 'bean-1',
            target_roasted_kg: 10,
            batch_size_kg: 5,
            yield_pct: 0.82,
            bean_name: 'Ethiopia',
            rrule: 'FREQ=WEEKLY',
            scheduled_date: '2026-09-22',
        } as PlanBatchWithProgress;

        await act(async () => {
            root.render(createElement(Probe, { batch }));
        });

        const node = host.querySelector('div');
        expect(node?.getAttribute('data-profile')).toBe('prof-1');
        expect(node?.getAttribute('data-bean')).toBe('bean-1');
        expect(node?.getAttribute('data-target')).toBe('10');
        expect(node?.getAttribute('data-cleared')).toBe('false');

        act(() => root.unmount());
        host.remove();
    });
});
