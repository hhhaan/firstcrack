/**
 * Cafe24 webhook event routing. Pure TS — no Deno globals.
 *
 * Cafe24 has no topic header — the event rides in the payload as `event_no`.
 * 90077 = app deleted (uninstall); its resource carries `app_name` +
 * `deleted_date` instead of an order. Without this check the uninstall payload
 * falls through to the order parser and is silently dropped as 'unparseable'
 * while the dead connection keeps polling (issue #146).
 *
 * 90078 (expiry) / 90079 (expiry change) are deliberately not handled here.
 */
async function sha256Hex(rawBody: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Stable idempotency key for Cafe24 webhook deliveries (body hash — no delivery-id header). */
export async function cafe24WebhookEventKey(payload: Record<string, unknown>, rawBody: string): Promise<string> {
    const eventNo = payload.event_no != null ? String(payload.event_no) : 'na';
    const resource = (payload.resource ?? payload.order ?? payload) as Record<string, unknown>;
    const orderId =
        resource.order_id != null
            ? String(resource.order_id)
            : payload.order_id != null
              ? String(payload.order_id)
              : 'na';
    const hash = await sha256Hex(rawBody);
    return `cafe24:${eventNo}:${orderId}:${hash}`;
}

export function isCafe24Uninstall(payload: Record<string, unknown>): boolean {
    if (Number(payload.event_no) === 90077) return true;
    // Fallback for relays that strip event_no: the uninstall resource shape is
    // app_name + deleted_date, which no order payload carries.
    const resource = payload.resource as Record<string, unknown> | undefined;
    return resource?.app_name != null && resource?.deleted_date != null;
}
