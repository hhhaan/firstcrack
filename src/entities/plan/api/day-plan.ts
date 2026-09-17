import { supabase } from '@shared/lib/supabase';
import type { DayPlan } from '@shared/types/database.types';

export const dayPlanApi = {
    get: async (userId: string, date: string): Promise<DayPlan | null> => {
        const { data, error } = await supabase
            .from('roast_day_plans')
            .select('*')
            .eq('user_id', userId)
            .eq('date', date)
            .maybeSingle();
        if (error) throw error;
        return data;
    },

    getOrCreate: async (userId: string, date: string): Promise<DayPlan> => {
        const existing = await dayPlanApi.get(userId, date);
        if (existing) return existing;

        const { data, error } = await supabase
            .from('roast_day_plans')
            .insert({ user_id: userId, date, notes: '' })
            .select()
            .single();
        if (error?.code === '23505') {
            const winner = await dayPlanApi.get(userId, date);
            if (winner) return winner;
        }
        if (error) throw error;
        return data;
    },

    updateNotes: async (id: string, notes: string): Promise<DayPlan> => {
        const { data, error } = await supabase.from('roast_day_plans').update({ notes }).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },
};
