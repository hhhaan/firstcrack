/**
 * POST /order-webhook?platform=shopify|cafe24
 * Push ingest: fail-closed signature/secret verify, topic check, idempotent upsert.
 *
 * Deploy with `--no-verify-jwt` (see supabase/config.toml): the platform
 * signature is the only credential — there is no user JWT on these calls.
 *
 * Shopify headers: X-Shopify-Shop-Domain, X-Shopify-Hmac-Sha256, X-Shopify-Topic,
 *                  X-Shopify-Webhook-Id (idempotency key)
 * Cafe24: mall_id in payload; X-API-Key vs stored webhook verification code
 */
import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import {
    cafe24ItemsMissing,
    fetchCafe24CanonicalOrder,
    mapCafe24Order,
} from '../_shared/channels/cafe24.ts';
import { createSecretsSession } from '../_shared/channels/secrets-session.ts';
import { cafe24WebhookEventKey, isCafe24Uninstall } from '../_shared/channels/cafe24-webhook.ts';
import { gidToId, lineQuantity, lineStatusOf, upsertCanonicalOrders } from '../_shared/channels/normalize.ts';
import { classifyShopifyTopic } from '../_shared/channels/shopify-webhook.ts';
import {
    claimWebhookEventRun,
    completeWebhookEventRun,
    releaseWebhookEventClaim,
    type WebhookEventRunClient,
} from '../_shared/channels/webhook-event-run.ts';
import { shopifyToCanonical } from '../_shared/channels/status-map.ts';
import type { CanonicalOrder, CanonicalOrderLine, Platform } from '../_shared/channels/types.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';
import { verifySharedSecret, verifyShopifyHmac } from '../_shared/webhook-auth.ts';

type ConnRow = {
    id: string;
    user_id: string;
    auto_fulfill_on_shipped: boolean | null;
    status: string;
};

/**
 * Active connection for a platform shop.
 * Duplicate (platform, shop_identifier) rows across tenants must never resolve
 * to an arbitrary one — `.maybeSingle()` used to swallow that case as "unknown
 * shop" and silently drop every delivery (issue #129).
 */
async function resolveConnection(
    admin: ReturnType<typeof serviceClient>,
    platform: 'shopify' | 'cafe24',
    shopIdentifier: string,
): Promise<{ conn: ConnRow | null; ambiguous: boolean }> {
    const { data, error } = await admin
        .from('sales_channel_connections')
        .select('id, user_id, auto_fulfill_on_shipped, status')
        .eq('platform', platform)
        .eq('shop_identifier', shopIdentifier)
        .eq('status', 'active')
        .limit(2);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as ConnRow[];
    if (rows.length > 1) return { conn: null, ambiguous: true };
    return { conn: rows[0] ?? null, ambiguous: false };
}

function parseShopifyOrder(payload: Record<string, unknown>): CanonicalOrder | null {
    const id =
        payload.id != null
            ? String(payload.id)
            : payload.admin_graphql_api_id
              ? gidToId(String(payload.admin_graphql_api_id))
              : '';
    if (!id) return null;

    const financial = payload.financial_status != null ? String(payload.financial_status) : null;
    const fulfillment = payload.fulfillment_status != null ? String(payload.fulfillment_status) : null;
    const cancelledAt = payload.cancelled_at != null ? String(payload.cancelled_at) : null;
    const status = shopifyToCanonical(financial, fulfillment, cancelledAt) ?? 'paid';

    const lineItems = (payload.line_items as Array<Record<string, unknown>> | undefined) ?? [];
    const lines: CanonicalOrderLine[] = lineItems.map((li, i) => {
        return {
            platformLineId: li.id != null ? String(li.id) : `${id}-${i}`,
            platformProductId: li.product_id != null ? String(li.product_id) : null,
            platformVariantId: li.variant_id != null ? String(li.variant_id) : null,
            sku: li.sku ? String(li.sku) : null,
            title: String(li.name ?? li.title ?? 'Item'),
            quantity: lineQuantity(li.quantity),
            unitPrice: li.price != null ? Number(li.price) : null,
            status: lineStatusOf(status),
        };
    });

    const customer = payload.customer as { first_name?: string; last_name?: string } | undefined;
    const buyer = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || null;

    return {
        platformOrderId: id,
        status,
        orderedAt: String(payload.created_at ?? new Date().toISOString()),
        buyerName: buyer,
        currency: payload.currency != null ? String(payload.currency) : null,
        totalAmount: payload.total_price != null ? Number(payload.total_price) : null,
        lines,
        raw: payload,
    };
}

