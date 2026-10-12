import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureRoastingImportFailure, importArtisanGraphSettings, importMachines } = vi.hoisted(() => ({
    captureRoastingImportFailure: vi.fn(),
    importArtisanGraphSettings: vi.fn(),
    importMachines: vi.fn(),
}));
vi.mock('@shared/lib/sentry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sentry')>();
    return { ...actual, captureRoastingImportFailure };
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
                machines: [],
                importMachines,
            }),
        },
    };
});

import { saveRoastingImport } from './roastingImport';

describe('saveRoastingImport sentry', () => {
    beforeEach(() => {
        captureRoastingImportFailure.mockClear();
        importArtisanGraphSettings.mockReset();
        importMachines.mockReset();
    });

    it('captures graph failures with stage=graph and counts, without snapshot content', async () => {
        importArtisanGraphSettings.mockRejectedValue(new Error('graph failed /Users/secret/path'));
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
        expect(captureRoastingImportFailure).toHaveBeenCalledTimes(1);
        const [, payload] = captureRoastingImportFailure.mock.calls[0];
        expect(payload).toMatchObject({
            product: 'Artisan',
            stage: 'graph',
            counts: { selected: 0, pending: 0, updates: 0 },
        });
        const blob = JSON.stringify(captureRoastingImportFailure.mock.calls[0]);
        expect(blob).not.toContain('/Users/');
    });
});
