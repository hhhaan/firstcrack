/**
 * C3: after app dispatch sets status=shipped, inbound auto-fulfill never fires.
 * Decide whether dispatch must call fulfill_order.
 */
export function shouldAutoFulfillOnDispatch(opts: {
    fulfilledAt: string | null | undefined;
    autoFulfillOnShipped: boolean | null | undefined;
}): boolean {
    return !opts.fulfilledAt && opts.autoFulfillOnShipped === true;
}
