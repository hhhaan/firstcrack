/**
 * Structural contracts for offline POS / ERP integration docs.
 * Uses Vite `?raw` so browser tsconfig does not need Node types.
 */
import { describe, expect, it } from 'vitest';
import posOpenapi from '../../../docs/agent/pos-openapi-integrations.md?raw';
import tossPlace from '../../../docs/agent/toss-place-integration.md?raw';

describe('docs/agent/toss-place-integration.md', () => {
    it('exists and is non-empty', () => {
        expect(tossPlace.length).toBeGreaterThan(2000);
    });

    it('covers auth/tenancy with real Toss key headers and merchant path', () => {
        expect(tossPlace).toMatch(/x-access-key/);
        expect(tossPlace).toMatch(/x-secret-key/);
        expect(tossPlace).toMatch(/merchantId/);
        expect(tossPlace).toMatch(/open-api\.tossplace\.com\/api-public\/openapi\/v1\/merchants/);
        expect(tossPlace).toMatch(/sales_channel_secrets|TOSS_PLACE_ACCESS_KEY/);
        expect(tossPlace).not.toMatch(/VITE_TOSS/);
    });

    it('defines order+payment pull, webhooks, rate limits from docs', () => {
        expect(tossPlace).toMatch(/GET.*\/order\/orders|\/order\/orders\?from/);
        expect(tossPlace).toMatch(/payment\/payments\/by-order-id/);
        expect(tossPlace).toMatch(/order\.order\.completed\.v1/);
        expect(tossPlace).toMatch(/payment\.payment\.approved\.v1/);
        expect(tossPlace).toMatch(/x-toss-signature/);
        expect(tossPlace).toMatch(/HMAC-SHA256/);
        expect(tossPlace).toMatch(/v1=/);
        expect(tossPlace).toMatch(/100/);
        expect(tossPlace).toMatch(/10/);
        expect(tossPlace).toMatch(/Token Bucket|token bucket|토큰/i);
    });

    it('maps offline ERP to orders SSoT and pull-only POS (no dispatch)', () => {
        expect(tossPlace).toMatch(/orders/);
        expect(tossPlace).toMatch(/order_lines/);
        expect(tossPlace).toMatch(/COMPLETED/);
        expect(tossPlace).toMatch(/CANCELLED/);
        expect(tossPlace).toMatch(/fulfill_order|cancel_order/);
        expect(tossPlace).toMatch(/outboundDispatch:\s*false|pull-only|order-dispatch.*not/i);
        expect(tossPlace).toMatch(/toss_place/);
    });

    it('defers tax accounting and states catalog SKU mapping', () => {
        expect(tossPlace).toMatch(/taxAmount/);
        expect(tossPlace).toMatch(/supplyAmount/);
        expect(tossPlace).toMatch(/taxExemptAmount/);
        expect(tossPlace).toMatch(/Deferred|defer|later|나중에|v1/i);
        expect(tossPlace).toMatch(/item\.code|OrderLineItem\.item\.code/);
        expect(tossPlace).toMatch(/products\.sku/);
        expect(tossPlace).toMatch(/Toss Payments/);
    });

    it('names concrete repo touch points', () => {
        expect(tossPlace).toMatch(/docs\/agent\/sales-channels-orders\.md/);
        expect(tossPlace).toMatch(/supabase\/functions\/_shared\/channels/);
        expect(tossPlace).toMatch(/channel-connect/);
        expect(tossPlace).toMatch(/order-sync/);
        expect(tossPlace).toMatch(/order-webhook/);
    });
});

describe('docs/agent/pos-openapi-integrations.md', () => {
    it('covers KR JP US Open API POS targets', () => {
        expect(posOpenapi.length).toBeGreaterThan(2000);
        expect(posOpenapi).toMatch(/toss_place/);
        expect(posOpenapi).toMatch(/smaregi|スマレジ/);
        expect(posOpenapi).toMatch(/square/i);
        expect(posOpenapi).toMatch(/shopify/i);
        expect(posOpenapi).toMatch(/## 4\. Korea|## 5\. Japan|## 6\. United States/);
        expect(posOpenapi).toMatch(/developers\.smaregi\.dev|smaregi\.jp\/developers/);
        expect(posOpenapi).toMatch(/developer\.squareup\.com/);
        expect(posOpenapi).toMatch(/orders\/order_lines|order_lines/);
        expect(posOpenapi).toMatch(/outboundDispatch:\s*false|pull-only/i);
        expect(posOpenapi).toMatch(/Ubiregi|ユビレジ/);
        expect(posOpenapi).toMatch(/AirREGI|Airレジ/);
    });
});
