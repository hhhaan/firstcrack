import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type InventoryAlert = Database['public']['Tables']['inventory_alerts']['Row'] & {
    beans?: { name: string } | null;
};

export const inventoryAlertApi = {
    listActive: async (userId: string): Promise<InventoryAlert[]> => {
        const { data, error } = await supabase
            .from('inventory_alerts')
            .select('*, beans(name)')
            .eq('user_id', userId)
            .is('dismissed_at', null)
            .order('computed_at', { ascending: false });
        if (error) throw error;
        return (data ?? []) as InventoryAlert[];
    },

    dismiss: async (id: string): Promise<void> => {
        const { error } = await supabase
            .from('inventory_alerts')
            .update({ dismissed_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
    },
};
