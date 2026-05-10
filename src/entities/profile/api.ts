import { supabase } from '../../shared/lib/supabase'
import type { Profile } from '../../shared/types/database.types'

type ProfilePatch = Partial<Pick<Profile, 'display_name' | 'avatar_url'>>

export const profileApi = {
    get: async (userId: string): Promise<Profile | null> => {
        const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single()
        return data as Profile | null
    },

    update: async (userId: string, patch: ProfilePatch): Promise<Profile> => {
        const { data, error } = await supabase
            .from('profiles')
            .update(patch as never)
            .eq('id', userId)
            .select()
            .single()
        if (error) throw error
        return data as Profile
    },
}
