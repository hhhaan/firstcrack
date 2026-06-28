import type { StockSummary } from '@entities/bean-stock-event';
import { beanStockEventApi } from '@entities/bean-stock-event';
import type { BlendWithComponents } from '@entities/blend';
import { isRecurringHorizonStockShort, recurringHorizonGreenNeededGrams } from '@shared/lib/batch-stock';
import type { RecurrenceInterval } from '@shared/lib/rrule';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BatchType } from '../lib/types';

type Params = {
    batchType: BatchType;
    beanId: string;
    blendId: string | null;
    selectedBlend: BlendWithComponents | undefined;
    selectedBeanId: string | null;
    stockSummary: StockSummary | undefined;
    plannedGrams: number;
    recurringInterval: RecurrenceInterval | null;
    date: Date | undefined;
    batchSizeNum: number;
    batchCount: number;
};

export const useBatchStockChecks = ({
    batchType,
    beanId,
    selectedBlend,
    selectedBeanId,
    stockSummary,
    plannedGrams,
    recurringInterval,
    date,
    batchSizeNum,
    batchCount,
}: Params) => {
    const { t } = useTranslation();
    const isBlendType = batchType === 'Pre-roast Blend' || batchType === 'Post-roast Blend';

    const blendComponents = useMemo(() => {
        if (!isBlendType || !selectedBlend) return [];
        return selectedBlend.blend_components ?? [];
    }, [isBlendType, selectedBlend]);

    const blendStockQueries = useQueries({
        queries: blendComponents.map((comp) => ({
            queryKey: ['bean-stock-summary', comp.bean_id],
            queryFn: () => beanStockEventApi.getStockSummary(comp.bean_id),
            enabled: !!comp.bean_id,
        })),
    });

    const blendShortages = useMemo(() => {
        if (blendComponents.length === 0 || plannedGrams === 0) return [];
        return blendComponents.map((comp, i) => {
            const neededGrams = Math.round((Number(comp.ratio_pct) / 100) * plannedGrams);
            const summary = blendStockQueries[i]?.data;
            return {
                beanName: (comp as { beans?: { name: string } }).beans?.name ?? t('addBatchModal.unknown'),
                ratioPct: comp.ratio_pct,
                neededGrams,
                effectiveGrams: summary?.effectiveGrams ?? 0,
                isShort: summary ? summary.effectiveGrams < neededGrams : false,
            };
        });
    }, [blendComponents, plannedGrams, blendStockQueries, t]);

    const effectiveStockKg = (stockSummary?.effectiveGrams ?? 0) / 1000;
    const greenNeeded = plannedGrams > 0 ? plannedGrams / 1000 : 0;
    const stockSufficient = greenNeeded === 0 || effectiveStockKg >= greenNeeded;
    const stockPct = greenNeeded > 0 ? Math.min(100, (effectiveStockKg / greenNeeded) * 100) : 100;
    const isShortage = !!stockSummary && plannedGrams > 0 && stockSummary.effectiveGrams < plannedGrams;

    const recurringHorizonShort = useMemo(() => {
        if (!recurringInterval || batchType !== 'Single Origin' || !beanId || !date) return null;
        const neededGrams = recurringHorizonGreenNeededGrams(recurringInterval, date, batchSizeNum, batchCount);
        if (neededGrams <= 0) return null;
        const effectiveGrams = stockSummary?.effectiveGrams ?? 0;
        if (!isRecurringHorizonStockShort(effectiveGrams, recurringInterval, date, batchSizeNum, batchCount)) {
            return null;
        }
        return {
            neededKg: (neededGrams / 1000).toFixed(1),
            availableKg: (effectiveGrams / 1000).toFixed(1),
        };
    }, [recurringInterval, batchType, beanId, date, batchSizeNum, batchCount, stockSummary?.effectiveGrams]);

    return {
        isBlendType,
        blendShortages,
        effectiveStockKg,
        greenNeeded,
        stockSufficient,
        stockPct,
        isShortage,
        recurringHorizonShort,
        selectedBeanId,
    };
};

export type BatchStockChecks = ReturnType<typeof useBatchStockChecks>;
