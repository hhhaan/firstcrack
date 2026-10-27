import { supabase } from '@shared/lib/supabase';
import type { Database, Json, RoastSession, RoastSessionWithRelations } from '@shared/types/database.types';
import type { BatchTitleNumbering } from '@shared/types/roast';
import { addMonths, endOfMonth, format, parse, startOfMonth } from 'date-fns';

const SELECT_WITH_RELATIONS =
    '*, blends(name), beans(name, origin, region, variety, process, farm), roast_profiles!profile_id(name, target_level)';

/** Insert payload — created_by defaults to auth.uid() in DB. */
export type RoastSessionInsert = Omit<
    Database['public']['Tables']['roast_sessions']['Insert'],
    | 'id'
    | 'created_at'
    | 'updated_at'
    | 'created_by'
    | 'heater_events'
    | 'batch_name'
    | 'profile_batch_number'
    | 'total_batch_number'
> & {
    /** Client session uuid — save_roast_op idempotency key. Omit → server generates. */
    id?: string;
    batch_name?: string | null;
    batch_title_numbering?: BatchTitleNumbering;
    /** Device prefix for the workspace-wide mark. Omitted values use PR in save_roast_op. */
    batch_title_prefix?: string;
    created_by?: string | null;
};
type RoastSessionUpdate = { id: string } & Partial<
    Omit<
        RoastSession,
        'id' | 'created_at' | 'updated_at' | 'user_id' | 'profile_id' | 'profile_batch_number' | 'total_batch_number'
    >
>;

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

export type RoastSessionFilterMeta = Pick<RoastSession, 'roasted_at' | 'profile_id'> & {
    beans: { origin: string | null } | null;
    roast_profiles: { name: string } | null;
};

/** PostgREST `max_rows` in supabase/config.toml. A single select silently drops the rest. */
export const POSTGREST_MAX_ROWS = 1000;

