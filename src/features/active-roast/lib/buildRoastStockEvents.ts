import type { BeanStockEventInsert } from '@entities/bean-stock-event';
import { buildBlendDeductions } from './buildBlendDeductions';

export type RoastStockBlendSource = {
    name: string;
    blend_components: { bean_id: string; ratio_pct: number }[];
};

export type BuildRoastStockEventsParams = {
    userId: string;
    deductionGrams: number;
    singleBeanId: string | null;
    blendId: string | null;
    referenceId: string;
    /** Required when blendId is set (caller loads blend). */
    blend?: RoastStockBlendSource | null;
};

/**
 * Builds bean_stock_events rows for a completed roast deduction.
 * Pure — no API / cache side effects.
 */
export const buildRoastStockEvents = ({
    userId,
    deductionGrams,
    singleBeanId,
    blendId,
    referenceId,
    blend = null,
}: BuildRoastStockEventsParams): BeanStockEventInsert[] => {
    if (deductionGrams <= 0) return [];

    if (!singleBeanId && !blendId) {
        throw new Error('No bean linked — stock cannot be deducted.');
    }

    const events: BeanStockEventInsert[] = [];

    if (singleBeanId && !blendId) {
        events.push({
            user_id: userId,
            bean_id: singleBeanId,
            delta_grams: -deductionGrams,
            event_type: 'roast',
            reference_id: referenceId,
        });
        return events;
    }

    if (blendId) {
        if (!blend?.blend_components?.length) {
            throw new Error('No bean linked — stock cannot be deducted.');
        }
        const deductions = buildBlendDeductions(deductionGrams, blend.blend_components);
        for (const d of deductions) {
            if (d.grams <= 0) continue;
            events.push({
                user_id: userId,
                bean_id: d.beanId,
                delta_grams: -d.grams,
                event_type: 'roast',
                reference_id: referenceId,
                note: `${blend.name} 블렌드 차감`,
            });
        }
    }

    if (!events.length) {
        throw new Error('No bean linked — stock cannot be deducted.');
    }

    return events;
};
