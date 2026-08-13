import { z } from 'zod';

/** Commercial-roaster sanity cap (kg). Form field `weightGrams` is kg despite the name. */
export const MAX_BATCH_WEIGHT_KG = 500;

type SummaryT = (key: string, options?: Record<string, unknown>) => string;

const roastSummaryFields = (t: SummaryT) =>
    z.object({
        notes: z.string().max(2000, 'Notes are too long'),
        /** Green input in kg (historical field name). */
        weightGrams: z
            .number()
            .min(0, 'Weight must be 0 or greater')
            .max(MAX_BATCH_WEIGHT_KG, t('activeRoast.summary.weightTooLarge', { max: MAX_BATCH_WEIGHT_KG })),
        /** Measured roasted output in kg. Blank input yields NaN — treated as "not weighed", not invalid. */
        outputWeightKg: z
            .union([
                z
                    .number()
                    .min(0, 'Weight must be 0 or greater')
                    .max(MAX_BATCH_WEIGHT_KG, t('activeRoast.summary.weightTooLarge', { max: MAX_BATCH_WEIGHT_KG })),
                z.nan(),
            ])
            .optional(),
        roastLevel: z.string().nullable(),
        beanId: z.string().nullable(),
        /** Free-text when no inventory bean selected (sample / no-stock). */
        beanLabel: z.string().max(120),
        /** ad-hoc only: link to today's schedule batch, or none */
        linkMode: z.enum(['schedule', 'none']),
        planBatchId: z.string().nullable(),
        deductStock: z.boolean(),
    });

export type RoastSummaryForm = z.infer<ReturnType<typeof roastSummaryFields>>;

export const buildRoastSummarySchema = (t: SummaryT, hasHandoff: boolean) =>
    roastSummaryFields(t).superRefine((data, ctx) => {
        const output = data.outputWeightKg;
        if (
            Number.isFinite(output) &&
            (output as number) > 0 &&
            data.weightGrams > 0 &&
            (output as number) > data.weightGrams
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['outputWeightKg'],
                message: t('activeRoast.summary.outputExceedsInput'),
            });
        }

        if (hasHandoff) return;
        if (data.linkMode === 'schedule') {
            if (!data.planBatchId) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['planBatchId'],
                    message: t('activeRoast.summary.planBatchRequired'),
                });
            }
            return;
        }
        // Weight set → inventory bean or free-text label (history needs a name).
        if (data.weightGrams <= 0) return;
        if (data.beanId) return;
        if (!data.beanLabel.trim()) {
            ctx.addIssue({
                code: 'custom',
                path: ['beanLabel'],
                message: t('activeRoast.summary.beanRequired'),
            });
        }
    });
