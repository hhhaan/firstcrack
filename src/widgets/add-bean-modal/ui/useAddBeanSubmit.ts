import { useCreateBean, useUpdateBean } from '@entities/bean/queries';
import { useCreateBeanInventoryLog } from '@entities/bean-inventory/queries';
import type { Bean } from '@shared/types/database.types';

interface FormData {
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
    formData: FormData;
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
    formData,
    selectedBeanId,
    restockAmount,
    existingBeans,
    initialData,
    onSuccess,
    onClose,
}: UseAddBeanSubmitParams) => {
    const createBean = useCreateBean(userId);
    const updateBean = useUpdateBean(userId);
    const createInventoryLog = useCreateBeanInventoryLog(userId);

    const isSubmitting = createBean.isPending || updateBean.isPending || createInventoryLog.isPending;

    const handleSubmit = async () => {
        if (isSubmitting) return;
        try {
            if (tab === 'new') {
                const stockGrams = parseInt(formData.stock) || 0;
                const newBean = await createBean.mutateAsync({
                    user_id: userId,
                    name: formData.name,
                    origin: formData.origin || null,
                    region: formData.region || null,
                    farm: formData.farm || null,
                    process: formData.process || null,
                    variety: formData.variety || null,
                    altitude_masl: formData.altitude ? parseInt(formData.altitude) : null,
                    stock_grams: 0,
                    capacity_grams: parseInt(formData.capacity) || 5000,
                    cost_per_kg: formData.costPerKg ? parseInt(formData.costPerKg) : null,
                    tasting_notes: formData.tastingNotes || null,
                    purchase_date: new Date().toISOString().split('T')[0],
                });
                if (stockGrams > 0) {
                    await createInventoryLog.mutateAsync({
                        user_id: userId,
                        bean_id: newBean.id,
                        change_grams: stockGrams,
                        type: 'purchase',
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
                    altitude_masl: formData.altitude ? parseInt(formData.altitude) : null,
                    stock_grams: parseInt(formData.stock) || 0,
                    capacity_grams: parseInt(formData.capacity) || 5000,
                    cost_per_kg: formData.costPerKg ? parseInt(formData.costPerKg) : null,
                    tasting_notes: formData.tastingNotes || null,
                });
                onSuccess?.(updated);
            } else if (tab === 'restock' && selectedBeanId && restockAmount) {
                const amount = parseInt(restockAmount);
                const currentBean = existingBeans.find((b) => b.id === selectedBeanId);
                await createInventoryLog.mutateAsync({
                    user_id: userId,
                    bean_id: selectedBeanId,
                    change_grams: amount,
                    type: 'purchase',
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
