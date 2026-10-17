/** Canonical order model shared by all channel adapters. Pure TS — no Deno globals. */

export type Platform = 'naver' | 'cafe24' | 'shopify';

export type CanonicalStatus =
    | 'pending'
    | 'paid'
    | 'preparing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'refunded';

export type LineStatus = 'active' | 'cancelled' | 'refunded';

export interface CanonicalOrderLine {
    platformLineId: string;
    platformProductId: string | null;
    platformVariantId: string | null;
    /**
     * Merchant-facing SKU the platform reports on the line, when it has one (Shopify).
     * Matched against `products.sku` after the internal ids — see `lineMatchKeys` in normalize.ts.
     */
    sku?: string | null;
    title: string;
    quantity: number;
    unitPrice: number | null;
    status: LineStatus;
}

export interface CanonicalOrder {
    platformOrderId: string;
    status: CanonicalStatus;
    orderedAt: string; // ISO
    buyerName: string | null;
    currency: string | null;
    totalAmount: number | null;
    lines: CanonicalOrderLine[];
    raw: unknown;
}

export interface PlatformListing {
    platformProductId: string;
    platformVariantId: string | null;
    title: string;
    sku: string | null;
}

export type ChannelSecrets = Record<
    string,
    string | number | boolean | string[] | null | undefined
>;

export interface PollCursor {
    /** ISO timestamp of last successful poll window start / lastChangedFrom */
    since?: string;
    /** Platform-specific opaque cursor (page token, moreSequence, etc.) */
    token?: string;
}

export interface FetchOrdersResult {
    orders: CanonicalOrder[];
    nextCursor: PollCursor;
    /** True when the incoming poll cursor was republished (e.g. Naver detail fetch incomplete). */
    cursorHeld?: boolean;
    /** Success-run note for order_sync_runs.error_message (operator visibility). */
    syncNote?: string;
}

export interface TestConnectionResult {
    shopIdentifier: string;
    displayName: string;
}

export interface MarkShippedRequest {
    platformOrderId: string;
    lines: { platformLineId: string }[];
    /** Already converted to platform delivery company code / name. */
    carrierCode: string;
    trackingNumber: string;
}

export interface MarkShippedResult {
    ok: boolean;
    alreadyShipped: boolean;
    lineResults?: { platformLineId: string; ok: boolean; error?: string }[];
    error?: string;
}

/**
 * Adapters rotate credentials in the middle of a call (Cafe24 mints a new refresh_token and
 * revokes the previous one). The rotation must reach `sales_channel_secrets` before the next
 * platform call, otherwise the stored token is already dead. Required, not optional: a missing
 * sink is exactly the bug this exists to prevent.
 */
export type SecretsRotationSink = (rotated: ChannelSecrets) => Promise<void>;

export interface ChannelAdapter {
    platform: Platform;
    capabilities: { webhooks: boolean; outboundDispatch: boolean };
    /** Validate credentials against the live platform API. */
    testConnection(secrets: ChannelSecrets): Promise<TestConnectionResult>;
    /** Refresh short-lived tokens; return null if secrets are long-lived / unchanged. */
    refreshAuth(secrets: ChannelSecrets): Promise<ChannelSecrets | null>;
    fetchOrdersSince(
        secrets: ChannelSecrets,
        cursor: PollCursor,
        onRotate: SecretsRotationSink,
    ): Promise<FetchOrdersResult>;
    listProducts(secrets: ChannelSecrets, onRotate: SecretsRotationSink): Promise<PlatformListing[]>;
    markShipped(
        secrets: ChannelSecrets,
        req: MarkShippedRequest,
        onRotate: SecretsRotationSink,
    ): Promise<MarkShippedResult>;
}
