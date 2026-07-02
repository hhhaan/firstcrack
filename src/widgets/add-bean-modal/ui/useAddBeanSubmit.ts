import { useCreateBean, useUpdateBean } from '@entities/bean/queries';
import { useInsertStockEvent } from '@entities/bean-stock-event';
import { logger } from '@shared/lib/logger';
import type { Bean } from '@shared/types/database.types';
import type { BeanForm } from '../lib/schema';
import type { BeanModalTab } from '../lib/types';

interface UseAddBeanSubmitParams {
    userId: string;
    tab: BeanModalTab;
    selectedBeanId: string | null;
    restockAmount: string;
    expectedAmount: string;
    expectedNote: string;
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
    expectedAmount,
    expectedNote,
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
                    await insertStockEvent.mutateAsync({
                        user_id: userId,
                        bean_id: newBean.id,
                        delta_grams: stockGrams,
                        event_type: 'purchase',
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
                await insertStockEvent.mutateAsync({
                    user_id: userId,
                    bean_id: selectedBeanId,
                    delta_grams: amount,
                    event_type: 'purchase',
                });
                onSuccess?.(currentBean ?? null);
            } else if (tab === 'expected' && selectedBeanId && expectedAmount) {
                const amount = Math.round(parseFloat(expectedAmount) * 1000);
                if (!Number.isFinite(amount) || amount <= 0) return;
                const currentBean = existingBeans.find((b) => b.id === selectedBeanId);
                await insertStockEvent.mutateAsync({
                    user_id: userId,
                    bean_id: selectedBeanId,
                    delta_grams: amount,
                    event_type: 'expected_inbound',
                    note: expectedNote || null,
                });
                onSuccess?.(currentBean ?? null);
            } else if (tab === 'adjust' && selectedBeanId && adjustAmount) {
                const rawGrams = Math.round(parseFloat(adjustAmount) * 1000);
                if (!Number.isFinite(rawGrams) || rawGrams <= 0) return;
                const delta =
                    adjustType === 'write_off' ? -Math.abs(rawGrams) : adjustSign === '+' ? rawGrams : -rawGrams;
                const currentBean = existingBeans.find((b) => b.id === selectedBeanId);
                await insertStockEvent.mutateAsync({
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
