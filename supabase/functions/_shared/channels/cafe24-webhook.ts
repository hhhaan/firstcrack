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
export function isCafe24Uninstall(payload: Record<string, unknown>): boolean {
    if (Number(payload.event_no) === 90077) return true;
    // Fallback for relays that strip event_no: the uninstall resource shape is
    // app_name + deleted_date, which no order payload carries.
    const resource = payload.resource as Record<string, unknown> | undefined;
    return resource?.app_name != null && resource?.deleted_date != null;
}
