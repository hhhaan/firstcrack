import { useComputeInventoryAlerts } from '@entities/inventory-alert';
import { useEffect, useRef } from 'react';

/** Recompute persisted inventory alerts on app start and after auth. */
export const useInventoryAlertSync = (userId: string | undefined) => {
    const { mutate } = useComputeInventoryAlerts(userId ?? '');
    const ranFor = useRef<string | null>(null);

    useEffect(() => {
        if (!userId || ranFor.current === userId) return;
        ranFor.current = userId;
        mutate();
    }, [userId, mutate]);
};
