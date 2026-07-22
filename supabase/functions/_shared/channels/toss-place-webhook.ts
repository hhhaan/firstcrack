/**
 * Toss Place order-webhook domain handler.
 * Extracted from Deno.serve so verify→parse→lookup→refetch→map→upsert is one SRP unit.
 */

import { verifyTossPlaceSignature } from '../webhook-auth.ts';
import { upsertCanonicalOrders } from './normalize.ts';
import { fetchTossPlaceOrderById, mapTossPlaceOrder, type TossPlaceOrderRaw } from './toss-place.ts';

export type TossWebhookResult = { status: number; body: Record<string, unknown> };

type ConnRow = {
    id: string;
    user_id: string;
    auto_fulfill_on_shipped: boolean | null;
    status: string;
};

/** serviceClient()-compatible; chaining is dynamic at runtime. */
// biome-ignore lint/suspicious/noExplicitAny: Supabase query builder is structural, not imported here
type AdminClient = { from: (table: string) => any };

async function recordWebhookDelivery(
    admin: AdminClient,
    deliveryId: string | null,
): Promise<'new' | 'duplicate' | 'skip'> {
    if (!deliveryId) return 'skip';
    const { error } = await admin.from('channel_webhook_deliveries').insert({
        platform: 'toss_place',
        delivery_id: deliveryId,
    });
    if (!error) return 'new';
    // unique violation = already processed
    if (error.code === '23505') return 'duplicate';
    console.error('[order-webhook] toss_place delivery insert', error);
    return 'new'; // fail-open on table errors so orders still ingest
}

async function upsertAndLog(
    admin: AdminClient,
    conn: ConnRow,
    orders: NonNullable<ReturnType<typeof mapTossPlaceOrder>>[],
): Promise<void> {
    await upsertCanonicalOrders(
        admin,
        {
            userId: conn.user_id,
            connectionId: conn.id,
            platform: 'toss_place',
            autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
        },
        orders,
    );
    await admin.from('order_sync_runs').insert({
        connection_id: conn.id,
        user_id: conn.user_id,
        trigger: 'webhook',
        status: 'success',
        finished_at: new Date().toISOString(),
        orders_upserted: orders.length,
    });
}

async function handleInstallation(
    admin: AdminClient,
    eventType: string,
    merchantId: string,
    payload: Record<string, unknown>,
): Promise<TossWebhookResult | null> {
    if (eventType === 'app.installation.created.v1') {
        const installedAt = String(
            (payload.data as { installedAt?: string } | undefined)?.installedAt ??
                payload.createdAt ??
                new Date().toISOString(),
        );
        await admin.from('toss_place_installations').upsert(
            {
                merchant_id: merchantId,
                installed_at: installedAt,
                uninstalled_at: null,
                raw: payload,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'merchant_id' },
        );
        return { status: 200, body: { ok: true, installation: 'recorded' } };
    }
    if (eventType === 'app.installation.deleted.v1') {
        const now = new Date().toISOString();
        await admin
            .from('toss_place_installations')
            .update({ uninstalled_at: now, updated_at: now })
            .eq('merchant_id', merchantId);
        await admin
            .from('sales_channel_connections')
            .update({
                status: 'disabled',
                last_error: 'app uninstalled',
                updated_at: now,
            })
            .eq('platform', 'toss_place')
            .eq('shop_identifier', merchantId)
            .eq('status', 'active');
        return { status: 200, body: { ok: true, disabled: true } };
    }
    return null;
}

/**
 * Handle a verified-or-to-verify toss_place webhook POST.
 */
export async function handleTossPlaceWebhook(
    admin: AdminClient,
    rawBody: string,
    headers: {
        signature: string | null;
        timestamp: string | null;
        webhookId: string | null;
    },
): Promise<TossWebhookResult> {
    if (
        !(await verifyTossPlaceSignature(
            Deno.env.get('TOSS_PLACE_WEBHOOK_SECRET'),
            rawBody,
            headers.signature,
            headers.timestamp,
        ))
    ) {
        console.error('[order-webhook] toss_place signature reject');
        return { status: 401, body: { error: 'Unauthorized' } };
    }

    const dedupe = await recordWebhookDelivery(admin, headers.webhookId?.trim() || null);
    if (dedupe === 'duplicate') {
        return { status: 200, body: { ok: true, duplicate: true } };
    }

    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return { status: 400, body: { error: 'Invalid JSON' } };
    }

    const eventType = String(payload.eventType ?? payload.type ?? payload.event ?? '');
    const data = (payload.data ?? payload.payload ?? payload) as Record<string, unknown>;
    const merchantId = String(data.merchantId ?? payload.merchantId ?? data.merchant_id ?? '').trim();
    if (!merchantId) return { status: 200, body: { ok: true, skipped: 'no merchantId' } };

    const installResult = await handleInstallation(admin, eventType, merchantId, payload);
    if (installResult) return installResult;

    const { data: conn } = await admin
        .from('sales_channel_connections')
        .select('id, user_id, auto_fulfill_on_shipped, status')
        .eq('platform', 'toss_place')
        .eq('shop_identifier', merchantId)
        .eq('status', 'active')
        .maybeSingle();

    if (!conn) return { status: 200, body: { ok: true, skipped: 'unknown merchant' } };

    let orderRaw = (data.order ?? data) as TossPlaceOrderRaw;
    const orderId = String(data.orderId ?? orderRaw.id ?? '').trim();
    const thin =
        eventType.startsWith('payment.') || (!orderRaw.orderState && !orderRaw.lineItems && !orderRaw.orderLineItems);

    if (thin && orderId) {
        try {
            const full = await fetchTossPlaceOrderById(merchantId, orderId);
            if (full) {
                await upsertAndLog(admin, conn as ConnRow, [full]);
                return { status: 200, body: { ok: true, upserted: 1, via: 'refetch' } };
            }
        } catch (e) {
            console.error('[order-webhook] toss_place refetch', e);
        }
    }

    if (!orderRaw.orderState) {
        if (eventType.includes('cancelled') || eventType.includes('canceled')) {
            orderRaw = { ...orderRaw, orderState: 'CANCELLED' };
        } else if (eventType.includes('completed') || eventType.includes('approved')) {
            orderRaw = { ...orderRaw, orderState: 'COMPLETED' };
        }
    }
    if (orderRaw.id == null && orderId) {
        orderRaw = { ...orderRaw, id: orderId };
    }

    const order = mapTossPlaceOrder(orderRaw);
    if (!order) return { status: 200, body: { ok: true, skipped: 'unparseable' } };

    await upsertAndLog(admin, conn as ConnRow, [order]);
    return { status: 200, body: { ok: true, upserted: 1 } };
}
