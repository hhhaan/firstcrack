import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { checkoutProduct } from '../_shared/polar.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';

const POLAR_ACCESS_TOKEN = Deno.env.get('POLAR_ACCESS_TOKEN');

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

    const polarProductId = checkoutProduct(priceId, (key) => Deno.env.get(key));
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
            metadata: { user_id: user.id },
            products: [polarProductId],
        }),
    });

    if (!checkoutRes.ok) {
        console.error('[create-polar-checkout] checkout create failed:', checkoutRes.status);
        await captureEdgeException(new Error(`polar checkout ${checkoutRes.status}`), {
            function: 'create-polar-checkout',
            status: 500,
            extra: { polarStatus: checkoutRes.status },
        });
        return jsonResponse({ error: 'Failed to create checkout' }, 500);
    }

    const checkout = await checkoutRes.json();
    return jsonResponse({ url: checkout.url });
});
