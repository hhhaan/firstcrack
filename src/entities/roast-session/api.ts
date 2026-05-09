import { supabaseAxios } from '@shared/lib/axios'
import type { RoastSession, RoastSessionWithRelations } from '@shared/types/database.types'

const SELECT_WITH_RELATIONS = '*, beans(name, origin), roast_profiles(name, target_level)'

type RoastSessionInsert = Omit<RoastSession, 'id' | 'created_at' | 'updated_at'>
type RoastSessionUpdate = { id: string } & Partial<Omit<RoastSession, 'id' | 'created_at' | 'updated_at' | 'user_id'>>

export const roastSessionApi = {
    list: async (userId: string, status?: RoastSession['status']): Promise<RoastSessionWithRelations[]> => {
        const { data } = await supabaseAxios.get<RoastSessionWithRelations[]>('/roast_sessions', {
            params: {
                user_id: `eq.${userId}`,
                ...(status ? { status: `eq.${status}` } : {}),
                select: SELECT_WITH_RELATIONS,
                order: 'roasted_at.desc,created_at.desc',
            },
        })
        return data
    },

    get: async (id: string): Promise<RoastSessionWithRelations> => {
        const { data } = await supabaseAxios.get<RoastSessionWithRelations[]>('/roast_sessions', {
            params: { id: `eq.${id}`, select: SELECT_WITH_RELATIONS },
        })
        return data[0]
    },

    create: async (session: RoastSessionInsert): Promise<RoastSession> => {
        const { data } = await supabaseAxios.post<RoastSession[]>('/roast_sessions', session, {
            headers: { Prefer: 'return=representation' },
        })
        return data[0]
    },

    update: async ({ id, ...patch }: RoastSessionUpdate): Promise<RoastSession> => {
        const { data } = await supabaseAxios.patch<RoastSession[]>('/roast_sessions', patch, {
            params: { id: `eq.${id}` },
            headers: { Prefer: 'return=representation' },
        })
        return data[0]
    },

    delete: async (id: string): Promise<void> => {
        await supabaseAxios.delete('/roast_sessions', { params: { id: `eq.${id}` } })
    },
}
