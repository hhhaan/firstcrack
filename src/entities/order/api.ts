import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';
import { addMonths, format, parse } from 'date-fns';

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

/**
 * `fulfilled` is not an order status — it is `fulfilled_at IS NOT NULL`. The table badge already
 * merges the two, so the filter exposes the same three buckets the user actually reasons about
 * instead of the seven raw platform statuses.
 */
export type OrderStatusFilter = 'all' | 'unfulfilled' | 'fulfilled' | 'cancelled';

const TERMINAL_STATUSES = ['cancelled', 'refunded'];

export interface OrderPageParams {
    userId: string;
    page: number;
    pageSize: number;
    status?: OrderStatusFilter;
    platform?: string | null;
    /** Matches buyer name or platform order id. */
    search?: string;
    fromYM?: string | null;
    toYM?: string | null;
}

export interface OrderPage {
    data: OrderWithLines[];
    total: number;
}

/**
 * PostgREST `.or()` uses `,` to separate conditions and `()` to group them, so those three
 * characters would let a search term rewrite the filter. `%`/`_` stay — they are ilike
 * wildcards inside the value and are harmless (arguably useful) here.
 */
export const sanitizeOrTerm = (term: string) => term.replace(/[,()]/g, ' ').trim();

export const orderApi = {
    listPaginated: async ({
        userId,
        page,
        pageSize,
        status = 'all',
        platform,
        search,
        fromYM,
        toYM,
    }: OrderPageParams): Promise<OrderPage> => {
        const safePage = Math.max(1, Math.ceil(page));
        const from = (safePage - 1) * pageSize;

        let query = supabase
            .from('orders')
            .select(SELECT_WITH_LINES, { count: 'exact' })
            .eq('user_id', userId)
            .order('ordered_at', { ascending: false })
            .range(from, from + pageSize - 1);

        if (status === 'cancelled') query = query.in('status', TERMINAL_STATUSES);
        if (status === 'fulfilled')
            query = query.not('fulfilled_at', 'is', null).not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`);
        if (status === 'unfulfilled')
            query = query.is('fulfilled_at', null).not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`);

        if (platform) query = query.eq('platform', platform);
        if (fromYM) query = query.gte('ordered_at', `${fromYM}-01`);
        if (toYM) {
            // Half-open interval [startOfMonth, startOfNextMonth) — same idiom as roastSessionApi
            // so a month boundary never depends on how many days that month has.
            const nextMonthStart = addMonths(parse(toYM, 'yyyy-MM', new Date()), 1);
            query = query.lt('ordered_at', format(nextMonthStart, 'yyyy-MM-dd'));
        }

        const term = search ? sanitizeOrTerm(search) : '';
        if (term) query = query.or(`buyer_name.ilike.%${term}%,platform_order_id.ilike.%${term}%`);

        const { data, count, error } = await query;
        if (error) throw error;
        return { data: data ?? [], total: count ?? 0 };
    },

    /** Manual order entry — order + its lines in one call. */
    create: async (
        order: OrderInsert,
        lines: Omit<OrderLineInsert, 'order_id' | 'user_id'>[],
    ): Promise<OrderWithLines> => {
        const { data: newOrder, error: orderErr } = await supabase.from('orders').insert(order).select().single();
        if (orderErr) throw orderErr;
        const created = newOrder;

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
        const { error } = await supabase.rpc('fulfill_order', { p_order_id: orderId });
        if (error) throw error;
    },

    /** Atomic RPC: restore stock for fulfilled lines + set status cancelled. */
    cancel: async (orderId: string): Promise<void> => {
        const { error } = await supabase.rpc('cancel_order', { p_order_id: orderId });
        if (error) throw error;
    },

    getRoastingRequirements: async (userId: string): Promise<RoastingRequirements> => {
        const { data, error } = await supabase.rpc('get_roasting_requirements', { p_user_id: userId });
        if (error) throw error;
        return (data as unknown as RoastingRequirements) ?? { products: [], beans: [] };
    },
};
