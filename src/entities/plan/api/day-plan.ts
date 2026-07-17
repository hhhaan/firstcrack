import { supabase } from '@shared/lib/supabase';
import type { DayPlan } from '@shared/types/database.types';

export const dayPlanApi = {
    getOrCreate: async (userId: string, date: string): Promise<DayPlan> => {
        const { data: existing } = await supabase
            .from('roast_day_plans')
            .select('*')
            .eq('user_id', userId)
            .eq('date', date)
            .maybeSingle();

        if (existing) return existing;

        const { data, error } = await supabase
            .from('roast_day_plans')
            .insert({ user_id: userId, date, notes: '' })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    updateNotes: async (id: string, notes: string): Promise<DayPlan> => {
        const { data, error } = await supabase.from('roast_day_plans').update({ notes }).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },
};
