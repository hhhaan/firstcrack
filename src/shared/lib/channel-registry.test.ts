import { describe, expect, it } from 'vitest';
import {
    CHANNEL_REGISTRY,
    getChannelCapabilities,
    getChannelKind,
    OUTBOUND_DISPATCH_PLATFORMS,
    supportsOutboundDispatch,
} from './channel-registry';

describe('CHANNEL_REGISTRY', () => {
    it('classifies POS vs marketplace without UI hardcoding', () => {
        expect(getChannelKind('toss_place')).toBe('pos');
        expect(getChannelKind('naver')).toBe('marketplace');
        expect(getChannelKind('manual')).toBe('manual');
        expect(supportsOutboundDispatch('toss_place')).toBe(false);
        expect(supportsOutboundDispatch('shopify')).toBe(true);
    });

    it('keeps OUTBOUND_DISPATCH_PLATFORMS derived from registry', () => {
        for (const p of OUTBOUND_DISPATCH_PLATFORMS) {
            expect(getChannelCapabilities(p).outboundDispatch).toBe(true);
        }
        expect(OUTBOUND_DISPATCH_PLATFORMS.has('toss_place')).toBe(false);
        expect(OUTBOUND_DISPATCH_PLATFORMS.has('manual')).toBe(false);
    });

    it('documents dual-SSoT platforms present on both client and EF adapters', () => {
        // EF adapters: naver, cafe24, shopify, toss_place (+ manual order-only)
        expect(Object.keys(CHANNEL_REGISTRY).sort()).toEqual(
            ['cafe24', 'manual', 'naver', 'shopify', 'toss_place'].sort(),
        );
    });

    it('locks capability rows that must match EF ChannelAdapter.capabilities', () => {
        // When editing: also update supabase/functions/_shared/channels/{platform}.ts
        expect(CHANNEL_REGISTRY.naver).toEqual({
            webhooks: false,
            outboundDispatch: true,
            channelKind: 'marketplace',
        });
        expect(CHANNEL_REGISTRY.cafe24).toEqual({
            webhooks: true,
            outboundDispatch: true,
            channelKind: 'marketplace',
        });
        expect(CHANNEL_REGISTRY.shopify).toEqual({
            webhooks: true,
            outboundDispatch: true,
            channelKind: 'marketplace',
        });
        expect(CHANNEL_REGISTRY.toss_place).toEqual({
            webhooks: true,
            outboundDispatch: false,
            channelKind: 'pos',
        });
        expect(CHANNEL_REGISTRY.manual).toEqual({
            webhooks: false,
            outboundDispatch: false,
            channelKind: 'manual',
        });
    });
});
