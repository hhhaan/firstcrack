import { supabase } from '@shared/lib/supabase';
import type { Database, Json } from '@shared/types/database.types';
import { BLEND_DUPLICATE_BEAN_MESSAGE, BLEND_RATIO_SUM_MESSAGE } from './lib';

export type Blend = Database['public']['Tables']['blends']['Row'];
export type BlendComponent = Database['public']['Tables']['blend_components']['Row'];

export type BlendWithComponents = Blend & {
    blend_components: (BlendComponent & { beans: { name: string } })[];
};

type BlendInsert = Database['public']['Tables']['blends']['Insert'];
type BlendComponentInsert = Database['public']['Tables']['blend_components']['Insert'];

const SELECT_WITH_COMPONENTS = '*, blend_components(*, beans(name))';

const errorText = (error: unknown): string => {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (!error || typeof error !== 'object') return '';
    const { message, details } = error as { message?: unknown; details?: unknown };
    return `${typeof message === 'string' ? message : ''} ${typeof details === 'string' ? details : ''}`;
};

/** Maps save_blend / constraint failures to the same copy the form shows. Idempotent. */
export const blendWriteErrorMessage = (error: unknown): string | null => {
    const text = errorText(error);
    if (!text.trim()) return null;
    if (
        text.includes('blend_duplicate_bean') ||
        text.includes('unique_bean_per_blend') ||
        text.includes(BLEND_DUPLICATE_BEAN_MESSAGE)
    ) {
        return BLEND_DUPLICATE_BEAN_MESSAGE;
    }
    if (
        text.includes('blend_ratio_sum') ||
        text.includes('ratio_pct must sum to 100') ||
        text.includes(BLEND_RATIO_SUM_MESSAGE)
    ) {
        return BLEND_RATIO_SUM_MESSAGE;
    }
    return null;
};

const throwBlendWriteError = (error: unknown): never => {
    const message = blendWriteErrorMessage(error);
    if (message) throw new Error(message);
    throw error;
};

const componentPayload = (components: Omit<BlendComponentInsert, 'blend_id'>[]): Json =>
    components.map((c) => ({ bean_id: c.bean_id, ratio_pct: c.ratio_pct }));

export const blendApi = {
    list: async (userId: string): Promise<BlendWithComponents[]> => {
        const { data, error } = await supabase
            .from('blends')
            .select(SELECT_WITH_COMPONENTS)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    get: async (id: string): Promise<BlendWithComponents> => {
        const { data, error } = await supabase.from('blends').select(SELECT_WITH_COMPONENTS).eq('id', id).single();
        if (error) throw error;
        return data;
    },

    /** Header + components commit together via save_blend. */
    create: async (
        blend: BlendInsert,
        components: Omit<BlendComponentInsert, 'blend_id'>[],
    ): Promise<BlendWithComponents> => {
        const { data: id, error } = await supabase.rpc('save_blend', {
            p_user_id: blend.user_id,
            p_name: blend.name,
            p_description: blend.description ?? null,
            p_components: componentPayload(components),
        });
        if (error) throwBlendWriteError(error);
        if (!id) throw new Error('blend save returned no id');
        return blendApi.get(id);
    },

    /** Header + components commit together via save_blend. Blank description clears. */
    update: async (
        id: string,
        patch: Partial<BlendInsert>,
        components: Omit<BlendComponentInsert, 'blend_id'>[],
    ): Promise<BlendWithComponents> => {
        const { error } = await supabase.rpc('save_blend', {
            p_id: id,
            p_name: patch.name ?? '',
            p_description: patch.description ?? null,
            p_components: componentPayload(components),
        });
        if (error) throwBlendWriteError(error);
        return blendApi.get(id);
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('blends').delete().eq('id', id);
        if (error) throw error;
    },
};
