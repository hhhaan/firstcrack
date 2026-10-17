import type { StockSummary } from '@entities/bean-stock-event';
import { persistedId } from '@shared/lib/optimistic-id';
import type { Bean } from '@shared/types/database.types';
import { useEffect } from 'react';
import type { UseFormReset } from 'react-hook-form';
import { type BeanForm, EMPTY_BEAN_FORM } from '../lib/schema';
import type { BeanModalTab } from '../lib/types';

type Params = {
    open: boolean;
    initialTab: BeanModalTab;
    initialBeanId: string | null;
    initialData: Bean | null;
    stockSummaries: Record<string, StockSummary>;
    reset: UseFormReset<BeanForm>;
    setTab: (tab: BeanModalTab) => void;
    setSelectedBeanId: (id: string | null) => void;
    setRestockAmount: (v: string) => void;
    setRestockCost: (v: string) => void;
    setAdjustType: (v: 'adjustment' | 'write_off') => void;
    setAdjustSign: (v: '+' | '-') => void;
    setAdjustAmount: (v: string) => void;
    setAdjustNote: (v: string) => void;
    setShowAllBeans: (v: boolean) => void;
    setNameIsAuto: (v: boolean) => void;
};

export const useAddBeanFormReset = ({
    open,
    initialTab,
    initialBeanId,
    initialData,
    stockSummaries,
    reset,
    setTab,
    setSelectedBeanId,
    setRestockAmount,
    setRestockCost,
    setAdjustType,
    setAdjustSign,
    setAdjustAmount,
    setAdjustNote,
    setShowAllBeans,
    setNameIsAuto,
}: Params) => {
    useEffect(() => {
        if (!open) return;
        setTab(initialTab);
        setSelectedBeanId(persistedId(initialBeanId));
        setRestockAmount('');
        setRestockCost('');
        setAdjustType('adjustment');
        setAdjustSign('+');
        setAdjustAmount('');
        setAdjustNote('');
        setShowAllBeans(false);
        const hasData = initialData && (initialTab === 'edit' || initialTab === 'new');
        setNameIsAuto(!hasData);
        if (hasData) {
            reset({
                name: initialData.name ?? '',
                origin: initialData.origin ?? '',
                region: initialData.region ?? '',
                farm: initialData.farm ?? '',
                process: initialData.process ?? 'Washed',
                variety: initialData.variety ?? '',
                altitude: initialData.altitude_masl?.toString() ?? '',
                stock: initialData.id ? ((stockSummaries[initialData.id]?.effectiveGrams ?? 0) / 1000).toString() : '',
                capacity: initialData.capacity_grams ? (initialData.capacity_grams / 1000).toString() : '5',
                costPerKg: initialData.cost_per_kg?.toString() ?? '',
                tastingNotes: initialData.tasting_notes ?? '',
            });
        } else {
            reset(EMPTY_BEAN_FORM);
        }
    }, [
        open,
        initialTab,
        initialBeanId,
        initialData,
        stockSummaries,
        reset,
        setTab,
        setSelectedBeanId,
        setRestockAmount,
        setRestockCost,
        setAdjustType,
        setAdjustSign,
        setAdjustAmount,
        setAdjustNote,
        setShowAllBeans,
        setNameIsAuto,
    ]);
};
