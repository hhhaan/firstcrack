// @vitest-environment jsdom

import type { StockSummary } from '@entities/bean-stock-event';
import type { RoastProfileWithSource } from '@entities/roast-profile';
import { validateHeaterDraft } from '@features/machine-control/lib/heater-events';
import type { Bean, RoastSessionWithRelations } from '@shared/types/database.types';
import { EMPTY_BEAN_FORM } from '@widgets/add-bean-modal/lib/schema';
import { useAddBeanFormReset } from '@widgets/add-bean-modal/ui/useAddBeanFormReset';
import { useNewProfileForm } from '@widgets/new-profile-modal/model/useNewProfileForm';
import { act, type ComponentType, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reviewHeaterToSave } from '../../active-roast/model/review-heater';
import { ChargeWeightEditor, QcMeasurementEditor } from './HistoryQcEditor';
import { OutputWeightEditor } from './OutputWeightEditor';
import { RecordTextEditor } from './RecordTextEditor';
import { RoastColorEditor } from './RoastColorEditor';

const mocks = vi.hoisted(() => ({
    update: vi.fn(),
    charge: vi.fn(),
    output: vi.fn(),
    record: vi.fn(),
    profile: vi.fn(),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));
vi.mock('@shared/lib/features', () => ({ useWriteAccess: () => true }));
vi.mock('@entities/roast', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@entities/roast')>()),
    useUpdateRoastSession: () => ({ mutateAsync: mocks.update, isPending: false }),
    useSetChargeWeight: () => ({ mutateAsync: mocks.charge, isPending: false }),
    useSetOutputWeight: () => ({ mutateAsync: mocks.output, isPending: false }),
    useUpdateRoastRecord: () => ({ mutateAsync: mocks.record, isPending: false }),
    useRoastSessions: () => ({ data: [] }),
}));
vi.mock('@entities/bean/queries', () => ({ useBeans: () => ({ data: [] }) }));
vi.mock('@entities/blend', () => ({ useBlends: () => ({ data: [] }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const session = (): RoastSessionWithRelations => ({
    id: 'record',
    user_id: 'owner',
    weight_grams: 1000,
    output_weight_grams: 800,
    events: [],
    heater_events: null,
    duration_seconds: 600,
    drop_temp_celsius: 210,
    charge_temp_celsius: 200,
    ambient_humidity_pct: null,
    ambient_temp_celsius: 20,
    batch_name: null,
    bbp_seconds: null,
    bbp_tsv_path: null,
    bean_id: null,
    bean_label: null,
    blend_id: null,
    color_ground: null,
    color_whole: '58.4',
    created_at: '',
    created_by: null,
    density_g_per_l: null,
    machine_brand: null,
    machine_id: null,
    machine_name: null,
    machine_protocol: null,
    machine_roaster_key: null,
    moisture_pct: null,
    notes: null,
    plan_batch_id: null,
    profile_batch_number: null,
    profile_id: null,
    roast_level: null,
    roasted_at: null,
    scheduled_at: null,
    status: 'completed',
    total_batch_number: null,
    tsv_path: null,
    updated_at: '',
    beans: null,
    roast_profiles: null,
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset().mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
const render = (component: ComponentType<{ session: RoastSessionWithRelations }>, row: RoastSessionWithRelations) =>
    act(async () => root.render(createElement(component, { session: row })));
const input = (selector: string) => {
    const node = host.querySelector<HTMLInputElement>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
};
const blur = async (node: HTMLInputElement) => {
    await act(async () => node.focus());
    await act(async () => node.blur());
};

it('refreshes an untouched charge without writing old grams back', async () => {
    const row = session();
    await render(ChargeWeightEditor, row);
    await render(ChargeWeightEditor, { ...row, weight_grams: 1200 });
    await blur(input('[data-testid="history-charge-weight"]'));
    expect(input('[data-testid="history-charge-weight"]').value).toBe('1200');
    expect(mocks.charge).not.toHaveBeenCalled();
});

it('refreshes an untouched measured output without writing old grams back', async () => {
    const row = session();
    await render(OutputWeightEditor, row);
    await render(OutputWeightEditor, { ...row, output_weight_grams: 850 });
    await blur(input('[aria-label="history.expanded.outputWeight"]'));
    expect(input('[aria-label="history.expanded.outputWeight"]').value).toBe('850');
    expect(mocks.output).not.toHaveBeenCalled();
});

it('refreshes untouched color readings without saving old readings', async () => {
    const row = session();
    await render(RoastColorEditor, row);
    await render(RoastColorEditor, { ...row, color_whole: '63.1' });
    await blur(input('[data-testid="history-color-whole"]'));
    expect(input('[data-testid="history-color-whole"]').value).toBe('63.1');
    expect(mocks.update).not.toHaveBeenCalled();
});

it('refreshes an untouched QC measurement without saving its old value', async () => {
    const row = session();
    await render(QcMeasurementEditor, row);
    await render(QcMeasurementEditor, { ...row, ambient_temp_celsius: 25 });
    await blur(input('[data-testid="history-ambient-temp"]'));
    expect(input('[data-testid="history-ambient-temp"]').value).toBe('25');
    expect(mocks.update).not.toHaveBeenCalled();
});

it('never reuses a deleted note draft for another note with the same comment', async () => {
    const a = { id: 'a', type: 'Note', time_sec: 60, note: 'aroma' };
    const b = { id: 'b', type: 'Note', time_sec: 90, note: 'aroma' };
    const row = { ...session(), events: [a, b] };
    await render(RecordTextEditor, row);
    const editing = input('[data-testid="history-recorded-note"]');
    await act(async () => {
        editing.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            editing,
            'draft intended for A',
        );
        editing.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await render(RecordTextEditor, { ...row, events: [b] });
    expect(input('[data-testid="history-recorded-note"]')).not.toBe(editing);
    await act(async () => editing.blur());
    await blur(input('[data-testid="history-recorded-note"]'));
    expect(mocks.record).not.toHaveBeenCalled();
});

it('keeps each condition when valid Heater steps share the same second', () => {
    const a = { id: 'a', event: 'Heater', time: '0:30', timeSec: 30, temp: '160', tempC: 160, note: '80%' };
    const b = { ...a, id: 'b', tempC: 165, note: '50%' };
    const next = [{ ...a, time: '0:45', timeSec: 45 }, b];
    const stored = [
        { t: 30, bt: 160, heater: 80, trigger: 'bt' },
        { t: 30, bt: 165, heater: 50, trigger: 'time' },
    ];
    expect(
        validateHeaterDraft(
            stored.map((row) => ({
                t: '0:30',
                bt: String(row.bt),
                heater: String(row.heater),
                trigger: row.trigger === 'bt' ? 'bt' : 'time',
            })),
            'C',
            { min: 0, max: 100 },
        ).ok,
    ).toBe(true);
    expect(reviewHeaterToSave([a, b], next, stored, next, [a, b])).toEqual([
        stored[1],
        { t: 45, bt: 160, heater: 80, trigger: 'bt' },
    ]);
});

const ProfileProbe = ({ profile }: { profile: RoastProfileWithSource }) => {
    const form = useNewProfileForm({
        editingProfile: profile,
        onUpdated: mocks.profile,
        onClose: () => {},
        onCreated: () => {},
    });
    return (
        <form onSubmit={form.handleSubmit}>
            <input data-testid="profile-name" value={form.form.name} onChange={form.setField('name')} />
            <button
                type="button"
                data-testid="profile-source"
                onClick={() => form.setSources([{ bean_id: null, blend_id: 'chosen-blend' }])}
            >
                Select blend
            </button>
        </form>
    );
};

const profileRow = (): RoastProfileWithSource => ({
    id: 'profile',
    name: 'original',
    description: 'old description',
    target_level: 'Medium',
    source_session_id: 'record',
    sources: [{ bean_id: 'old-bean', blend_id: null }],
    default_bean_id: 'old-bean',
    default_blend_id: null,
    charge_temp_celsius: null,
    created_at: '',
    dev_pct: null,
    dev_time_sec: null,
    drop_temp_celsius: null,
    duration_sec: null,
    heater_events: null,
    machine_brand: null,
    machine_id: null,
    machine_name: null,
    machine_protocol: null,
    machine_roaster_key: null,
    updated_at: '',
    user_id: 'owner',
    source_session: null,
    default_bean: null,
    default_blend: null,
});

it('saves only the renamed profile field after its description and sources change elsewhere', async () => {
    const profile = profileRow();
    await act(async () => root.render(createElement(ProfileProbe, { profile })));
    const name = input('[data-testid="profile-name"]');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(name, 'renamed only');
        name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
        root.render(
            createElement(ProfileProbe, {
                profile: {
                    ...profile,
                    description: 'new description',
                    sources: [{ bean_id: 'new-bean', blend_id: null }],
                },
            }),
        ),
    );
    const form = host.querySelector('form');
    if (!form) throw new Error('Missing form');
    await act(async () => form.requestSubmit());
    expect(mocks.profile).toHaveBeenCalledWith({ id: profile.id, name: 'renamed only' });
});

const setters = {
    setTab: () => {},
    setSelectedBeanId: () => {},
    setRestockAmount: () => {},
    setRestockCost: () => {},
    setAdjustType: () => {},
    setAdjustSign: () => {},
    setAdjustAmount: () => {},
    setAdjustNote: () => {},
    setShowAllBeans: () => {},
    setNameIsAuto: () => {},
};
const BeanProbe = ({
    summaries,
    open = true,
    data = null,
}: {
    summaries: Record<string, StockSummary>;
    open?: boolean;
    data?: Bean | null;
}) => {
    const { register, reset, getValues, setValue } = useForm({ defaultValues: EMPTY_BEAN_FORM });
    useAddBeanFormReset({
        open,
        initialTab: data ? 'edit' : 'new',
        initialBeanId: null,
        initialData: data,
        stockSummaries: summaries,
        reset,
        getValues,
        setValue,
        ...setters,
    });
    return (
        <>
            <input data-testid="bean-name" {...register('name')} />
            <input data-testid="bean-stock" {...register('stock')} />
        </>
    );
};

it('preserves the new-bean draft when unrelated stock summaries refresh', async () => {
    const old = { currentGrams: 1000, availableGrams: 1000, reservedGrams: 0, effectiveGrams: 1000 };
    await act(async () => root.render(createElement(BeanProbe, { summaries: { otherBean: old } })));
    const field = input('[data-testid="bean-name"]');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'unsaved new lot');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field.value).toBe('unsaved new lot');
    await act(async () =>
        root.render(
            createElement(BeanProbe, {
                summaries: { otherBean: { ...old, currentGrams: 2000, effectiveGrams: 2000, availableGrams: 2000 } },
            }),
        ),
    );
    expect(field.value).toBe('unsaved new lot');
});

it('keeps a dirty charge on conflict and resets to the latest value with Escape before a new edit', async () => {
    const row = session();
    await render(ChargeWeightEditor, row);
    const field = input('[data-testid="history-charge-weight"]');
    await act(async () => {
        field.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '1100');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await render(ChargeWeightEditor, { ...row, weight_grams: 1200 });
    expect(field.value).toBe('1100');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('history.edit.conflict');
    await blur(field);
    expect(mocks.charge).not.toHaveBeenCalled();
    await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(field.value).toBe('1200');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '1250');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await blur(field);
    expect(mocks.charge).toHaveBeenCalledWith({ sessionId: row.id, weightGrams: 1250 });
});

it('keeps an existing note draft on its ID when a preceding same-comment note is deleted', async () => {
    const a = { id: 'a', type: 'Note', time_sec: 60, note: 'aroma' };
    const b = { id: 'b', type: 'Note', time_sec: 90, note: 'aroma' };
    const row = { ...session(), events: [a, b] };
    await render(RecordTextEditor, row);
    const editing = host.querySelectorAll<HTMLInputElement>('[data-testid="history-recorded-note"]')[1];
    if (!editing) throw new Error('Missing second note');
    await act(async () => {
        editing.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(editing, 'B updated');
        editing.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await render(RecordTextEditor, { ...row, events: [b] });
    expect(input('[data-testid="history-recorded-note"]')).toBe(editing);
    await act(async () => editing.blur());
    expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ expectedEvents: [b], events: [{ ...b, note: 'B updated' }] }),
    );
});

it('accepts its own normalized charge update without a false conflict or a second save', async () => {
    const row = session();
    await render(ChargeWeightEditor, row);
    const field = input('[data-testid="history-charge-weight"]');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '01250');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await blur(field);
    expect(mocks.charge).toHaveBeenCalledWith({ sessionId: row.id, weightGrams: 1250 });
    await render(ChargeWeightEditor, { ...row, weight_grams: 1250 });
    expect(field.value).toBe('1250');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await blur(field);
    expect(mocks.charge).toHaveBeenCalledTimes(1);
});

it('blocks a profile rename when that same name changed elsewhere while preserving the typed name', async () => {
    const profile = profileRow();
    await act(async () => root.render(createElement(ProfileProbe, { profile })));
    const field = input('[data-testid="profile-name"]');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'my name');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => root.render(createElement(ProfileProbe, { profile: { ...profile, name: 'their name' } })));
    const form = host.querySelector('form');
    if (!form) throw new Error('Missing form');
    await act(async () => form.requestSubmit());
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(field.value).toBe('my name');
});