serveWithSentry('order-webhook', async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                ...corsHeaders,
                'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, x-shopify-hmac-sha256, x-shopify-shop-domain, x-shopify-topic, x-shopify-webhook-id, x-api-key, x-cafe24-webhook-secret, x-webhook-secret`,
            },
        });
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const url = new URL(req.url);
    const platform = (url.searchParams.get('platform') ?? url.pathname.split('/').pop() ?? '') as Platform;
    if (platform !== 'shopify' && platform !== 'cafe24') {
        return jsonResponse({ error: 'platform must be shopify|cafe24' }, 400);
    }

    const rawBody = await req.text();
    const admin = serviceClient();

    try {
        if (platform === 'shopify') {
            const shop = (req.headers.get('X-Shopify-Shop-Domain') ?? '').toLowerCase();
            const hmac = req.headers.get('X-Shopify-Hmac-Sha256');
            if (!shop) return jsonResponse({ error: 'missing shop domain' }, 400);

            const { conn, ambiguous } = await resolveConnection(admin, 'shopify', shop);
            if (ambiguous) {
                console.error('[order-webhook] shopify ambiguous shop', shop);
                return jsonResponse({ ok: true, skipped: 'ambiguous shop' });
            }
            if (!conn) {
                // Unknown shop — acknowledge to avoid retry storms
                return jsonResponse({ ok: true, skipped: 'unknown shop' });
            }

            const { data: secretRow } = await admin
                .from('sales_channel_secrets')
                .select('credentials')
                .eq('connection_id', conn.id)
                .single();

            // Per-connection webhook secret (collected at connect time) first.
            // SHOPIFY_WEBHOOK_SECRET is a single-tenant fallback only — with more
            // than one store connected every store must have its own secret.
            const creds = (secretRow?.credentials ?? {}) as Record<string, string>;
            const secret = creds.webhook_secret || Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || '';

            // fail-closed: secret 또는 헤더 부재 = 검증 불가 = 거부 (기존: 조용히 통과)
            if (!(await verifyShopifyHmac(secret, rawBody, hmac))) {
                console.error('[order-webhook] shopify hmac reject', shop);
                return jsonResponse({ error: 'Unauthorized' }, 401);
            }

            // A valid HMAC proves the sender, not the payload shape — route by topic.
            const topic = classifyShopifyTopic(req.headers.get('X-Shopify-Topic'));
            if (topic === 'uninstall') {
                // Token is dead; stop polling. Secrets are kept so a re-install can
                // be repaired by reconnecting (purging here would let a forged
                // uninstall wipe credentials).
                await admin
                    .from('sales_channel_connections')
                    .update({
                        status: 'disabled',
                        last_error: 'app uninstalled on Shopify',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', conn.id);
                return jsonResponse({ ok: true, handled: 'app/uninstalled' });
            }
            if (topic !== 'order') {
                // GDPR / product / orders-delete topics: acknowledge, never parse.
                return jsonResponse({ ok: true, skipped: 'topic not handled' });
            }

            let payload: Record<string, unknown>;
            try {
                payload = JSON.parse(rawBody);
            } catch {
                return jsonResponse({ error: 'Invalid JSON' }, 400);
            }

            const order = parseShopifyOrder(payload);
            if (!order) return jsonResponse({ ok: true, skipped: 'unparseable' });

            // Idempotency: X-Shopify-Webhook-Id is stable across delivery retries.
            // Unique index on (connection_id, external_event_id) rejects replays.
            const { data: run, error: runErr } = await admin
                .from('order_sync_runs')
                .insert({
                    connection_id: conn.id,
                    user_id: conn.user_id,
                    trigger: 'webhook',
                    status: 'running',
                    external_event_id: req.headers.get('X-Shopify-Webhook-Id'),
                })
                .select('id')
                .single();
            if (runErr || !run) {
                if (runErr?.code === '23505') {
                    return jsonResponse({ ok: true, skipped: 'duplicate delivery' });
                }
                throw new Error(runErr?.message ?? 'run insert failed');
            }

            try {
                await upsertCanonicalOrders(
                    admin,
                    {
                        userId: conn.user_id,
                        connectionId: conn.id,
                        platform: 'shopify',
                        autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
                    },
                    [order],
                );
                const { error: runError } = await admin
                    .from('order_sync_runs')
                    .update({
                        status: 'success',
                        finished_at: new Date().toISOString(),
                        orders_upserted: 1,
                    })
                    .eq('id', run.id);

                if (runError) throw new Error('Failed to finish webhook run', { cause: runError });
            } catch (e) {
                // Release the idempotency key so the platform retry is processed.
                const msg = e instanceof Error ? e.message : String(e);
                await admin
                    .from('order_sync_runs')
                    .update({
                        status: 'error',
                        finished_at: new Date().toISOString(),
                        external_event_id: null,
                        error_message: msg.slice(0, 1000),
                    })
                    .eq('id', run.id);
                throw e;
            }

            return jsonResponse({ ok: true, upserted: 1 });
        }

        // cafe24
        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return jsonResponse({ error: 'Invalid JSON' }, 400);
        }

        const mallId = String(payload.mall_id ?? (payload.resource as { mall_id?: string } | undefined)?.mall_id ?? '')
            .trim()
            .toLowerCase();
        if (!mallId) return jsonResponse({ ok: true, skipped: 'no mall_id' });

        const { conn, ambiguous } = await resolveConnection(admin, 'cafe24', mallId);
        if (ambiguous) {
            console.error('[order-webhook] cafe24 ambiguous mall', mallId);
            return jsonResponse({ ok: true, skipped: 'ambiguous mall' });
        }

        // Per-connection shared secret (service-role only) wins over the app-wide
        // env secret, mirroring the Shopify path. Cafe24 connects via OAuth, so
        // nothing writes the per-connection slot yet — CAFE24_WEBHOOK_SECRET stays
        // the SSoT until a Cafe24 secret write path exists.
        let cafe24Secret = Deno.env.get('CAFE24_WEBHOOK_SECRET');
        let channelCredentials: Record<string, string> = {};
        if (conn) {
            const { data: secretRow } = await admin
                .from('sales_channel_secrets')
                .select('credentials')
                .eq('connection_id', conn.id)
                .maybeSingle();
            const creds = (secretRow?.credentials ?? {}) as Record<string, string>;
            channelCredentials = creds;
            if (creds.webhook_secret) cafe24Secret = creds.webhook_secret;
        }

        // Cafe24 sends its webhook verification code in X-API-Key (not the OAuth client secret).
        // https://developers.cafe24.com/en/app/front/app/develop/webhook/manage
        // Legacy header names remain available for manual relays.
        //
        // fail-closed: 헤더 또는 시크릿 부재 = 검증 불가 = 거부.
        const cafe24Header =
            req.headers.get('x-api-key') ??
            req.headers.get('x-cafe24-webhook-secret') ??
            req.headers.get('x-webhook-secret');
        // Verified before the unknown-mall ack so an unauthenticated caller cannot
        // probe which malls are connected.
        if (!verifySharedSecret(cafe24Secret, cafe24Header)) {
            console.error('[order-webhook] cafe24 secret reject', mallId);
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        if (!conn) return jsonResponse({ ok: true, skipped: 'unknown mall' });

        // App-deleted event (90077) — never an order; branch before parsing.
        // Token is dead; stop polling. Secrets are kept, mirroring the Shopify
        // uninstall path but more conservatively: this route is shared-secret
        // verified (weaker than HMAC), so a forged uninstall must not wipe
        // credentials. Re-install recovers via OAuth reconnect. The update is
        // idempotent — a repeat delivery is a no-op success.
        if (isCafe24Uninstall(payload)) {
            await admin
                .from('sales_channel_connections')
                .update({
                    status: 'disabled',
                    last_error: 'app uninstalled on Cafe24',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', conn.id);
            return jsonResponse({ ok: true, handled: 'app/uninstalled' });
        }

        // Webhook wraps the order under `resource` (sample payloads: event_no 90023 etc.);
        // some senders put order_id at the top level only.
        const resource = (payload.resource ?? payload.order ?? payload) as Record<string, unknown>;
        const platformOrderId = String(resource.order_id ?? payload.order_id ?? '').trim();
        if (!platformOrderId) return jsonResponse({ ok: true, skipped: 'unparseable' });

        let order: CanonicalOrder;
        if (cafe24ItemsMissing(resource)) {
            const accessToken = String(channelCredentials.access_token ?? '').trim();
            if (!accessToken) throw new Error('cafe24: missing access_token');
            const secretsSession = createSecretsSession(admin, conn.id, {
                ...channelCredentials,
                mall_id: mallId,
                access_token: accessToken,
            });
            order = await fetchCafe24CanonicalOrder(secretsSession.current(), secretsSession.rotate, platformOrderId);
        } else {
            const mapped = mapCafe24Order({ ...resource, order_id: platformOrderId });
            if (!mapped) return jsonResponse({ ok: true, skipped: 'unparseable' });
            if (mapped.lines.some((l) => l.platformLineId.endsWith('-unknown'))) {
                throw new Error('cafe24: incomplete order lines');
            }
            order = mapped;
        }

        const externalEventId = await cafe24WebhookEventKey(payload, rawBody);
        const runs = admin as unknown as WebhookEventRunClient;
        const claim = await claimWebhookEventRun(runs, {
            connectionId: conn.id,
            userId: conn.user_id,
            externalEventId,
        });
        if (!claim.ok) {
            if ('inProgress' in claim) {
                return jsonResponse({ error: 'webhook claim in progress' }, 409);
            }
            if ('duplicate' in claim && claim.duplicate) {
                return jsonResponse({ ok: true, skipped: 'duplicate delivery' });
            }
            if ('error' in claim) {
                throw new Error(claim.error);
            }
            throw new Error('webhook claim failed');
        }

        try {
            await upsertCanonicalOrders(
                admin,
                {
                    userId: conn.user_id,
                    connectionId: conn.id,
                    platform: 'cafe24',
                    autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
                },
                [order],
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await releaseWebhookEventClaim(runs, claim.runId, msg);
            throw e;
        }

        await completeWebhookEventRun(runs, claim.runId, 1);

        return jsonResponse({ ok: true, upserted: 1 });
    } catch (e) {
        console.error('[order-webhook]', platform, e);
        await captureEdgeException(e, { function: 'order-webhook', status: 500, tags: { platform } });
        // Still 200 for platform retry control when we partially handled — use 500 only for hard failures
        return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
});
