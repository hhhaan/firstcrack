import { supabaseAxios } from '../../shared/lib/axios'
import type { BeanInventoryLog, BeanInventoryLogInsert, BeanInventoryLogUpdate } from '../../shared/types/database.types'

export const beanInventoryApi = {
    list: async (userId: string, beanId?: string): Promise<BeanInventoryLog[]> => {
        const { data } = await supabaseAxios.get<BeanInventoryLog[]>('/bean_inventory_logs', {
            params: {
                user_id: `eq.${userId}`,
                ...(beanId ? { bean_id: `eq.${beanId}` } : {}),
                select: '*',
                order: 'created_at.desc',
            },
        })
        return data
    },

    create: async (log: BeanInventoryLogInsert): Promise<BeanInventoryLog> => {
        const { data } = await supabaseAxios.post<BeanInventoryLog[]>('/bean_inventory_logs', log, {
            headers: { Prefer: 'return=representation' },
        })
        return data[0]
    },

    update: async ({ id, ...patch }: { id: string } & BeanInventoryLogUpdate): Promise<BeanInventoryLog> => {
        const { data } = await supabaseAxios.patch<BeanInventoryLog[]>('/bean_inventory_logs', patch, {
            params: { id: `eq.${id}` },
            headers: { Prefer: 'return=representation' },
        })
        return data[0]
    },

    delete: async (id: string): Promise<void> => {
        await supabaseAxios.delete('/bean_inventory_logs', { params: { id: `eq.${id}` } })
    },
}
