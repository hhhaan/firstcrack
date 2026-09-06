import { cafe24Adapter } from './cafe24.ts';
import { naverAdapter } from './naver.ts';
import { shopifyAdapter } from './shopify.ts';
import { tossPlaceAdapter } from './toss-place.ts';
import type { ChannelAdapter, Platform } from './types.ts';

export const adapters: Record<Platform, ChannelAdapter> = {
    naver: naverAdapter,
    cafe24: cafe24Adapter,
    shopify: shopifyAdapter,
    toss_place: tossPlaceAdapter,
};

export function getAdapter(platform: string): ChannelAdapter {
    const a = adapters[platform as Platform];
    if (!a) throw new Error(`unknown platform: ${platform}`);
    return a;
}
