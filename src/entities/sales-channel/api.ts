import { supabase } from '@shared/lib/supabase';

export type ChannelPlatform = 'naver' | 'cafe24' | 'shopify' | 'toss_place';
export type ChannelStatus = 'pending' | 'active' | 'error' | 'disabled';

export interface SalesChannelConnection {
    id: string;
    user_id: string;
    platform: ChannelPlatform;
    shop_identifier: string;
    display_name: string | null;
    status: ChannelStatus;
    last_error: string | null;
    consecutive_failures: number;
    last_polled_at: string | null;
    webhook_registered: boolean;
    auto_fulfill_on_shipped: boolean;
    created_at: string;
    updated_at: string;
}

/**
 * Write-only: the Edge Function stores these in `sales_channel_secrets`
 * (service role). They are never read back into the client.
 */
export type ConnectCredentials =
    | { client_id: string; client_secret: string } // naver
    | { shop: string; access_token: string; webhook_secret?: string } // shopify
    | { merchant_id: string }; // toss_place

export type ConnectChannelResult =
    | { kind: 'connected'; connection: SalesChannelConnection }
    | { kind: 'confirm'; displayName: string; shopIdentifier: string };

/** One sellable variant/product as the platform reports it (from `channel-products`, secrets stay server-side). */
export interface ChannelListing {
    platformProductId: string;
    platformVariantId: string | null;
    title: string;
    sku: string | null;
}

export const salesChannelApi = {
    list: async (userId: string): Promise<SalesChannelConnection[]> => {
        const { data, error } = await supabase
            .from('sales_channel_connections')
            .select(
                'id, user_id, platform, shop_identifier, display_name, status, last_error, consecutive_failures, last_polled_at, webhook_registered, auto_fulfill_on_shipped, created_at, updated_at',
            )
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data ?? []) as SalesChannelConnection[];
    },

    /**
     * `workspaceOwnerId` decides who owns the connection row. Omit for self.
     * The Edge Function verifies membership (`has_workspace_access`) before
     * trusting it — connections created under auth.uid() instead of the owner
     * are invisible to a workspace-scoped list.
     */
    connect: async (
        platform: ChannelPlatform,
        credentials: ConnectCredentials,
        displayName?: string,
        workspaceOwnerId?: string,
        confirmMerchant?: boolean,
    ): Promise<ConnectChannelResult> => {
        const { data, error } = await supabase.functions.invoke('channel-connect', {
            body: { platform, credentials, displayName, workspaceOwnerId, confirmMerchant },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (data?.needsConfirm) {
            return {
                kind: 'confirm',
                displayName: String(data.displayName ?? ''),
                shopIdentifier: String(data.shopIdentifier ?? ''),
            };
        }
        return { kind: 'connected', connection: data.connection as SalesChannelConnection };
    },

    /** Cafe24 OAuth: returns authorize URL for browser open. Callback stores connection. */
    startCafe24OAuth: async (
        mallId: string,
        displayName?: string,
        workspaceOwnerId?: string,
    ): Promise<{ authorizeUrl: string }> => {
        const { data, error } = await supabase.functions.invoke('cafe24-oauth-start', {
            body: { mallId, displayName, workspaceOwnerId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (!data?.authorizeUrl) throw new Error('missing authorizeUrl');
        return { authorizeUrl: String(data.authorizeUrl) };
    },

    disconnect: async (connectionId: string): Promise<void> => {
        const { data, error } = await supabase.functions.invoke('channel-disconnect', {
            body: { connectionId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
    },

    /**
     * `workspaceOwnerId` scopes sync-all to the owner's connections. Omit for
     * self. The Edge Function verifies membership (`has_workspace_access`)
     * before trusting it — filtering on auth.uid() instead shows a workspace
     * member zero connections.
     */
    syncNow: async (
        connectionId?: string,
        workspaceOwnerId?: string,
    ): Promise<{ results: Array<{ connectionId: string; ok: boolean; upserted: number; error?: string }> }> => {
        const { data, error } = await supabase.functions.invoke('order-sync', {
            body: {
                ...(connectionId ? { connectionId } : {}),
                ...(workspaceOwnerId ? { workspaceOwnerId } : {}),
            },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data as { results: Array<{ connectionId: string; ok: boolean; upserted: number; error?: string }> };
    },

    /** Platform catalog for a mapping picker. Naver returns [] until its product API is wired. */
    listProducts: async (connectionId: string): Promise<ChannelListing[]> => {
        const { data, error } = await supabase.functions.invoke('channel-products', {
            body: { connectionId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return (data?.listings ?? []) as ChannelListing[];
    },

    setAutoFulfill: async (connectionId: string, enabled: boolean): Promise<void> => {
        const { error } = await supabase
            .from('sales_channel_connections')
            .update({ auto_fulfill_on_shipped: enabled, updated_at: new Date().toISOString() })
            .eq('id', connectionId);
        if (error) throw error;
    },
};