const fetchAllRows = async <T>(
    queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> => {
    const out: T[] = [];
    let from = 0;
    for (;;) {
        const { data, error } = await queryPage(from, from + POSTGREST_MAX_ROWS - 1);
        if (error) throw error;
        const page = data ?? [];
        out.push(...page);
        if (page.length < POSTGREST_MAX_ROWS) return out;
        from += POSTGREST_MAX_ROWS;
    }
};

export const roastSessionApi = {
    list: async (userId: string, status?: RoastSession['status']): Promise<RoastSessionWithRelations[]> => {
        return fetchAllRows(async (from, to) => {
            let query = supabase
                .from('roast_sessions')
                .select(SELECT_WITH_RELATIONS)
                .eq('user_id', userId)
                .order('roasted_at', { ascending: false, nullsFirst: true })
                .order('created_at', { ascending: false })
                .range(from, to);
            if (status) query = query.eq('status', status);
            return query;
        });
    },

    /** Lightweight rows for History filter dropdowns + total count (no events/embeds bloat). */
    listFilterMeta: async (userId: string): Promise<RoastSessionFilterMeta[]> => {
        return fetchAllRows(async (from, to) =>
            supabase
                .from('roast_sessions')
                .select('roasted_at, profile_id, beans(origin), roast_profiles!profile_id(name)')
                .eq('user_id', userId)
                .eq('status', 'completed')
                .order('id')
                .range(from, to),
        );
    },

    get: async (id: string): Promise<RoastSessionWithRelations> => {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select(SELECT_WITH_RELATIONS)
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    },

    find: async (id: string): Promise<RoastSession | null> => {
        const { data, error } = await supabase.from('roast_sessions').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    },

    /**
     * Atomic save: session + optional bean deduct + optional roasted inbound (C1).
     * Server skips deduct when batch-level deduction already exists (C2).
     */
    saveOp: async (params: {
        session: RoastSessionInsert;
        deduct: boolean;
        deductionGrams: number;
        inboundGrams: number;
        inboundIsEstimate: boolean;
        expectedBatch?: { beanId: string | null; blendId: string | null };
    }): Promise<RoastSession> => {
        const { data, error } = await supabase.rpc('save_roast_op', {
            p_session: {
                ...params.session,
                ...(params.expectedBatch
                    ? {
                          expected_plan_bean_id: params.expectedBatch.beanId,
                          expected_plan_blend_id: params.expectedBatch.blendId,
                      }
                    : {}),
            },
            p_deduct: params.deduct,
            p_deduction_grams: params.deductionGrams,
            p_inbound_grams: params.inboundGrams,
            p_inbound_is_estimate: params.inboundIsEstimate,
        });
        if (error) throw error;
        return data as RoastSession;
    },

    /** Lifetime completed sessions (trial 20-batch cap). */
    countCompletedTotal: async (userId: string): Promise<number> => {
        const { count, error } = await supabase
            .from('roast_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'completed');
        if (error) throw error;
        return count ?? 0;
    },

    /** Completed sessions in local calendar month (batch quota). */
    countCompletedThisMonth: async (userId: string, now = new Date()): Promise<number> => {
        const from = startOfMonth(now).toISOString();
        const to = endOfMonth(now).toISOString();
        const { count, error } = await supabase
            .from('roast_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'completed')
            .gte('roasted_at', from)
            .lte('roasted_at', to);
        if (error) throw error;
        return count ?? 0;
    },

    update: async ({ id, ...patch }: RoastSessionUpdate): Promise<RoastSession> => {
        const { data, error } = await supabase.from('roast_sessions').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
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
        const { error } = await supabase.rpc('delete_roast_session', { p_session_id: id });
        if (error) throw error;
    },

    /** Heat set of one roast record. Does not change its curve or the profile row. */
    setHeaterEvents: async (sessionId: string, heaterEvents: Json | null): Promise<void> => {
        const { error } = await supabase
            .from('roast_sessions')
            .update({ heater_events: heaterEvents })
            .eq('id', sessionId);
        if (error) throw error;
    },

    /**
     * History edit of a saved record (#623). Compare-and-swap on events/heater_events:
     * a concurrent edit fails with PT409 instead of being overwritten. No stock side effects.
     */
    updateRecord: async (p: {
        sessionId: string;
        expectedEvents: Json;
        expectedHeaterEvents: Json | null;
        events: Json;
        heaterEvents: Json | null;
        dropTempCelsius: number | null;
        durationSeconds: number | null;
        /** Derived columns for profiles cut from this record; null = events unchanged, leave profiles. */
        profileSummary: Json | null;
    }): Promise<RoastSession> => {
        // Gen types mark integer args non-null; SQL accepts null (summary unknown on legacy rows).
        const { data, error } = await supabase.rpc('update_roast_session_record', {
            p_session_id: p.sessionId,
            p_expected_events: p.expectedEvents,
            p_expected_heater_events: p.expectedHeaterEvents,
            p_events: p.events,
            p_heater_events: p.heaterEvents,
            p_drop_temp_celsius: p.dropTempCelsius as number,
            p_duration_seconds: p.durationSeconds as number,
            p_profile_summary: p.profileSummary,
        });
        if (error) throw error;
        return data;
    },

    /** Atomic: set output_weight_grams + upsert roasted inbound. */
    setOutputWeight: async (p: { sessionId: string; outputGrams: number | null }): Promise<void> => {
        // Gen types mark integer args non-null; SQL accepts null to clear measured output.
        const { error } = await supabase.rpc('correct_session_output_weight', {
            p_session_id: p.sessionId,
            p_output_grams: p.outputGrams as number,
        });
        if (error) throw error;
    },

    /**
     * Correct green charge. Rescales session-owned roast deductions and
     * upserts roasted inbound for the new green weight. Does not touch a
     * batch-level deduct.
     */
    setChargeWeight: async (p: { sessionId: string; weightGrams: number }): Promise<void> => {
        const { error } = await supabase.rpc('correct_session_charge_weight', {
            p_session_id: p.sessionId,
            p_weight_grams: p.weightGrams,
        });
        if (error) throw error;
    },

    /** Atomic level correction; measured output is preserved. */
    setRoastLevel: async (p: { sessionId: string; roastLevel: string | null }): Promise<void> => {
        const { error } = await supabase.rpc('set_session_roast_level', {
            p_session_id: p.sessionId,
            p_roast_level: p.roastLevel as string,
        });
        if (error) throw error;
    },

    /**
     * Dashboard recent/KPI sessions (completed since lastMonthStart).
     * `events` is included so 시간 is Charge→Drop (`sessionRoastMetrics`), not record End.
     */
    listCompletedDashboard: async (
        userId: string,
        sinceIso: string,
    ): Promise<
        Array<{
            id: string;
            roasted_at: string | null;
            weight_grams: number;
            duration_seconds: number | null;
            events: Json;
            drop_temp_celsius: number | null;
            roast_level: string | null;
            bean_label: string | null;
            beans: { name: string; origin: string | null } | null;
            roast_profiles: { name: string; target_level: string | null } | null;
        }>
    > => {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select(
                'id, roasted_at, weight_grams, duration_seconds, events, drop_temp_celsius, roast_level, bean_label, beans(name, origin), roast_profiles!profile_id(name, target_level)',
            )
            .eq('user_id', userId)
            .eq('status', 'completed')
            .gte('roasted_at', sinceIso)
            .order('roasted_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    /**
     * Dashboard monthly chart and past-month KPIs (weight + date only).
     * `untilIso` is exclusive, so pass the start of the month after the selection.
     */
    listCompletedWeightsSince: async (
        userId: string,
        sinceIso: string,
        untilIso?: string,
    ): Promise<Array<{ roasted_at: string | null; weight_grams: number }>> => {
        let query = supabase
            .from('roast_sessions')
            .select('roasted_at, weight_grams')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .gte('roasted_at', sinceIso);
        if (untilIso) query = query.lt('roasted_at', untilIso);
        const { data, error } = await query.order('roasted_at', { ascending: true });
        if (error) throw error;
        return data ?? [];
    },
};
