import type { StockSummary } from '@entities/bean-stock-event';
import { persistedId } from '@shared/lib/optimistic-id';
import type { Bean } from '@shared/types/database.types';
import { useEffect, useRef } from 'react';
import type { UseFormGetValues, UseFormReset, UseFormSetValue } from 'react-hook-form';
import { type BeanForm, EMPTY_BEAN_FORM } from '../lib/schema';
import type { BeanModalTab } from '../lib/types';

type Params = {
    open: boolean;
    initialTab: BeanModalTab;
    initialBeanId: string | null;
    initialData: Bean | null;
    stockSummaries: Record<string, StockSummary>;
    reset: UseFormReset<BeanForm>;
    getValues: UseFormGetValues<BeanForm>;
    setValue: UseFormSetValue<BeanForm>;
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
    getValues,
    setValue,
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
    const initialized = useRef<{
        tab: BeanModalTab;
        beanId: string | null;
        source: Bean | null;
        stock: string;
    } | null>(null);
    useEffect(() => {
        if (!open) {
            initialized.current = null;
            return;
        }
        const stock = initialData?.id ? ((stockSummaries[initialData.id]?.effectiveGrams ?? 0) / 1000).toString() : '';
        const previous = initialized.current;
        if (previous?.tab === initialTab && previous.beanId === initialBeanId && previous.source === initialData) {
            if (initialData && getValues('stock') === previous.stock) {
                setValue('stock', stock);
                previous.stock = stock;
            }
            return;
        }
        initialized.current = { tab: initialTab, beanId: initialBeanId, source: initialData, stock };
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
                stock,
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
        getValues,
        setValue,
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
