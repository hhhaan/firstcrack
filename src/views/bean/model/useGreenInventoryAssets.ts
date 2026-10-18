import {
    buildGreenInventoryAssets,
    type GreenInventoryAssetSummary,
    useBeanPurchaseCosts,
    useBeanStockSummaries,
} from '@entities/bean-stock-event';
import type { Bean } from '@shared/types/database.types';
import { useMemo } from 'react';

const EMPTY: GreenInventoryAssetSummary = {
    lines: [],
    byBeanId: {},
    totalAssetValue: 0,
    unevaluatedCount: 0,
    evaluatedCount: 0,
};

export const useGreenInventoryAssets = (userId: string, beans: Bean[]) => {
    const { data: stockSummaries = {}, isLoading: stockLoading } = useBeanStockSummaries(userId);
    const { data: purchaseCosts = [], isLoading: costsLoading, isError: costsError } = useBeanPurchaseCosts(userId);

    const summary = useMemo(() => {
        if (beans.length === 0 || costsError) return EMPTY;
        return buildGreenInventoryAssets(beans, stockSummaries, purchaseCosts);
    }, [beans, stockSummaries, purchaseCosts, costsError]);

    return {
        summary,
        stockSummaries,
        isLoading: stockLoading || costsLoading,
        isError: costsError,
    };
};
