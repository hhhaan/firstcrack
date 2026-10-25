// @vitest-environment jsdom
import type { roastSessionApi } from '@entities/roast/api';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordSections } from './RecordSections';

const mocks = vi.hoisted(() => ({
    update: vi.fn<typeof roastSessionApi.updateRecord>(),
    owner: 'owner',
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: mocks.owner, isWorkspaceReady: true }),
}));
vi.mock('@shared/lib/features', () => ({ useWriteAccess: () => true }));
vi.mock('@entities/roast', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@entities/roast')>()),
    useHistoryChart: () => ({ points: [], isLoading: false }),
    useUpdateRoastRecord: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    useRoastSettings: () => ({ temperatureUnit: 'C', eventButtons: { custom: [] } }),
}));
vi.mock('@features/machine-control/api/useSidecarStatus', () => ({
    useSidecarStatus: () => ({ isSuccess: false, isFetching: false }),
}));
vi.mock('@features/machine-control/ui/HeatStepChart', () => ({ HeatStepChart: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const session = (): RoastSessionWithRelations => ({
    id: 'record',
    user_id: 'owner',
    events: [
        { id: 'charge', type: 'Charge', time_sec: 0, temp_c: 200 },
        { id: 'fc', type: 'FC Start', time_sec: 480, temp_c: 196 },
        { id: 'drop', type: 'Drop', time_sec: 600, temp_c: 210 },
    ],
    heater_events: [{ t: 30, bt: 160, heater: 80, trigger: 'time' }],
    duration_seconds: 600,
    drop_temp_celsius: 210,
    charge_temp_celsius: 200,
    ambient_humidity_pct: null,
    ambient_temp_celsius: null,
    batch_name: null,
    bbp_seconds: null,
    bbp_tsv_path: null,
    bean_id: null,
    bean_label: null,
    blend_id: null,
    color_ground: null,
    color_whole: null,
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
    output_weight_grams: null,
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
    weight_grams: 1000,
    beans: null,
    roast_profiles: null,
});

describe('History record editor baseline', () => {
    let root: Root;
    let host: HTMLDivElement;
    let server: RoastSessionWithRelations;
    const render = (row: RoastSessionWithRelations) =>
        act(async () => root.render(createElement(RecordSections, { key: row.id, session: row })));
    const click = async (selector: string) => {
        const target = document.querySelector<HTMLButtonElement>(selector);
        if (!target) throw new Error(`Missing button ${selector}`);
        await act(async () => target.click());
    };
    const type = async (label: string, value: string) => {
        const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
        if (!input) throw new Error(`Missing field ${label}`);
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    const save = async (text: string) => {
        const button = [...document.querySelectorAll('button')].find((node) => node.textContent === text);
        if (!button) throw new Error(`Missing save button ${text}`);
        await act(async () => button.click());
    };

    beforeEach(() => {
        mocks.owner = 'owner';
        server = session();
        mocks.update.mockReset();
        mocks.update.mockImplementation(async (payload) => {
            if (
                JSON.stringify(payload.expectedEvents) !== JSON.stringify(server.events) ||
                JSON.stringify(payload.expectedHeaterEvents) !== JSON.stringify(server.heater_events)
            )
                throw { code: 'PT409' };
            server = { ...server, events: payload.events, heater_events: payload.heaterEvents };
            return server;
        });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    it('rejects an old event draft after a refreshed record moves FC, and allows reopening on the latest row', async () => {
        const opened = server;
        await render(opened);
        await click('[data-testid="history-edit-events"]');
        await type('FC Start history.edit.temp', '197');
        server = {
            ...opened,
            events: [
                { id: 'charge', type: 'Charge', time_sec: 0, temp_c: 200 },
                { id: 'fc', type: 'FC Start', time_sec: 500, temp_c: 196 },
                { id: 'drop', type: 'Drop', time_sec: 600, temp_c: 210 },
            ],
        };
        const latest = server;
        await render(latest);
        await save('history.edit.save');
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ expectedEvents: opened.events }));
        expect(server).toBe(latest);
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('history.edit.conflict');
        expect(document.querySelector<HTMLInputElement>('input[aria-label="FC Start history.edit.temp"]')?.value).toBe(
            '197',
        );
        await save('common.cancel');
        await click('[data-testid="history-edit-events"]');
        expect(
            document.querySelector<HTMLInputElement>('input[aria-label="FC Start history.edit.time"]')?.value,
        ).toMatch(/^0?8:20$/);
        await type('FC Start history.edit.temp', '198');
        await save('history.edit.save');
        expect(server.events).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'fc', time_sec: 500, temp_c: 198 })]),
        );
    });

    it('rejects an old Heat set draft after another editor changes the plan', async () => {
        const opened = server;
        await render(opened);
        await click('[data-testid="history-edit-heat"]');
        server = { ...opened, heater_events: [{ t: 30, bt: 160, heater: 60, trigger: 'time' }] };
        const latest = server;
        await render(latest);
        await save('heaterEventsEditor.save');
        expect(mocks.update).toHaveBeenCalledWith(
            expect.objectContaining({ expectedHeaterEvents: opened.heater_events }),
        );
        expect(server).toBe(latest);
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('history.edit.conflict');
    });

    it('rechecks workspace ownership when submitting an already open dialog', async () => {
        await render(server);
        await click('[data-testid="history-edit-events"]');
        await type('FC Start history.edit.temp', '197');
        mocks.owner = 'other-owner';
        await render(server);
        await save('history.edit.save');
        expect(mocks.update).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('history.edit.readOnly');
    });

    it('closes the old dialog when another record replaces the detail view', async () => {
        await render(server);
        await click('[data-testid="history-edit-events"]');
        await type('FC Start history.edit.temp', '197');
        await render({ ...server, id: 'other-record' });
        expect(document.querySelector('[data-testid="record-events-editor"]')).toBeNull();
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
