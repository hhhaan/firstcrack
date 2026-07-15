import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type Order = Database['public']['Tables']['orders']['Row'];
export type OrderInsert = Database['public']['Tables']['orders']['Insert'];
export type OrderLine = Database['public']['Tables']['order_lines']['Row'];
export type OrderLineInsert = Database['public']['Tables']['order_lines']['Insert'];

export type OrderWithLines = Order & { order_lines: OrderLine[] };

export interface RoastingRequirements {
    products: {
        product_id: string;
        name: string;
        ordered_units: number;
        on_hand_units: number;
        shortfall_units: number;
    }[];
    beans: {
        bean_id: string;
        roast_profile_id: string | null;
        roasted_grams_needed: number;
        green_grams_needed: number;
        green_available: number;
    }[];
}

const SELECT_WITH_LINES = '*, order_lines(*)';

export const orderApi = {
    list: async (userId: string): Promise<OrderWithLines[]> => {
        const { data, error } = await supabase
            .from('orders')
            .select(SELECT_WITH_LINES)
            .eq('user_id', userId)
            .order('ordered_at', { ascending: false });
        if (error) throw error;
        return (data ?? []) as OrderWithLines[];
    },

    /** Manual order entry — order + its lines in one call. */
    create: async (
        order: OrderInsert,
        lines: Omit<OrderLineInsert, 'order_id' | 'user_id'>[],
    ): Promise<OrderWithLines> => {
        const { data: newOrder, error: orderErr } = await supabase.from('orders').insert(order).select().single();
        if (orderErr) throw orderErr;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        const created = newOrder!;

        if (!lines.length) return { ...created, order_lines: [] };

        const { data: newLines, error: lineErr } = await supabase
            .from('order_lines')
            .insert(lines.map((l) => ({ ...l, order_id: created.id, user_id: created.user_id })))
            .select();
        if (lineErr) {
            // best-effort compensation: don't leave an orphan order behind
            await supabase.from('orders').delete().eq('id', created.id);
            throw lineErr;
        }
        return { ...created, order_lines: newLines ?? [] };
    },

    /** Atomic RPC: deducts stock for active mapped lines + stamps fulfilled_at in one transaction. */
    fulfill: async (orderId: string): Promise<void> => {
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { error } = await (supabase as any).rpc('fulfill_order', { p_order_id: orderId });
        if (error) throw error;
    },

    getRoastingRequirements: async (userId: string): Promise<RoastingRequirements> => {
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { data, error } = await (supabase as any).rpc('get_roasting_requirements', { p_user_id: userId });
        if (error) throw error;
        return (data as RoastingRequirements) ?? { products: [], beans: [] };
    },
};
