import { orderKeys, productStockKeys } from '@shared/lib/query-keys';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelPlatform, ConnectCredentials } from './api';
import { salesChannelApi } from './api';

export const salesChannelKeys = {
    all: (userId: string) => ['sales-channels', userId] as const,
    listings: (connectionId: string) => ['sales-channels', 'listings', connectionId] as const,
};

export const invalidateAfterSyncOrders = (qc: QueryClient, userId: string) => {
    void qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
    void qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
    void qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
    void qc.invalidateQueries({ queryKey: productStockKeys.byUser(userId) });
};

export const useSalesChannels = (userId: string) =>
    useQuery({
        queryKey: salesChannelKeys.all(userId),
        queryFn: () => salesChannelApi.list(userId),
        enabled: !!userId,
    });

/** Catalog fetch is a live platform call — only run it while a picker is open for one connection. */
export const useChannelListings = (connectionId: string | null) =>
    useQuery({
        queryKey: salesChannelKeys.listings(connectionId ?? ''),
        queryFn: () => salesChannelApi.listProducts(connectionId ?? ''),
        enabled: !!connectionId,
        retry: false,
    });

export const useConnectChannel = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            platform,
            credentials,
            displayName,
            workspaceOwnerId,
        }: {
            platform: ChannelPlatform;
            credentials: ConnectCredentials;
            displayName?: string;
            workspaceOwnerId?: string;
        }) => salesChannelApi.connect(platform, credentials, displayName, workspaceOwnerId),
        // ConnectChannelModal renders the failure inline.
        meta: { silentError: true },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: salesChannelKeys.all(userId) });
        },
    });
};

export const useStartCafe24OAuth = () =>
    useMutation({
        mutationFn: ({
            mallId,
            displayName,
            workspaceOwnerId,
        }: {
            mallId: string;
            displayName?: string;
            workspaceOwnerId?: string;
        }) => salesChannelApi.startCafe24OAuth(mallId, displayName, workspaceOwnerId),
        // ConnectChannelModal renders the failure inline.
        meta: { silentError: true },
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

/** `userId` is the workspace owner id (callers pass `workspaceOwnerId` from `useActiveWorkspace`). */
export const useSyncOrders = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (connectionId?: string) => salesChannelApi.syncNow(connectionId, userId),
        // ChannelsTab toasts the sync result itself (partial success carries a count the generic
        // bridge cannot express); letting the global bridge fire too would stack two toasts.
        meta: { silentError: true },
        onSuccess: () => {
            invalidateAfterSyncOrders(qc, userId);
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
