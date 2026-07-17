import { orderKeys } from '@entities/order';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelPlatform, ConnectCredentials } from './api';
import { salesChannelApi } from './api';

export const salesChannelKeys = {
    all: (userId: string) => ['sales-channels', userId] as const,
};

export const useSalesChannels = (userId: string) =>
    useQuery({
        queryKey: salesChannelKeys.all(userId),
        queryFn: () => salesChannelApi.list(userId),
        enabled: !!userId,
    });

export const useConnectChannel = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            platform,
            credentials,
            displayName,
        }: {
            platform: ChannelPlatform;
            credentials: ConnectCredentials;
            displayName?: string;
        }) => salesChannelApi.connect(platform, credentials, displayName),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};

export const useDisconnectChannel = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (connectionId: string) => salesChannelApi.disconnect(connectionId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};

export const useSyncOrders = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (connectionId?: string) => salesChannelApi.syncNow(connectionId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
            qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
            qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};
