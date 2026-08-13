/**
 * Cafe24 webhook event routing + delivery identity. Pure TS — no Deno globals.
 *
 * Cafe24 has no topic header — the event rides in the payload as `event_no`.
 * 90077 = app deleted (uninstall); its resource carries `app_name` +
 * `deleted_date` instead of an order. Without this check the uninstall payload
 * falls through to the order parser and is silently dropped as 'unparseable'
 * while the dead connection keeps polling (issue #146).
 *
 * 90078 (expiry) / 90079 (expiry change) are deliberately not handled here.
 *
 * Cafe24 also has no X-Shopify-Webhook-Id. `event_no` is the event *type*
 * (90023 = order received, …), not a unique delivery id — using it alone
 * would collapse every order of that type onto one key (issue #142 item 3).
 */
export function isCafe24Uninstall(payload: Record<string, unknown>): boolean {
    if (Number(payload.event_no) === 90077) return true;
    // Fallback for relays that strip event_no: the uninstall resource shape is
    // app_name + deleted_date, which no order payload carries.
    const resource = payload.resource as Record<string, unknown> | undefined;
    return resource?.app_name != null && resource?.deleted_date != null;
}

function cafe24Resource(payload: Record<string, unknown>): Record<string, unknown> {
    return (payload.resource ?? payload.order ?? payload) as Record<string, unknown>;
}

function cafe24Field(value: unknown): string {
    return value == null ? '' : String(value);
}

/** paid|canceled|shipping_status|process_status|order_status — same fields the order parser reads. */
function cafe24StatusKey(resource: Record<string, unknown>): string {
    return [
        cafe24Field(resource.paid),
        cafe24Field(resource.canceled),
        cafe24Field(resource.shipping_status),
        cafe24Field(resource.process_status),
        cafe24Field(resource.order_status),
    ].join('|');
}

function cafe24Timestamp(payload: Record<string, unknown>, resource: Record<string, unknown>): string {
    return cafe24Field(resource.order_date ?? payload.event_date ?? payload.timestamp ?? resource.payment_date);
}

const te = new TextEncoder();

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', te.encode(input));
    return toHex(new Uint8Array(digest));
}

/**
 * Stable Cafe24 webhook delivery key for `order_sync_runs.external_event_id`.
 *
 * Prefer `event_no` when present (plus mall/order/status/timestamp so the
 * type code is not the whole key). Relays that strip `event_no` hash
 * mall_id + order_id + status + timestamp.
 */
export async function cafe24WebhookEventId(payload: Record<string, unknown>): Promise<string | null> {
    const resource = cafe24Resource(payload);
    const mallId = cafe24Field(payload.mall_id ?? resource.mall_id)
        .trim()
        .toLowerCase();
    const orderId = cafe24Field(resource.order_id ?? payload.order_id);
    const status = cafe24StatusKey(resource);
    const timestamp = cafe24Timestamp(payload, resource);
    const eventNo = payload.event_no;

    if (eventNo != null && String(eventNo) !== '') {
        return `cafe24:${eventNo}:${mallId}:${orderId}:${status}:${timestamp}`;
    }
    if (!mallId && !orderId) return null;
    return `cafe24:${await sha256Hex(`${mallId}\0${orderId}\0${status}\0${timestamp}`)}`;
}

/**
 * Pre-insert run outcome. Unique `(connection_id, external_event_id)` is
 * Postgres `23505` — same branch Shopify uses for X-Shopify-Webhook-Id.
 */
export function classifyWebhookRunInsert(
    run: { id: string } | null,
    runErr: { code?: string; message?: string } | null | undefined,
): { kind: 'ok'; runId: string } | { kind: 'duplicate' } | { kind: 'error'; message: string } {
    if (!runErr && run) return { kind: 'ok', runId: run.id };
    if (runErr?.code === '23505') return { kind: 'duplicate' };
    return { kind: 'error', message: runErr?.message ?? 'run insert failed' };
}
