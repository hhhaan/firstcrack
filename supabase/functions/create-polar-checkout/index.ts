import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/auth.ts';

const POLAR_ACCESS_TOKEN = Deno.env.get('POLAR_ACCESS_TOKEN');
const POLAR_ORG_ID = Deno.env.get('POLAR_ORG_ID');

const PRICE_MAP: Record<string, string | undefined> = {
    POLAR_PRO_PRICE_ID: Deno.env.get('POLAR_PRO_PRICE_ID'),
    POLAR_ENTERPRISE_PRICE_ID: Deno.env.get('POLAR_ENTERPRISE_PRICE_ID'),
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (!POLAR_ACCESS_TOKEN || !POLAR_ORG_ID) {
        console.error('[create-polar-checkout] missing env vars');
        return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    let body: { priceId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const polarPriceId = body.priceId ? PRICE_MAP[body.priceId] : undefined;
    if (!polarPriceId) {
        return jsonResponse({ error: 'Invalid price ID' }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('polar_customer_id')
        .eq('id', user.id)
        .single();

    if (profileErr) {
        console.error('[create-polar-checkout] profile fetch:', profileErr);
        return jsonResponse({ error: 'Failed to load profile' }, 500);
    }

    let customerId = profile?.polar_customer_id;

    if (!customerId) {
        const customerRes = await fetch('https://api.polar.sh/v1/customers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                organization_id: POLAR_ORG_ID,
                email: user.email,
                name: user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? '',
            }),
        });

        if (!customerRes.ok) {
            const errBody = await customerRes.text();
            console.error('[create-polar-checkout] customer create:', errBody);
            return jsonResponse({ error: 'Failed to create customer' }, 500);
        }

        const customer = await customerRes.json();
        customerId = customer.id;

        const { error: updateErr } = await supabase
            .from('profiles')
            .update({ polar_customer_id: customerId })
            .eq('id', user.id);

        if (updateErr) {
            console.error('[create-polar-checkout] update polar_customer_id:', updateErr);
        }
    }

    const checkoutRes = await fetch('https://api.polar.sh/v1/checkouts/custom', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            customer_id: customerId,
            product_price_id: polarPriceId,
            success_url: 'firstcrack://checkout/success',
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