it('accepts a normalized profile rename that already matches the latest name', async () => {
    const profile = profileRow();
    await act(async () => root.render(createElement(ProfileProbe, { profile })));
    const field = input('[data-testid="profile-name"]');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '  same name  ');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => root.render(createElement(ProfileProbe, { profile: { ...profile, name: 'same name' } })));
    const form = host.querySelector('form');
    if (!form) throw new Error('Missing form');
    await act(async () => form.requestSubmit());
    expect(mocks.profile).toHaveBeenCalledWith({ id: profile.id, name: 'same name' });
});

it('saves an explicit profile source change with its matching default fields only', async () => {
    const profile = profileRow();
    await act(async () => root.render(createElement(ProfileProbe, { profile })));
    const button = host.querySelector<HTMLButtonElement>('[data-testid="profile-source"]');
    if (!button) throw new Error('Missing source button');
    await act(async () => button.click());
    const form = host.querySelector('form');
    if (!form) throw new Error('Missing form');
    await act(async () => form.requestSubmit());
    expect(mocks.profile).toHaveBeenCalledWith({
        id: profile.id,
        sources: [{ bean_id: null, blend_id: 'chosen-blend' }],
        default_bean_id: null,
        default_blend_id: 'chosen-blend',
    });
});

it('starts a fresh bean draft after closing and reopening', async () => {
    const summaries = {};
    await act(async () => root.render(createElement(BeanProbe, { summaries })));
    const field = input('[data-testid="bean-name"]');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'draft');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => root.render(createElement(BeanProbe, { summaries, open: false })));
    await act(async () => root.render(createElement(BeanProbe, { summaries, open: true })));
    expect(field.value).toBe('');
});

