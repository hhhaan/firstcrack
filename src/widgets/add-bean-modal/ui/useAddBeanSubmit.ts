import { useCreateBean, useUpdateBean } from '@entities/bean/queries';
import { useInsertStockEvent } from '@entities/bean-stock-event';
import type { Bean } from '@shared/types/database.types';

export interface FormData {
    name: string;
    origin: string;
    region: string;
    farm: string;
    process: string;
    variety: string;
    altitude: string;
    stock: string;
    capacity: string;
    costPerKg: string;
    tastingNotes: string;
}

interface UseAddBeanSubmitParams {
    userId: string;
    tab: 'new' | 'restock' | 'edit';
    selectedBeanId: string | null;
    restockAmount: string;
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
    existingBeans,
    initialData,
    onSuccess,
    onClose,
}: UseAddBeanSubmitParams) => {
    const createBean = useCreateBean(userId);
    const updateBean = useUpdateBean(userId);
    const insertStockEvent = useInsertStockEvent();

    const isSubmitting = createBean.isPending || updateBean.isPending || insertStockEvent.isPending;

    const handleSubmit = async (formData: FormData) => {
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
                    cost_per_kg: formData.costPerKg ? parseInt(formData.costPerKg, 10) : null,
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
                    cost_per_kg: formData.costPerKg ? parseInt(formData.costPerKg, 10) : null,
                    tasting_notes: formData.tastingNotes || null,
                });
                onSuccess?.(updated);
            } else if (tab === 'restock' && selectedBeanId && restockAmount) {
                const amount = Math.round(parseFloat(restockAmount) * 1000);
                const currentBean = existingBeans.find((b) => b.id === selectedBeanId);
                await insertStockEvent.mutateAsync({
                    user_id: userId,
                    bean_id: selectedBeanId,
                    delta_grams: amount,
                    event_type: 'purchase',
                });
                onSuccess?.(currentBean ?? null);
            }
            onClose();
        } catch (err) {
            console.error('AddBeanModal submit error:', err);
        }
    };

    return { handleSubmit, isSubmitting };
};
