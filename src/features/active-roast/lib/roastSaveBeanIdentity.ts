import { i18n } from '@shared/i18n';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { SaveRoastParams } from '../model/save-roast-types';

/** Handoff wins; otherwise ad-hoc linked batch from the save form. */
export const resolveEffectiveBatch = (
    planBatchHandoff: PlanBatchHandoff | null,
    linkedBatch?: PlanBatchHandoff | null,
): PlanBatchHandoff | null => planBatchHandoff ?? linkedBatch ?? null;

/** Client-side validation — must not be reported to Sentry. */
export class RoastSaveUserError extends Error {
    readonly userFacing = true as const;

    constructor(message: string) {
        super(message);
        this.name = 'RoastSaveUserError';
    }
}

export const isRoastSaveUserError = (err: unknown): err is RoastSaveUserError => err instanceof RoastSaveUserError;

export function resolveRoastSaveBeanFields(params: SaveRoastParams) {
    const effectiveBatch = resolveEffectiveBatch(params.planBatchHandoff, params.formData.linkedBatch);
    const weightGrams = Math.round(params.formData.weightGrams * 1000);
    const blendId = effectiveBatch?.blendId ?? null;
    const beanLabelRaw = params.formData.beanLabel?.trim() || null;
    const inventoryBeanId =
        effectiveBatch?.beanId ?? params.formData.beanId ?? (beanLabelRaw ? null : params.selectedBeanId);
    const resolvedBeanId = inventoryBeanId ?? null;
    const beanLabel = resolvedBeanId || blendId ? null : beanLabelRaw;
    return { effectiveBatch, weightGrams, blendId, resolvedBeanId, beanLabel };
}

export function assertGreenBeanSelectedForSave(params: SaveRoastParams): void {
    const { weightGrams, resolvedBeanId, blendId, beanLabel } = resolveRoastSaveBeanFields(params);
    if (weightGrams > 0 && !resolvedBeanId && !blendId && !beanLabel) {
        throw new RoastSaveUserError(i18n.t('activeRoast.summary.beanRequired'));
    }
}
