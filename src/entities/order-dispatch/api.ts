import { supabase } from '@shared/lib/supabase';

export type DispatchStatus = 'pending' | 'sent' | 'confirmed' | 'failed';

export interface OrderDispatch {
    id: string;
    user_id: string;
    order_id: string;
    connection_id: string;
    carrier: string;
    tracking_number: string;
    status: DispatchStatus;
    attempt_count: number;
    last_error: string | null;
    line_results: unknown;
    requested_at: string;
    sent_at: string | null;
    confirmed_at: string | null;
    updated_at: string;
}

export const orderDispatchApi = {
    listByUser: async (userId: string): Promise<OrderDispatch[]> => {
        // biome-ignore lint/suspicious/noExplicitAny: table types until types:gen after migration
        const { data, error } = await (supabase as any)
            .from('order_dispatches')
            .select(
                'id, user_id, order_id, connection_id, carrier, tracking_number, status, attempt_count, last_error, line_results, requested_at, sent_at, confirmed_at, updated_at',
            )
            .eq('user_id', userId);
        if (error) throw error;
        return (data ?? []) as OrderDispatch[];
    },

    dispatch: async (input: {
        orderId: string;
        carrier: string;
        trackingNumber: string;
    }): Promise<{ status: DispatchStatus; error?: string; alreadyShipped?: boolean }> => {
        const { data, error } = await supabase.functions.invoke('order-dispatch', {
            body: input,
        });
        if (error) throw error;
        if (data?.error && data?.status !== 'failed') throw new Error(data.error);
        return data as { status: DispatchStatus; error?: string; alreadyShipped?: boolean };
    },
};
