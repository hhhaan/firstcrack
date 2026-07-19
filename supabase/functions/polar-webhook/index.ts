import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import { verifyPolarSignature } from '../_shared/webhook-auth.ts';

const POLAR_WEBHOOK_SECRET = Deno.env.get('POLAR_WEBHOOK_SECRET');

/** product_id → profiles.plan. Empty env keys are omitted so missing secrets never map. */
const PLAN_MAP: Record<string, string> = {};
for (const [envKey, plan] of [
    ['POLAR_PRO_PRODUCT_ID', 'pro'],
    ['POLAR_PRO_PLUS_PRODUCT_ID', 'pro_plus'],
    ['POLAR_ENTERPRISE_PRODUCT_ID', 'enterprise'],
] as const) {
    const productId = Deno.env.get(envKey);
    if (productId) PLAN_MAP[productId] = plan;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                ...corsHeaders,
                'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, x-webhook-signature`,
            },
        });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const body = await req.text();
    const signature = req.headers.get('x-webhook-signature');

    if (!(await verifyPolarSignature(POLAR_WEBHOOK_SECRET, body, signature))) {
        console.error('[polar-webhook] invalid signature');
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let event: { type: string; data: Record<string, unknown> };
    try {
        event = JSON.parse(body);
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const supabase = serviceClient();

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
                const plan = PLAN_MAP[sub.product_id];
                if (plan) {
                    const { error: planErr } = await supabase
                        .from('profiles')
                        .update({ plan })
                        .eq('id', userId);
                    if (planErr) console.error('[polar-webhook] plan update:', planErr);
                } else {
                    // fail-closed: unknown product must not silently grant 'pro'
                    console.error('[polar-webhook] unknown product_id, skip plan update', sub.product_id);
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

            // Cancel/lapse never re-grants free usage — data stays readable, writes stop.
            const { error: planErr } = await supabase
                .from('profiles')
                .update({ plan: 'read_only' })
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
