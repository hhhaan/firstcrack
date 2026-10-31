import { useCreateBean, useUpdateBean } from '@entities/bean/queries';
import { useInsertStockEvent } from '@entities/bean-stock-event';
import { i18n } from '@shared/i18n';
import { createActionOpIdSession } from '@shared/lib/action-op-id';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import type { Bean } from '@shared/types/database.types';
import { useRef } from 'react';
import type { BeanForm } from '../lib/schema';
import type { BeanModalTab } from '../lib/types';

interface UseAddBeanSubmitParams {
    userId: string;
    tab: BeanModalTab;
    selectedBeanId: string | null;
    restockAmount: string;
    restockCost: string;
    adjustType: 'adjustment' | 'write_off';
    adjustSign: '+' | '-';
    adjustAmount: string;
    adjustNote: string;
    existingBeans: Bean[];
    initialData: Bean | null;
    onSuccess?: (bean: Bean | null) => void;
    onClose: () => void;
}

export const useAddBeanSubmit = ({
    userId,
    tab,
    selectedBeanId,
    restockAmount,
    restockCost,
    adjustType,
    adjustSign,
    adjustAmount,
    adjustNote,
    existingBeans,
    initialData,
    onSuccess,
    onClose,
}: UseAddBeanSubmitParams) => {
    const createBean = useCreateBean(userId);
    const updateBean = useUpdateBean(userId);
    const insertStockEvent = useInsertStockEvent();
    const stockOp = useRef(createActionOpIdSession());

    const insertStock = async (event: Parameters<typeof insertStockEvent.mutateAsync>[0]) => {
        const { reference_id: _ignored, ...rest } = event;
        const result = await insertStockEvent.mutateAsync({
            ...rest,
            reference_id: stockOp.current.getOrCreate(),
        });
        stockOp.current.markSucceeded();
        if (result.alertFailed) {
            useToastStore.getState().show(i18n.t('inventory.alertRefreshFailed'), 'info');
        }
    };

    const isSubmitting = createBean.isPending || updateBean.isPending || insertStockEvent.isPending;

    const handleSubmit = async (formData: BeanForm) => {
        if (isSubmitting) return;
        try {
            if (tab === 'new') {
                const stockGrams = Math.round(parseFloat(formData.stock) * 1000) || 0;
                const newBean = await createBean.mutateAsync({
                    user_id: userId,
                    name: formData.name,
                    origin: formData.origin || null,
                    region: formData.region || null,
                    farm: formData.farm || null,
                    process: formData.process || null,
                    variety: formData.variety || null,
                    altitude_masl: formData.altitude ? parseInt(formData.altitude, 10) : null,
                    capacity_grams: Math.round(parseFloat(formData.capacity) * 1000) || 5000,
                    cost_per_kg: formData.costPerKg ? parseFloat(formData.costPerKg) : null,
                    tasting_notes: formData.tastingNotes || null,
                    purchase_date: new Date().toISOString().split('T')[0],
                });
                if (stockGrams > 0) {
                    await insertStock({
                        user_id: userId,
                        bean_id: newBean.id,
                        delta_grams: stockGrams,
                        event_type: 'purchase',
                        cost_per_kg: newBean.cost_per_kg,
                    });
                }
                onSuccess?.(newBean);
            } else if (tab === 'edit' && initialData) {
                const updated = await updateBean.mutateAsync({
                    id: initialData.id,
                    name: formData.name,
                    origin: formData.origin || null,
                    region: formData.region || null,
                    farm: formData.farm || null,
                    process: formData.process || null,
                    variety: formData.variety || null,
                    altitude_masl: formData.altitude ? parseInt(formData.altitude, 10) : null,
                    capacity_grams: Math.round(parseFloat(formData.capacity) * 1000) || 5000,
                    cost_per_kg: formData.costPerKg ? parseFloat(formData.costPerKg) : null,
                    tasting_notes: formData.tastingNotes || null,
                });
                onSuccess?.(updated);
            } else if (tab === 'restock' && selectedBeanId && restockAmount) {
                const amount = Math.round(parseFloat(restockAmount) * 1000);
                if (!Number.isFinite(amount) || amount <= 0) return;
                const currentBean = existingBeans.find((b) => b.id === selectedBeanId);
                const restockCostValue = restockCost ? parseFloat(restockCost) : NaN;
                await insertStock({
                    user_id: userId,
                    bean_id: selectedBeanId,
                    delta_grams: amount,
                    event_type: 'purchase',
                    cost_per_kg: Number.isFinite(restockCostValue) ? restockCostValue : null,
                });
                if (currentBean) {
                    const newCost = restockCostValue;
                    if (Number.isFinite(newCost) && newCost !== currentBean.cost_per_kg) {
                        // beanApi.update does a partial (PATCH) update — only changed fields needed.
                        await updateBean.mutateAsync({
                            id: selectedBeanId,
                            cost_per_kg: newCost,
                        });
                    }
                }
                onSuccess?.(currentBean ?? null);
            } else if (tab === 'adjust' && selectedBeanId && adjustAmount) {
                const rawGrams = Math.round(parseFloat(adjustAmount) * 1000);
                if (!Number.isFinite(rawGrams) || rawGrams <= 0) return;
                const delta =
                    adjustType === 'write_off' ? -Math.abs(rawGrams) : adjustSign === '+' ? rawGrams : -rawGrams;
                const currentBean = existingBeans.find((b) => b.id === selectedBeanId);
                await insertStock({
                    user_id: userId,
                    bean_id: selectedBeanId,
                    delta_grams: delta,
                    event_type: adjustType,
                    note: adjustNote || null,
                });
                onSuccess?.(currentBean ?? null);
            }
            onClose();
        } catch (err) {
            logger.capture(err, { context: 'add bean modal' });
        }
    };

    return { handleSubmit, isSubmitting };
};
