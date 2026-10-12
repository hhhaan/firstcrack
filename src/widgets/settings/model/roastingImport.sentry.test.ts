import * as Sentry from '@sentry/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { importArtisanGraphSettings, importMachines, machinesState } = vi.hoisted(() => ({
    importArtisanGraphSettings: vi.fn(),
    importMachines: vi.fn(),
    machinesState: {
        machines: [] as Array<{
            id: string;
            name: string;
            roasterKey: string;
            connectionParams: Record<string, unknown>;
            createdAt: string;
            importSource: null;
        }>,
    },
}));

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), init: vi.fn() };
});

vi.mock('@features/active-roast', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@features/active-roast')>();
    return { ...actual, importArtisanGraphSettings };
});

vi.mock('@entities/machine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/machine')>();
    return {
        ...actual,
        useMachines: {
            getState: () => ({
                machines: machinesState.machines,
                importMachines,
            }),
        },
    };
});

import { buildSentryOptions } from '@shared/lib/sentry';
import { type ImportCandidate, saveRoastingImport } from './roastingImport';

describe('saveRoastingImport sentry', () => {
    beforeEach(() => {
        vi.mocked(Sentry.captureException).mockClear();
        importArtisanGraphSettings.mockReset();
        importMachines.mockReset();
    });

    it('beforeSend drops paths/IPs from roasting import failures', async () => {
        importArtisanGraphSettings.mockRejectedValue(new Error('graph failed /Users/secret/path 10.0.0.2:502'));
        const result = await saveRoastingImport({
            product: 'Artisan',
            selected: [],
            includeGraph: true,
            hasGraph: true,
            artisan: {
                status: 'found',
                source: { product: 'Artisan', version: '1', sourceId: 'native' },
                settings: {},
            },
            cropster: undefined,
            firescope: undefined,
            unit: null,
            plan: 'pro',
        });
        expect(result).toBe('failed');
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [captured] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect(captured).toMatchObject({ name: 'Error', message: 'Error' });

        const { beforeSend } = buildSentryOptions();
        const scrubbed = beforeSend(
            {
                type: undefined,
                message: (captured as Error).message,
                exception: { values: [{ type: (captured as Error).name, value: String(captured) }] },
            },
            { originalException: captured },
        );
        const blob = JSON.stringify(scrubbed);
        expect(blob).not.toContain('/Users/');
        expect(blob).not.toMatch(/\d{1,3}(?:\.\d{1,3}){3}/);
    });

    it('does not capture expected machine limit races', async () => {
        machinesState.machines = [
            {
                id: 'real-1',
                name: 'Roaster',
                roasterKey: 'virtual',
                connectionParams: {},
                createdAt: '',
                importSource: null,
            },
        ];
        const result = await saveRoastingImport({
            product: 'Artisan',
            selected: [
                {
                    sequence: 1,
                    current: false,
                    mapping: {
                        sourceId: 'x',
                        draft: { name: 'm', roasterKey: 'virtual', connectionParams: {} },
                    },
                    existing: undefined,
                    update: null,
                    connection: { serial: false, endpoint: null, subtype: null, protocol: null },
                },
            ] as ImportCandidate[],
            includeGraph: false,
            hasGraph: false,
            artisan: undefined,
            cropster: undefined,
            firescope: undefined,
            unit: null,
            plan: 'pro',
        });
        expect(result).toBe('failed');
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});
