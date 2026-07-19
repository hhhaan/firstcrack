import { inventoryStore } from '@shared/lib/inventoryStore';
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
        return data ?? [];
    },

    dismiss: async (id: string): Promise<void> => {
        const { error } = await supabase
            .from('inventory_alerts')
            .update({ dismissed_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
    },

    /** Same RPC as stock-event path; owned here so inventory-alert does not import bean-stock-event. */
    computeInventoryAlerts: async (userId: string, horizonDays?: number): Promise<void> => {
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());
        const { error } = await supabase.rpc('compute_inventory_alerts', {
            p_user_id: userId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
    },
};
