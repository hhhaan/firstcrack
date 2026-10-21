import { supabase } from '@shared/lib/supabase';

/** PostgREST `max_rows` in supabase/config.toml. A single select silently drops the rest. */
export const SESSION_COUNT_PAGE = 1000;

/** Count linked roast sessions for these batches, past the PostgREST row cap. */
export async function countSessionsByBatch(batchIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (batchIds.length === 0) return counts;

    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select('plan_batch_id')
            .in('plan_batch_id', batchIds)
            .order('id', { ascending: true })
            .range(from, from + SESSION_COUNT_PAGE - 1);
        if (error) throw error;
        const page = data ?? [];
        for (const row of page) {
            if (!row.plan_batch_id) continue;
            counts.set(row.plan_batch_id, (counts.get(row.plan_batch_id) ?? 0) + 1);
        }
        if (page.length < SESSION_COUNT_PAGE) return counts;
        from += SESSION_COUNT_PAGE;
    }
}
