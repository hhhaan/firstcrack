import { supabase } from '@shared/lib/supabase';

export type ChannelPlatform = 'naver' | 'cafe24' | 'shopify';
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

export type ConnectCredentials =
    | { client_id: string; client_secret: string } // naver
    | { shop: string; access_token: string } // shopify
    | { mall_id: string; access_token: string; refresh_token?: string; client_id?: string; client_secret?: string }; // cafe24

export const salesChannelApi = {
    list: async (userId: string): Promise<SalesChannelConnection[]> => {
        // biome-ignore lint/suspicious/noExplicitAny: table types until types:gen after migration
        const { data, error } = await (supabase as any)
            .from('sales_channel_connections')
            .select(
                'id, user_id, platform, shop_identifier, display_name, status, last_error, consecutive_failures, last_polled_at, webhook_registered, auto_fulfill_on_shipped, created_at, updated_at',
            )
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data ?? []) as SalesChannelConnection[];
    },

    connect: async (
        platform: ChannelPlatform,
        credentials: ConnectCredentials,
        displayName?: string,
    ): Promise<SalesChannelConnection> => {
        const { data, error } = await supabase.functions.invoke('channel-connect', {
            body: { platform, credentials, displayName },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data.connection as SalesChannelConnection;
    },

    disconnect: async (connectionId: string): Promise<void> => {
        const { data, error } = await supabase.functions.invoke('channel-disconnect', {
            body: { connectionId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
    },

    syncNow: async (
        connectionId?: string,
    ): Promise<{ results: Array<{ connectionId: string; ok: boolean; upserted: number; error?: string }> }> => {
        const { data, error } = await supabase.functions.invoke('order-sync', {
            body: connectionId ? { connectionId } : {},
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data as { results: Array<{ connectionId: string; ok: boolean; upserted: number; error?: string }> };
    },

    setAutoFulfill: async (connectionId: string, enabled: boolean): Promise<void> => {
        // biome-ignore lint/suspicious/noExplicitAny: table types until types:gen
        const { error } = await (supabase as any)
            .from('sales_channel_connections')
            .update({ auto_fulfill_on_shipped: enabled, updated_at: new Date().toISOString() })
            .eq('id', connectionId);
        if (error) throw error;
    },
};
