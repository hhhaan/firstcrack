import { supabase } from '@shared/lib/supabase';
import type { RoastSession, RoastSessionWithRelations } from '@shared/types/database.types';
import { addMonths, format, parse } from 'date-fns';

const SELECT_WITH_RELATIONS = '*, beans(name, origin), roast_profiles!profile_id(name, target_level)';

export type RoastSessionInsert = Omit<RoastSession, 'id' | 'created_at' | 'updated_at'>;
type RoastSessionUpdate = { id: string } & Partial<Omit<RoastSession, 'id' | 'created_at' | 'updated_at' | 'user_id'>>;

interface PaginatedParams {
    userId: string;
    status?: RoastSession['status'];
    page: number;
    pageSize: number;
    sortKey?: string;
    sortAsc?: boolean;
    level?: string | null;
    fromYM?: string | null;
    toYM?: string | null;
}

interface PaginatedResult {
    data: RoastSessionWithRelations[];
    total: number;
}

export const roastSessionApi = {
    list: async (userId: string, status?: RoastSession['status']): Promise<RoastSessionWithRelations[]> => {
        let query = supabase
            .from('roast_sessions')
            .select(SELECT_WITH_RELATIONS)
            .eq('user_id', userId)
            .order('roasted_at', { ascending: false, nullsFirst: true })
            .order('created_at', { ascending: false });

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    },

    get: async (id: string): Promise<RoastSessionWithRelations> => {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select(SELECT_WITH_RELATIONS)
            .eq('id', id)
            .single();
        if (error) throw error;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    create: async (session: RoastSessionInsert): Promise<RoastSession> => {
        const { data, error } = await supabase.from('roast_sessions').insert(session).select().single();
        if (error) throw error;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    update: async ({ id, ...patch }: RoastSessionUpdate): Promise<RoastSession> => {
        const { data, error } = await supabase.from('roast_sessions').update(patch).eq('id', id).select().single();
        if (error) throw error;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    listPaginated: async ({
        userId,
        status,
        page,
        pageSize,
        sortKey,
        sortAsc,
        level,
        fromYM,
        toYM,
    }: PaginatedParams): Promise<PaginatedResult> => {
        const safePage = Math.max(1, Math.ceil(page));
        const from = (safePage - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase
            .from('roast_sessions')
            .select(SELECT_WITH_RELATIONS, { count: 'exact' })
            .eq('user_id', userId)
            .range(from, to);

        if (status) query = query.eq('status', status);
        if (level) query = query.eq('roast_level', level);
        if (fromYM) query = query.gte('roasted_at', `${fromYM}-01`);

        if (toYM) {
            // Half-open interval [startOfMonth, startOfNextMonth).
            // lt(startOfNextMonth) safely includes the full target month regardless of days in month.
            const monthStart = parse(toYM, 'yyyy-MM', new Date());
            const nextMonthStart = addMonths(monthStart, 1);
            query = query.lt('roasted_at', format(nextMonthStart, 'yyyy-MM-dd'));
        }

        const sortCol =
            sortKey === 'date'
                ? 'roasted_at'
                : sortKey === 'drop'
                  ? 'drop_temp_celsius'
                  : sortKey === 'duration'
                    ? 'duration_seconds'
                    : 'roasted_at';
        query = query.order(sortCol, { ascending: sortAsc ?? false, nullsFirst: true });

        const { data, count, error } = await query;
        if (error) throw error;
        return { data: data || [], total: count ?? 0 };
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('roast_sessions').delete().eq('id', id);
        if (error) throw error;
    },
};
