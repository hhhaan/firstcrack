import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';

const POLAR_ACCESS_TOKEN = Deno.env.get('POLAR_ACCESS_TOKEN');

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (!POLAR_ACCESS_TOKEN) {
        console.error('[create-polar-checkout] missing env vars');
        return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    const { priceId } = await req.json();

    const polarProductId = Deno.env.get(priceId);
    if (!polarProductId) {
        return jsonResponse({ error: 'Invalid price ID' }, 400);
    }

    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const checkoutRes = await fetch('https://api.polar.sh/v1/checkouts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
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
        return jsonResponse({ error: 'Failed to create checkout' }, 500);
    }

    const checkout = await checkoutRes.json();
    return jsonResponse({ url: checkout.url });
});
