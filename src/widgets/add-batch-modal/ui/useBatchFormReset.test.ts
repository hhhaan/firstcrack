// @vitest-environment jsdom
import type { Machine } from '@entities/machine';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { format } from 'date-fns';
import { act, createElement, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveInitialBatchDate, useBatchFormReset } from './useBatchFormReset';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const machine: Machine = {
    id: 'machine-1',
    name: 'Roaster',
    roasterKey: 'custom',
    displayName: 'Roaster',
    brand: '',
    models: [],
    protocol: 'modbus',
    connectionParams: {},
    capabilities: [],
    pid: null,
    createdAt: '',
};

const batch: PlanBatchWithProgress = {
    id: 'batch-1',
    plan_id: 'plan-1',
    batch_count: 1,
    batch_size_kg: 5,
    batch_type: 'Single Origin',
    bean_id: 'bean-1',
    bean_name: 'Coffee',
    blend_id: null,
    created_at: '',
    exception_type: null,
    green_lot: '',
    machine_id: machine.id,
    notes: 'Saved notes',
    order_index: 0,
    original_date: null,
    recurrence_group_id: null,
    recurrence_rule_id: null,
    roast_profile_id: null,
    rrule: null,
    scheduled_date: '2026-08-20',
    status: 'pending',
    target_roasted_kg: 4,
    updated_at: '',
    yield_pct: 0.82,
    completed_sessions: 0,
};

const ignore = () => {};
let changeNotes = (_value: string) => {};
let changeTarget = (_value: string) => {};
let chooseMachine = (_value: string) => {};
type FormProps = Pick<Parameters<typeof useBatchFormReset>[0], 'open' | 'editingBatch' | 'currentDateKey' | 'machines'>;

function Form(props: FormProps) {
    const [notes, setNotes] = useState('');
    const [targetRoasted, setTargetRoasted] = useState('');
    const [machineId, setMachineId] = useState('');
    const [date, setDate] = useState<Date>();
    useEffect(() => {
        changeNotes = setNotes;
        changeTarget = setTargetRoasted;
        chooseMachine = setMachineId;
    }, []);
    useBatchFormReset({
        ...props,
        setNotes,
        setTargetRoasted,
        setMachineId,
        setDate,
        setRecurringInterval: ignore,
        setBatchType: ignore,
        setProfileId: ignore,
        setBeanId: ignore,
        setBlendId: ignore,
        setBatchSize: ignore,
        setYieldPct: ignore,
        setSourceAttempted: ignore,
    });
    return createElement('output', {
        'data-notes': notes,
        'data-target': targetRoasted,
        'data-machine': machineId,
        'data-date': date ? format(date, 'yyyy-MM-dd') : '',
    });
}

describe('batch form draft lifecycle', () => {
    let host: HTMLDivElement;
    let root: Root;
    const render = (overrides: Partial<FormProps> = {}) => {
        act(() =>
            root.render(
                createElement(Form, {
                    open: true,
                    editingBatch: null,
                    currentDateKey: '2026-08-30',
                    machines: [machine],
                    ...overrides,
                }),
            ),
        );
    };
    const value = (field: string) => host.querySelector('output')?.getAttribute(`data-${field}`);

    beforeEach(() => {
        host = document.createElement('div');
        root = createRoot(host);
    });
    afterEach(() => act(() => root.unmount()));

    it('preserves notes, quantity and selected machine when the machine list changes', () => {
        const selectedMachine = { ...machine, id: 'machine-2' };
        render({ machines: [machine, selectedMachine] });
        act(() => {
            changeNotes('Unsaved notes');
            changeTarget('12');
            chooseMachine('machine-2');
        });
        render({ machines: [{ ...machine, name: 'Renamed' }, selectedMachine] });
        render({ machines: [selectedMachine] });
        render({ machines: [{ ...machine, id: 'machine-3' }, selectedMachine] });
        expect(value('notes')).toBe('Unsaved notes');
        expect(value('target')).toBe('12');
        expect(value('machine')).toBe('machine-2');
    });

    it('fills a late default machine without resetting other inputs, and resets on reopening', () => {
        render({ machines: [] });
        act(() => {
            changeNotes('Draft before machines load');
            changeTarget('12');
        });
        render();
        expect(value('machine')).toBe(machine.id);
        expect(value('notes')).toBe('Draft before machines load');
        expect(value('target')).toBe('12');

        render({ open: false });
        render();
        expect(value('notes')).toBe('');
        expect(value('target')).toBe('');
        expect(value('date')).toBe('2026-08-30');
    });

    it('preserves same-batch drafts on refresh and initializes a different batch or day', () => {
        render({ editingBatch: batch });
        expect(value('date')).toBe('2026-08-20');
        act(() => changeNotes('Unsaved edit'));
        render({ editingBatch: { ...batch, notes: 'Refetched notes' } });
        expect(value('notes')).toBe('Unsaved edit');

        render({ editingBatch: { ...batch, id: 'batch-2', notes: 'Other batch' } });
        expect(value('notes')).toBe('Other batch');
        render({ currentDateKey: '2026-09-01' });
        expect(value('date')).toBe('2026-09-01');
        expect(value('notes')).toBe('');
    });
});

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
