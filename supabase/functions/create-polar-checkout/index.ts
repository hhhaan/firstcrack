import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';

const POLAR_ACCESS_TOKEN = Deno.env.get('POLAR_ACCESS_TOKEN');

/**
 * `priceId` is used as an env key — without this allow-list any env var name
 * (e.g. SUPABASE_SERVICE_ROLE_KEY) could be resolved and its value shipped to
 * the Polar API as a product id (issue #156).
 *
 * Names match `polar-webhook` PLAN_MAP (legacy) and the geo-pricing scheme
 * `POLAR_{PLAN}_PRODUCT_ID_{MARKET}[_YEARLY]` (docs/pricing/FINAL.md).
 */
const ALLOWED_PRICE_IDS = new Set([
    // legacy single-market keys
    'POLAR_PRO_PRODUCT_ID',
    'POLAR_PRO_PLUS_PRODUCT_ID',
    'POLAR_ENTERPRISE_PRODUCT_ID',
    // geo pricing
    'POLAR_PRO_PRODUCT_ID_US',
    'POLAR_PRO_PRODUCT_ID_KR',
    'POLAR_PRO_PRODUCT_ID_JP',
    'POLAR_PRO_PLUS_PRODUCT_ID_US',
    'POLAR_PRO_PLUS_PRODUCT_ID_KR',
    'POLAR_PRO_PLUS_PRODUCT_ID_JP',
    'POLAR_PRO_PRODUCT_ID_US_YEARLY',
    'POLAR_PRO_PRODUCT_ID_KR_YEARLY',
    'POLAR_PRO_PRODUCT_ID_JP_YEARLY',
    'POLAR_PRO_PLUS_PRODUCT_ID_US_YEARLY',
    'POLAR_PRO_PLUS_PRODUCT_ID_KR_YEARLY',
    'POLAR_PRO_PLUS_PRODUCT_ID_JP_YEARLY',
]);

serveWithSentry('create-polar-checkout', async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (!POLAR_ACCESS_TOKEN) {
        console.error('[create-polar-checkout] missing env vars');
        await captureEdgeException(new Error('POLAR_ACCESS_TOKEN is not set'), {
            function: 'create-polar-checkout',
            status: 500,
        });
        return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    // Auth before any input handling — an unauthenticated caller must not be
    // able to probe which price ids (env keys) are configured.
    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'invalid_json_body' }, 400);
    }

    const priceId = body?.priceId;
    if (typeof priceId !== 'string' || !priceId.trim()) {
        return jsonResponse({ error: 'missing_price_id' }, 400);
    }

    if (!ALLOWED_PRICE_IDS.has(priceId)) {
        return jsonResponse({ error: 'invalid_price_id' }, 400);
    }

    const polarProductId = Deno.env.get(priceId);
    if (!polarProductId) {
        return jsonResponse({ error: 'invalid_price_id' }, 400);
    }

    const checkoutRes = await fetch('https://api.polar.sh/v1/checkouts', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            external_customer_id: user.id,
            products: [polarProductId],
        }),
    });

    if (!checkoutRes.ok) {
        const errBody = await checkoutRes.text();
        console.error('[create-polar-checkout] checkout create:', errBody);
        await captureEdgeException(new Error(`polar checkout ${checkoutRes.status}`), {
            function: 'create-polar-checkout',
            status: 500,
            extra: { polarStatus: checkoutRes.status, polarBody: errBody.slice(0, 500) },
        });
        return jsonResponse({ error: 'Failed to create checkout' }, 500);
    }

    const checkout = await checkoutRes.json();
    return jsonResponse({ url: checkout.url });
});
