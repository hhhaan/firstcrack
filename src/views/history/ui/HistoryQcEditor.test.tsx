// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChargeWeightEditor, QcMeasurementEditor } from './HistoryQcEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { update, setCharge } = vi.hoisted(() => ({
    update: vi.fn(async () => ({ id: 's1' })),
    setCharge: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: { min: number; max: number }) => (vars ? `${key}:${vars.min}-${vars.max}` : key),
    }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));
vi.mock('@entities/roast', () => ({
    useUpdateRoastSession: () => ({ mutateAsync: update, isPending: false }),
    useSetChargeWeight: () => ({ mutateAsync: setCharge, isPending: false }),
}));

const session = {
    id: 's1',
    weight_grams: 1000,
    output_weight_grams: null,
    roast_level: null,
    ambient_temp_celsius: 21.5,
    ambient_humidity_pct: null,
    moisture_pct: null,
    density_g_per_l: null,
} as RoastSessionWithRelations;

describe('History QC editors', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        update.mockClear();
        setCharge.mockClear();
    });

    const render = async (node: ReturnType<typeof createElement>) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(node);
        });
    };

    const field = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;

    const type = async (input: HTMLInputElement, value: string) => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
            setValue?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };

    const blur = async (input: HTMLInputElement, value: string) => {
        await act(async () => {
            input.focus();
        });
        await type(input, value);
        await act(async () => {
            input.blur();
        });
    };

    it('saves a corrected charge and the estimated inbound for that weight', async () => {
        await render(createElement(ChargeWeightEditor, { session }));
        await blur(field('history-charge-weight'), '1200');
        expect(setCharge).toHaveBeenCalledWith({
            sessionId: 's1',
            weightGrams: 1200,
            inboundGrams: 984,
            inboundIsEstimate: true,
        });
    });

    it('leaves an existing zero charge untouched', async () => {
        await render(createElement(ChargeWeightEditor, { session: { ...session, weight_grams: 0 } }));
        await blur(field('history-charge-weight'), '0');
        expect(setCharge).not.toHaveBeenCalled();
        expect(host.textContent).not.toContain('history.expanded.chargeWeightInvalid');
    });

    it('rejects a charge below the measured output', async () => {
        await render(createElement(ChargeWeightEditor, { session: { ...session, output_weight_grams: 850 } }));
        await blur(field('history-charge-weight'), '800');
        expect(setCharge).not.toHaveBeenCalled();
        expect(host.textContent).toContain('history.expanded.chargeWeightInvalid:850-500000');
    });

    it('saves moisture and clears humidity', async () => {
        await render(createElement(QcMeasurementEditor, { session: { ...session, ambient_humidity_pct: 55 } }));
        await blur(field('history-moisture'), '11.2');
        expect(update).toHaveBeenCalledWith({ id: 's1', moisture_pct: 11.2 });
        await blur(field('history-ambient-humidity'), '');
        expect(update).toHaveBeenCalledWith({ id: 's1', ambient_humidity_pct: null });
    });

    it('rejects humidity above 100', async () => {
        await render(createElement(QcMeasurementEditor, { session }));
        await blur(field('history-ambient-humidity'), '101');
        expect(update).not.toHaveBeenCalled();
        expect(host.textContent).toContain('history.expanded.qcInvalid:0-100');
    });
});
