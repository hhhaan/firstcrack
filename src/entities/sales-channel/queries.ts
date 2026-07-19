import { orderKeys } from '@shared/lib/query-keys';
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
            void qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};

export const useStartCafe24OAuth = () =>
    useMutation({
        mutationFn: ({ mallId, displayName }: { mallId: string; displayName?: string }) =>
            salesChannelApi.startCafe24OAuth(mallId, displayName),
    });

export const useDisconnectChannel = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (connectionId: string) => salesChannelApi.disconnect(connectionId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};

export const useSyncOrders = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (connectionId?: string) => salesChannelApi.syncNow(connectionId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
            void qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
            void qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};

export const useSetAutoFulfill = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ connectionId, enabled }: { connectionId: string; enabled: boolean }) =>
            salesChannelApi.setAutoFulfill(connectionId, enabled),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};
