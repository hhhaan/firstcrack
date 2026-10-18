import { blendApi } from '@entities/blend';
import type { PlanBatchWithProgress } from '@shared/types/database.types';

/** Bean ids whose stock queries should refresh after a plan-batch complete deduct. */
export async function stockBeanIdsForPlanBatch(
    batch: PlanBatchWithProgress,
    getBlend: typeof blendApi.get = blendApi.get,
): Promise<string[]> {
    if (batch.bean_id) return [batch.bean_id];
    if (!batch.blend_id) return [];
    const blend = await getBlend(batch.blend_id);
    if (!blend?.blend_components?.length) return [];
    return [...new Set(blend.blend_components.map((c) => c.bean_id))];
}
