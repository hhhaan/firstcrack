export type { ChannelCapabilities, ChannelKind, OrderPlatform } from '@shared/lib/channel-registry';
export {
    CHANNEL_REGISTRY,
    getChannelCapabilities,
    getChannelKind,
    supportsOutboundDispatch,
} from '@shared/lib/channel-registry';
export type { ChannelPlatform, ChannelStatus, ConnectCredentials, SalesChannelConnection } from './api';
export { OUTBOUND_DISPATCH_PLATFORMS, salesChannelApi } from './api';
export {
    salesChannelKeys,
    useConnectChannel,
    useDisconnectChannel,
    useSalesChannels,
    useSetAutoFulfill,
    useStartCafe24OAuth,
    useSyncOrders,
} from './queries';
