import { createClient } from 'npm:@supabase/supabase-js@2';
import { jsonResponse } from '../_shared/auth.ts';

const POLAR_WEBHOOK_SECRET = Deno.env.get('POLAR_WEBHOOK_SECRET');

const PLAN_MAP: Record<string, string> = {
    [Deno.env.get('POLAR_PRO_PRODUCT_ID') ?? '']: 'pro',
    [Deno.env.get('POLAR_ENTERPRISE_PRODUCT_ID') ?? '']: 'enterprise',
};

async function verifySignature(body: string, signature: string | null): Promise<boolean> {
    if (!signature || !POLAR_WEBHOOK_SECRET) return false;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(POLAR_WEBHOOK_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const expected = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    return expected === signature;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'content-type, x-webhook-signature',
            },
        });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const body = await req.text();
    const signature = req.headers.get('x-webhook-signature');

    if (!(await verifySignature(body, signature))) {
        console.error('[polar-webhook] invalid signature');
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let event: { type: string; data: Record<string, unknown> };
    try {
        event = JSON.parse(body);
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    switch (event.type) {
        case 'subscription.created':
        case 'subscription.active':
        case 'subscription.updated': {
            const sub = event.data as {
                id: string;
                customer_id: string;
                status: string;
                current_period_start?: string;
                current_period_end?: string;
                cancel_at_period_end?: boolean;
                canceled_at?: string;
                ended_at?: string;
                product_id?: string;
                price_id?: string;
                amount?: number;
                currency?: string;
                recurring_interval?: string;
            };
            const { external_id } = (event.data.customer ?? {}) as { external_id?: string };
            const userId = external_id ?? sub.customer_id;

            const { error: upsertErr } = await supabase
                .from('subscriptions')
                .upsert(
                    {
                        user_id: userId,
                        polar_subscription_id: sub.id,
                        status: sub.status,
                        current_period_start: sub.current_period_start ?? null,
                        current_period_end: sub.current_period_end ?? null,
                        cancel_at_period_end: sub.cancel_at_period_end ?? false,
                        canceled_at: sub.canceled_at ?? null,
                        ends_at: sub.ended_at ?? null,
                        polar_product_id: sub.product_id ?? null,
                        polar_checkout_id: null,
                        amount: sub.amount ?? null,
                        currency: sub.currency ?? null,
                        recurring_interval: sub.recurring_interval ?? null,
                    },
                    { onConflict: 'polar_subscription_id' },
                );

            if (upsertErr) {
                console.error('[polar-webhook] subscription upsert:', upsertErr);
            }

            if (sub.status === 'active' && sub.product_id) {
                const plan = PLAN_MAP[sub.product_id] ?? 'pro';
                const { error: planErr } = await supabase
                    .from('profiles')
                    .update({ plan })
                    .eq('id', userId);

                if (planErr) {
                    console.error('[polar-webhook] plan update:', planErr);
                }
            }
            break;
        }

        case 'subscription.canceled':
        case 'subscription.revoked': {
            const sub = event.data as { id: string; customer_id: string };
            const { external_id } = (event.data.customer ?? {}) as { external_id?: string };
            const userId = external_id ?? sub.customer_id;

            await supabase
                .from('subscriptions')
                .update({ status: event.type === 'subscription.canceled' ? 'canceled' : 'ended' })
                .eq('polar_subscription_id', sub.id);

            const { error: planErr } = await supabase
                .from('profiles')
                .update({ plan: 'free' })
                .eq('id', userId);

            if (planErr) {
                console.error('[polar-webhook] plan revert:', planErr);
            }
            break;
        }

        default:
            break;
    }

    return jsonResponse({ received: true });
});
