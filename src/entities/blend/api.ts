import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type Blend = Database['public']['Tables']['blends']['Row'];
export type BlendComponent = Database['public']['Tables']['blend_components']['Row'];

export type BlendWithComponents = Blend & {
  blend_components: (BlendComponent & { beans: { name: string } })[];
};

type BlendInsert = Database['public']['Tables']['blends']['Insert'];
type BlendComponentInsert = Database['public']['Tables']['blend_components']['Insert'];

const SELECT_WITH_COMPONENTS = '*, blend_components(*, beans(name))';

export const blendApi = {
  list: async (userId: string): Promise<BlendWithComponents[]> => {
    const { data, error } = await supabase
      .from('blends')
      .select(SELECT_WITH_COMPONENTS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as BlendWithComponents[];
  },

  get: async (id: string): Promise<BlendWithComponents> => {
    const { data, error } = await supabase
      .from('blends')
      .select(SELECT_WITH_COMPONENTS)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as BlendWithComponents;
  },

  create: async (
    blend: BlendInsert,
    components: Omit<BlendComponentInsert, 'blend_id'>[],
  ): Promise<BlendWithComponents> => {
    const { data: newBlend, error: blendErr } = await supabase
      .from('blends')
      .insert(blend)
      .select()
      .single();
    if (blendErr) throw blendErr;

    const { error: compErr } = await supabase
      .from('blend_components')
      .insert(components.map((c) => ({ ...c, blend_id: newBlend!.id })));
    if (compErr) throw compErr;

    return blendApi.get(newBlend!.id);
  },

  update: async (
    id: string,
    patch: Partial<BlendInsert>,
    components: Omit<BlendComponentInsert, 'blend_id'>[],
  ): Promise<BlendWithComponents> => {
    const { error: blendErr } = await supabase
      .from('blends')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (blendErr) throw blendErr;

    // replace all components
    const { error: delErr } = await supabase
      .from('blend_components')
      .delete()
      .eq('blend_id', id);
    if (delErr) throw delErr;

    const { error: compErr } = await supabase
      .from('blend_components')
      .insert(components.map((c) => ({ ...c, blend_id: id })));
    if (compErr) throw compErr;

    return blendApi.get(id);
  },

  delete: async (id: string): Promise<void> => {
    const { error } = await supabase.from('blends').delete().eq('id', id);
    if (error) throw error;
  },
};
