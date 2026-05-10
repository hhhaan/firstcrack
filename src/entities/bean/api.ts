import { supabaseAxios } from '../../shared/lib/axios'
import type { Bean, Database } from '../../shared/types/database.types'

type BeanInsert = Database['public']['Tables']['beans']['Insert']
type BeanUpdate = { id: string } & Database['public']['Tables']['beans']['Update']

export const beanApi = {
    list: async (userId: string): Promise<Bean[]> => {
        const { data } = await supabaseAxios.get<Bean[]>('/beans', {
            params: { user_id: `eq.${userId}`, select: '*', order: 'created_at.desc' },
        })
        return data
    },

    get: async (id: string): Promise<Bean> => {
        const { data } = await supabaseAxios.get<Bean[]>('/beans', {
            params: { id: `eq.${id}`, select: '*' },
        })
        return data[0]
    },

    create: async (bean: BeanInsert): Promise<Bean> => {
        const { data } = await supabaseAxios.post<Bean[]>('/beans', bean, {
            headers: { Prefer: 'return=representation' },
        })
        return data[0]
    },

    update: async ({ id, ...patch }: BeanUpdate): Promise<Bean> => {
        const { data } = await supabaseAxios.patch<Bean[]>('/beans', patch, {
            params: { id: `eq.${id}` },
            headers: { Prefer: 'return=representation' },
        })
        return data[0]
    },

    delete: async (id: string): Promise<void> => {
        await supabaseAxios.delete('/beans', { params: { id: `eq.${id}` } })
    },
}
