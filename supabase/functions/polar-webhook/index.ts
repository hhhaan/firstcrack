import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import { deliverPolarNotification, polarNotificationPayload } from '../_shared/polar-notifications.ts';
import { postSlack } from '../_shared/slack.ts';
import { NEW_POLAR_ORG, OLD_POLAR_ORG, polarPlans, polarUser } from '../_shared/polar.ts';
import { respondServerError, serveWithSentry } from '../_shared/sentry.ts';
import { verifyPolarSignature } from '../_shared/webhook-auth.ts';
import { verifyPolarStandardSignature } from '../_shared/polar-auth.ts';

const env = (key: string) => Deno.env.get(key);

serveWithSentry('polar-webhook', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const body = await req.text();
    const standard = req.headers.has('webhook-signature') || req.headers.has('webhook-id') || req.headers.has('webhook-timestamp');
    let org: string | undefined;
    for (const [secretName, organization] of [
        ['POLAR_WEBHOOK_SECRET', OLD_POLAR_ORG],
        ['POLAR_WEBHOOK_SECRET_NEW', NEW_POLAR_ORG],
    ]) {
        const secret = env(secretName);
        if (standard ? await verifyPolarStandardSignature(secret, body, req.headers, Date.now(), organization === OLD_POLAR_ORG)
            : organization === OLD_POLAR_ORG && await verifyPolarSignature(secret, body, req.headers.get('x-webhook-signature'))) {
            org = organization;
            break;
        }
    }
    if (!org) return jsonResponse({ error: 'Unauthorized' }, 401);
    let event: { type: string; timestamp?: string; data: Record<string, unknown> };
    try {
        event = JSON.parse(body);
        if (!event || typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') throw new Error();
    } catch {
        return jsonResponse({ error: 'Invalid event' }, 400);
    }
    if (!['order.paid','subscription.created','subscription.active','subscription.updated','subscription.canceled','subscription.revoked','subscription.uncanceled'].includes(event.type)) {
        return jsonResponse({ received: true });
    }
    try {
        const client = serviceClient();
        const notify = async () => {
            if (typeof event.data.id !== 'string' || !event.data.id) throw new Error('Missing notification resource ID');
            await deliverPolarNotification(client, org!, `${event.type}:${event.data.id}`,
                polarNotificationPayload(event.type, event.data, polarPlans(env, org!)[String(event.data.product_id)]), postSlack);
        };
        if (event.type === 'order.paid') {
            await notify();
            return jsonResponse({ received: true });
        }
        const sub = { ...event.data };
        const product = sub.product as Record<string, unknown> | undefined;
        if (product?.organization_id && product.organization_id !== org) return jsonResponse({ error: 'Organization mismatch' }, 400);
        if (event.type === 'subscription.revoked') sub.status = 'revoked';
        if (event.type === 'subscription.canceled') {
            sub.status = 'canceled';
            sub.cancel_at_period_end = true;
        }
        if (event.type === 'subscription.uncanceled') sub.cancel_at_period_end = false;
        if (sub.trial_end == null && sub.trial_end_at != null) sub.trial_end = sub.trial_end_at;
        const userId = polarUser(sub);
        const plan = typeof sub.product_id === 'string' ? polarPlans(env, org)[sub.product_id] : undefined;
        if (!plan && !['revoked','ended'].includes(String(sub.status))) {
            return jsonResponse({ error: 'Unknown subscription product' }, 422);
        }
        const signedTime = req.headers.get('webhook-timestamp');
        const eventAt = event.timestamp ?? (standard && signedTime ? new Date(Number(signedTime) * 1000).toISOString() : undefined);
        if (!eventAt || !Number.isFinite(Date.parse(eventAt))) return jsonResponse({ error: 'Missing event timestamp' }, 400);
        const eventId = req.headers.get('webhook-id') ?? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), x => x.toString(16).padStart(2,'0')).join('');
        const { error } = await client.rpc('apply_polar_subscription_event', {
            p_org_id: org, p_event_id: eventId, p_event_at: eventAt, p_user_id: userId,
            p_customer_id: sub.customer_id, p_subscription: sub,
            p_plan: plan ?? null,
        });
        if (error) throw new Error(`Polar event transaction failed: ${error.code}`);
        // Retry notices even when the entitlement transaction already says duplicate/stale.
        if (event.type === 'subscription.created') await notify();
    } catch (error) {
        // Operational alerts are best effort, separate from idempotent payment notices.
        await postSlack({ text: '*Polar edge webhook error*\nBilling event processing failed; inspect server monitoring.' });
        return respondServerError('polar-webhook', 'Internal error', error);
    }
    return jsonResponse({ received: true });
});
