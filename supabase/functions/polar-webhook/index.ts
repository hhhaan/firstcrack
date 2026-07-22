import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import { captureEdgeException } from '../_shared/sentry.ts';
import { postSlack } from '../_shared/slack.ts';
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

function sanitize(s: string): string {
    return s.replace(/[\r\n`]/g, ' ').trim();
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
    if (amount == null) return '—';
    const cur = (currency ?? 'usd').toUpperCase();
    return `${cur} ${(amount / 100).toFixed(2)}`;
}

async function notifyPayment(lines: string[]): Promise<void> {
    await postSlack({ text: lines.join('\n') });
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

    try {
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

                const { error: upsertErr } = await supabase.from('subscriptions').upsert(
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
                    throw new Error(`subscription upsert: ${upsertErr.message}`);
                }

                if (sub.status === 'active' && sub.product_id) {
                    const plan = PLAN_MAP[sub.product_id];
                    if (plan) {
                        const { error: planErr } = await supabase
                            .from('profiles')
                            .update({ plan })
                            .eq('id', userId);
                        if (planErr) throw new Error(`plan update: ${planErr.message}`);
                    } else {
                        console.error(
                            '[polar-webhook] unknown product_id, skip plan update',
                            sub.product_id,
                        );
                    }
                }

                // Prefer order.paid for money; only notify subscription.created once per new sub.
                if (event.type === 'subscription.created') {
                    const planLabel = sub.product_id ? (PLAN_MAP[sub.product_id] ?? sub.product_id) : '—';
                    await notifyPayment([
                        '*Payment / subscription (edge)*',
                        `• user: \`${sanitize(String(userId))}\``,
                        `• status: \`${sanitize(sub.status)}\``,
                        `• plan: \`${sanitize(String(planLabel))}\``,
                        `• amount: \`${sanitize(formatMoney(sub.amount, sub.currency))}\``,
                        ...(sub.recurring_interval
                            ? [`• interval: \`${sanitize(sub.recurring_interval)}\``]
                            : []),
                    ]);
                }
                break;
            }

            case 'order.paid': {
                const order = event.data as {
                    amount?: number;
                    total_amount?: number;
                    currency?: string;
                    status?: string;
                    product_id?: string;
                    customer_id?: string;
                };
                const { external_id } = (event.data.customer ?? {}) as { external_id?: string };
                const userId = external_id ?? order.customer_id ?? 'unknown';
                await notifyPayment([
                    '*Payment received (order.paid / edge)*',
                    `• user: \`${sanitize(String(userId))}\``,
                    `• amount: \`${sanitize(formatMoney(order.amount ?? order.total_amount, order.currency))}\``,
                    `• status: \`${sanitize(order.status ?? 'paid')}\``,
                ]);
                break;
            }

            case 'subscription.canceled':
            case 'subscription.revoked': {
                const sub = event.data as { id: string; customer_id: string };
                const { external_id } = (event.data.customer ?? {}) as { external_id?: string };
                const userId = external_id ?? sub.customer_id;

                const { error: statusErr } = await supabase
                    .from('subscriptions')
                    .update({ status: event.type === 'subscription.canceled' ? 'canceled' : 'ended' })
                    .eq('polar_subscription_id', sub.id);

                if (statusErr) {
                    throw new Error(`subscription status update: ${statusErr.message}`);
                }

                // Cancel/lapse never re-grants free usage — data stays readable, writes stop.
                const { error: planErr } = await supabase
                    .from('profiles')
                    .update({ plan: 'read_only' })
                    .eq('id', userId);

                if (planErr) {
                    throw new Error(`plan revert: ${planErr.message}`);
                }
                break;
            }

            default:
                break;
        }
    } catch (err) {
        console.error('[polar-webhook] error', err);
        await Promise.all([
            captureEdgeException(err, {
                tags: { component: 'polar-webhook', event_type: event.type },
            }),
            postSlack({
                text: [
                    '*Polar edge webhook error*',
                    `• event: \`${sanitize(event.type)}\``,
                    `• error: \`${sanitize(err instanceof Error ? err.message : String(err))}\``,
                ].join('\n'),
            }),
        ]);
        return jsonResponse({ error: 'Internal error' }, 500);
    }

    return jsonResponse({ received: true });
});
