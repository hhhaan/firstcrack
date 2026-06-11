import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type BeanStockEvent = Database['public']['Tables']['bean_stock_events']['Row'];
type BeanStockEventInsert = Database['public']['Tables']['bean_stock_events']['Insert'];

export type StockSummary = {
  currentGrams: number;
  reservedGrams: number;
  effectiveGrams: number;
};

export const beanStockEventApi = {
  listByBean: async (beanId: string): Promise<BeanStockEvent[]> => {
    const { data, error } = await supabase
      .from('bean_stock_events')
      .select('*')
      .eq('bean_id', beanId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  insert: async (event: BeanStockEventInsert): Promise<BeanStockEvent> => {
    const { data, error } = await supabase
      .from('bean_stock_events')
      .insert(event)
      .select()
      .single();
    if (error) throw error;
    return data!;
  },

  getCurrentStock: async (beanId: string): Promise<number> => {
    const { data, error } = await supabase
      .from('bean_stock_events')
      .select('delta_grams')
      .eq('bean_id', beanId);
    if (error) throw error;
    return (data ?? []).reduce((sum, e) => sum + e.delta_grams, 0);
  },

  getReservedStock: async (beanId: string): Promise<number> => {
    const { data, error } = await supabase
      .from('roast_plan_batches')
      .select('batch_size_kg, batch_count')
      .eq('bean_id', beanId)
      .in('status', ['pending', 'scheduled']);
    if (error) throw error;
    return (data ?? []).reduce(
      (sum, b) => sum + b.batch_size_kg * b.batch_count * 1000,
      0,
    );
  },

  getStockSummary: async (beanId: string): Promise<StockSummary> => {
    const [currentGrams, reservedGrams] = await Promise.all([
      beanStockEventApi.getCurrentStock(beanId),
      beanStockEventApi.getReservedStock(beanId),
    ]);
    return {
      currentGrams,
      reservedGrams,
      effectiveGrams: currentGrams - reservedGrams,
    };
  },
};
