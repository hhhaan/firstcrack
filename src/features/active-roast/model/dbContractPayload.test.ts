import { writeFileSync } from 'node:fs';

import type { QueryClient } from '@tanstack/react-query';
import { QueryClient as QueryClientImpl } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { type SaveRoastDeps, type SaveRoastParams, saveRoastCore } from './useSaveRoast';

/** Keep in sync with scripts/run-db-contracts.sh */
const CONTRACT_OWNER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Auto-drop elapsed from #619. text::integer rejects this; the RPC must round it. */
const FRACTIONAL_DURATION_SECONDS = 686.0298693847657;

const params: SaveRoastParams = {
    formData: {
        notes: '',
        weightGrams: 1,
        roastLevel: 'city',
        beanId: null,
        beanLabel: 'sample lot',
        deductStock: false,
    },
    handoffBeanName: null,
    sessionId: SESSION_ID,
    userId: process.env.DB_CONTRACT_OWNER ?? CONTRACT_OWNER_ID,
    elapsed: FRACTIONAL_DURATION_SECONDS,
    roastStartTimeRef: { current: 1_750_000_000_000 },
    rawBT: 205.4,
    selectedBeanId: null,
    targetProfileId: null,
    planBatchHandoff: null,
    logEntries: [
        { id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '', tempC: 180, note: '' },
        {
            id: '2',
            time: '11:26',
            timeSec: FRACTIONAL_DURATION_SECONDS,
            event: 'Drop',
            temp: '',
            tempC: 205.4,
            note: '',
        },
    ],
};

function deps(saveOp: SaveRoastDeps['saveOp']): SaveRoastDeps {
    return {
        plan: 'pro',
        qc: new QueryClientImpl({ defaultOptions: { queries: { retry: false } } }) as QueryClient,
        countCompletedThisMonth: vi.fn().mockResolvedValue(0),
        countCompletedTotal: vi.fn().mockResolvedValue(0),
        saveOp,
        flushCurve: vi.fn().mockResolvedValue(undefined),
    };
}

describe('db contract payload', () => {
    it('builds the #619 save_roast_op call from saveRoastCore', async () => {
        const saveOp = vi.fn().mockResolvedValue({ id: SESSION_ID });
        await saveRoastCore(deps(saveOp), params);

        const call = saveOp.mock.calls[0][0] as {
            session: { duration_seconds: number; weight_grams: number; id: string; user_id: string };
            deduct: boolean;
            deductionGrams: number;
            inboundGrams: number;
            inboundIsEstimate: boolean;
        };
        expect(call.session.duration_seconds).toBe(FRACTIONAL_DURATION_SECONDS);
        expect(Number.isInteger(call.session.duration_seconds)).toBe(false);
        expect(call.session.weight_grams).toBe(1000);
        expect(call.session.id).toBe(SESSION_ID);
        expect(call.deduct).toBe(false);

        const out = process.env.DB_CONTRACT_OUT;
        if (out) {
            writeFileSync(out, JSON.stringify({ save_roast_619: call }));
        }
    });
});
