/**
 * Structural contract for the Toss Place offline sales / ERP integration plan.
 * Reads the real shipped markdown (not a re-implemented summary).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const planPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../docs/agent/toss-place-integration.md',
);

function loadPlan(): string {
    return readFileSync(planPath, 'utf8');
}

describe('docs/agent/toss-place-integration.md', () => {
    it('exists and is non-empty', () => {
        const plan = loadPlan();
        expect(plan.length).toBeGreaterThan(2000);
    });

    it('covers auth/tenancy with real Toss key headers and merchant path', () => {
        const plan = loadPlan();
        expect(plan).toMatch(/x-access-key/);
        expect(plan).toMatch(/x-secret-key/);
        expect(plan).toMatch(/merchantId/);
        expect(plan).toMatch(/open-api\.tossplace\.com\/api-public\/openapi\/v1\/merchants/);
        expect(plan).toMatch(/sales_channel_secrets|TOSS_PLACE_ACCESS_KEY/);
        expect(plan).not.toMatch(/VITE_TOSS/);
    });

    it('defines order+payment pull, webhooks, rate limits from docs', () => {
        const plan = loadPlan();
        expect(plan).toMatch(/GET.*\/order\/orders|\/order\/orders\?from/);
        expect(plan).toMatch(/payment\/payments\/by-order-id/);
        expect(plan).toMatch(/order\.order\.completed\.v1/);
        expect(plan).toMatch(/payment\.payment\.approved\.v1/);
        expect(plan).toMatch(/x-toss-signature/);
        expect(plan).toMatch(/HMAC-SHA256/);
        expect(plan).toMatch(/v1=/);
        expect(plan).toMatch(/100/);
        expect(plan).toMatch(/10/);
        expect(plan).toMatch(/Token Bucket|token bucket|토큰/i);
    });

    it('maps offline ERP to orders SSoT and pull-only POS (no dispatch)', () => {
        const plan = loadPlan();
        expect(plan).toMatch(/orders/);
        expect(plan).toMatch(/order_lines/);
        expect(plan).toMatch(/COMPLETED/);
        expect(plan).toMatch(/CANCELLED/);
        expect(plan).toMatch(/fulfill_order|cancel_order/);
        expect(plan).toMatch(/outboundDispatch:\s*false|pull-only|order-dispatch.*not/i);
        expect(plan).toMatch(/toss_place/);
    });

    it('defers tax accounting and states catalog SKU mapping', () => {
        const plan = loadPlan();
        expect(plan).toMatch(/taxAmount/);
        expect(plan).toMatch(/supplyAmount/);
        expect(plan).toMatch(/taxExemptAmount/);
        expect(plan).toMatch(/Deferred|defer|later|나중에|v1/i);
        expect(plan).toMatch(/item\.code|OrderLineItem\.item\.code/);
        expect(plan).toMatch(/products\.sku/);
        expect(plan).toMatch(/Toss Payments/);
    });

    it('names concrete repo touch points', () => {
        const plan = loadPlan();
        expect(plan).toMatch(/docs\/agent\/sales-channels-orders\.md/);
        expect(plan).toMatch(/supabase\/functions\/_shared\/channels/);
        expect(plan).toMatch(/channel-connect/);
        expect(plan).toMatch(/order-sync/);
        expect(plan).toMatch(/order-webhook/);
    });
});