it('loads refreshed stock into a clean stock field without resetting the bean name or an edited stock value', async () => {
    const data: Bean = {
        id: 'bean',
        user_id: 'owner',
        name: 'original',
        origin: null,
        region: null,
        farm: null,
        process: null,
        variety: null,
        altitude_masl: null,
        capacity_grams: 5000,
        cost_per_kg: null,
        tasting_notes: null,
        created_at: '',
        updated_at: '',
        low_stock_threshold_grams: 1000,
        purchase_date: null,
        vendor: null,
    };
    await act(async () => root.render(createElement(BeanProbe, { summaries: {}, data })));
    const name = input('[data-testid="bean-name"]');
    const stock = input('[data-testid="bean-stock"]');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(name, 'edited name');
        name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const summary = { currentGrams: 2000, availableGrams: 2000, reservedGrams: 0, effectiveGrams: 2000 };
    await act(async () => root.render(createElement(BeanProbe, { summaries: { bean: summary }, data })));
    expect(name.value).toBe('edited name');
    expect(stock.value).toBe('2');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(stock, '3');
        stock.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
        root.render(createElement(BeanProbe, { summaries: { bean: { ...summary, effectiveGrams: 4000 } }, data })),
    );
    expect(name.value).toBe('edited name');
    expect(stock.value).toBe('3');
});
