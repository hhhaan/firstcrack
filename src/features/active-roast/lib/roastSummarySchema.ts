import { z } from 'zod';
import { ROAST_COLOR_MAX_LENGTH } from './roastColorText';

/**
 * Physical sanity ceiling for a single batch, in kg. Commercial roasters top out
 * far below this — the bound exists to catch unit/typo slips (12 → 120), not to
 * model any real machine.
 */
export const MAX_BATCH_WEIGHT_KG = 500;

/** Shape only — the live schema comes from {@link buildRoastSummarySchema} (needs `t`). */
const roastSummaryShape = z.object({
    notes: z.string().max(2000, 'Notes are too long'),
    /**
     * Green charge weight in **kg** despite the `Grams` name — `saveRoastCore`
     * converts with `Math.round(formData.weightGrams * 1000)` (useSaveRoast.ts:159).
     * Same naming caveat as `roastSession.ts:7`.
     */
    weightGrams: z.number(),
    /** Measured roasted output, kg. Blank input yields NaN — treated as "not weighed", not invalid. */
    outputWeightKg: z.union([z.number(), z.nan()]).optional(),
    roastLevel: z.string().nullable(),
    beanId: z.string().nullable(),
    /** Free-text when no inventory bean selected (sample / no-stock). */
    beanLabel: z.string().max(120),
    /** ad-hoc only: link to today's schedule batch, or none */
    linkMode: z.enum(['schedule', 'none']),
    planBatchId: z.string().nullable(),
    deductStock: z.boolean(),
    /** Whole-bean roast color (free text). Blank → not recorded. */
    colorWhole: z.string().optional(),
    /** Ground roast color (free text). Blank → not recorded. */
    colorGround: z.string().optional(),
});

export type RoastSummaryForm = z.infer<typeof roastSummaryShape>;

interface BuildRoastSummarySchemaParams {
    t: (key: string) => string;
    /** Existing schedule handoff — link fields are read-only, so skip their refinement. */
    hasHandoff: boolean;
}

/**
 * Weight bounds mirror the DB check on `roast_sessions`
 * (`output_weight_grams <= weight_grams`, 20260720112107_roast_output_weight.sql).
 * Roasting always loses mass, so output > input is blocked, not warned: it only
 * ever means a mis-keyed number or a unit mix-up.
 */
export const buildRoastSummarySchema = ({ t, hasHandoff }: BuildRoastSummarySchemaParams) => {
    const weightKg = z
        .number()
        .min(0, 'Weight must be 0 or greater')
        .max(MAX_BATCH_WEIGHT_KG, t('activeRoast.summary.weightTooLarge'));

    return roastSummaryShape
        .extend({
            weightGrams: weightKg,
            outputWeightKg: z.union([weightKg, z.nan()]).optional(),
            colorWhole: z.string().max(ROAST_COLOR_MAX_LENGTH, t('activeRoast.summary.colorTooLong')).optional(),
            colorGround: z.string().max(ROAST_COLOR_MAX_LENGTH, t('activeRoast.summary.colorTooLong')).optional(),
        })
        .superRefine((data, ctx) => {
            const output = data.outputWeightKg;
            // No `weightGrams > 0` guard: weight 0 + output 5 is exactly the combo the
            // DB check rejects with 23514, so it has to fail here too.
            if (typeof output === 'number' && Number.isFinite(output) && output > 0 && output > data.weightGrams) {
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
};
