type Payload = { text: string };
type RpcClient = {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

/** Send only while owning a durable lease. Unavailable Slack MUST remain retryable. */
export async function deliverPolarNotification(
    client: RpcClient,
    org: string,
    eventId: string,
    payload: Payload,
    send: (payload: Payload) => Promise<boolean>,
): Promise<void> {
    const claim = await client.rpc('claim_polar_notification', {
        p_org_id: org, p_event_id: eventId, p_payload: payload,
    });
    if (claim.error) throw new Error('Polar notification claim failed');
    const data = claim.data as { status?: string; lease_id?: string; payload?: Payload } | null;
    if (data?.status === 'sent') return;
    if (data?.status !== 'claimed' || !data.lease_id || typeof data.payload?.text !== 'string') {
        throw new Error('Polar notification pending');
    }
    let sent = false;
    try {
        sent = await send(data.payload);
    } finally {
        const finish = await client.rpc('finish_polar_notification', {
            p_org_id: org, p_event_id: eventId, p_lease_id: data.lease_id, p_sent: sent,
        });
        if (finish.error || finish.data !== true) throw new Error('Polar notification finish failed');
    }
    if (!sent) throw new Error('Polar notification delivery failed');
}

const sanitize = (value: unknown): string => String(value ?? 'unknown').replace(/[\r\n`]/g, ' ').trim();
function money(amount: unknown, currency: unknown): string {
    return typeof amount === 'number' ? `${String(currency ?? 'usd').toUpperCase()} ${(amount / 100).toFixed(2)}` : 'n/a';
}

/** Preserve the existing Edge payment details; canonical outbox payload wins across endpoints. */
export function polarNotificationPayload(type: string, data: Record<string, unknown>, plan?: string): Payload {
    const customer = data.customer as Record<string, unknown> | undefined;
    const metadata = data.metadata as Record<string, unknown> | undefined;
    const user = customer?.external_id ?? metadata?.user_id ?? data.customer_id ?? 'unknown';
    const lines = type === 'order.paid' ? [
        '*Payment received (order.paid / edge)*',
        `• user: \`${sanitize(user)}\``,
        `• amount: \`${sanitize(money(data.amount ?? data.total_amount, data.currency))}\``,
        `• status: \`${sanitize(data.status ?? 'paid')}\``,
    ] : [
        '*Payment / subscription (edge)*',
        `• user: \`${sanitize(user)}\``,
        `• status: \`${sanitize(data.status)}\``,
        `• plan: \`${sanitize(plan ?? data.product_id ?? 'unknown')}\``,
        `• amount: \`${sanitize(money(data.amount, data.currency))}\``,
        ...(data.recurring_interval ? [`• interval: \`${sanitize(data.recurring_interval)}\``] : []),
    ];
    return { text: lines.join('\n') };
}
