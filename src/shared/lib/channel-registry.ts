/**
 * Channel capability registry (client SSoT in shared — entities must not import each other).
 *
 * Dual-sync with EF adapters in `supabase/functions/_shared/channels/*`:
 * each adapter.capabilities must match CHANNEL_REGISTRY[platform].
 * New POS (smaregi, square, …) = add Platform enum + EF adapter + one row here.
 * Insights/UI branch on channelKind / outboundDispatch — never on platform string.
 */

export type ChannelPlatform = 'naver' | 'cafe24' | 'shopify' | 'toss_place';

/** Includes order-only platforms not in sales_channel_connections. */
export type OrderPlatform = ChannelPlatform | 'manual';

export type ChannelKind = 'marketplace' | 'pos' | 'manual';

export interface ChannelCapabilities {
    webhooks: boolean;
    /** Marketplace ship API. POS walk-in = false. */
    outboundDispatch: boolean;
    channelKind: ChannelKind;
}

export const CHANNEL_REGISTRY: Readonly<Record<OrderPlatform, ChannelCapabilities>> = {
    naver: { webhooks: false, outboundDispatch: true, channelKind: 'marketplace' },
    cafe24: { webhooks: true, outboundDispatch: true, channelKind: 'marketplace' },
    shopify: { webhooks: true, outboundDispatch: true, channelKind: 'marketplace' },
    toss_place: { webhooks: true, outboundDispatch: false, channelKind: 'pos' },
    manual: { webhooks: false, outboundDispatch: false, channelKind: 'manual' },
};

const FALLBACK: ChannelCapabilities = {
    webhooks: false,
    outboundDispatch: false,
    channelKind: 'marketplace',
};

export function getChannelCapabilities(platform: string): ChannelCapabilities {
    return CHANNEL_REGISTRY[platform as OrderPlatform] ?? FALLBACK;
}

export function supportsOutboundDispatch(platform: string): boolean {
    return getChannelCapabilities(platform).outboundDispatch;
}

export function getChannelKind(platform: string): ChannelKind {
    return getChannelCapabilities(platform).channelKind;
}

/** Derived from registry — prefer supportsOutboundDispatch(platform) at call sites. */
export const OUTBOUND_DISPATCH_PLATFORMS: ReadonlySet<string> = new Set(
    (Object.entries(CHANNEL_REGISTRY) as [OrderPlatform, ChannelCapabilities][])
        .filter(([, c]) => c.outboundDispatch)
        .map(([p]) => p),
);
