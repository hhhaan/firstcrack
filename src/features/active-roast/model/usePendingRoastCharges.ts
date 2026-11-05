import { roastChargeApi } from '@entities/roast-charge';
import { roastChargeKeys } from '@shared/lib/query-keys';
import { retryUnlessClientRefusal } from '@shared/lib/sentry';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
    acknowledgeRoastCharge,
    listPendingRoastCharges,
    type PendingRoastCharge,
    pendingChargeEvent,
} from './pendingRoastCharges';

/** Mounted in the app's recovery widget, so leaving the roast screen loses no usage. */
export function usePendingRoastCharges(owner: string, ready: boolean) {
    const qc = useQueryClient();
    const { mutateAsync: record } = useMutation({
        mutationFn: (item: PendingRoastCharge) => roastChargeApi.record(item.owner, item.id, item.chargedAt),
        retry: retryUnlessClientRefusal,
        onSuccess: (_data, item) => acknowledgeRoastCharge(item),
        onSettled: (_data, _error, item) => qc.invalidateQueries({ queryKey: roastChargeKeys.all(item.owner) }),
    });
    useEffect(() => {
        if (!ready || !owner) return;
        let alive = true;
        let running = false;
        const drain = async () => {
            if (running) return;
            running = true;
            const attempted = new Set<string>();
            try {
                while (alive) {
                    const item = listPendingRoastCharges().find(
                        (entry) => entry.owner === owner && !attempted.has(entry.id),
                    );
                    if (!item) break;
                    attempted.add(item.id);
                    // Keep failed entries for reconnect/remount; retries never block physical Charge.
                    try {
                        await record(item);
                    } catch {
                        /* React Query reports the error. */
                    }
                }
            } finally {
                running = false;
            }
        };
        const retry = () => {
            void drain();
        };
        retry();
        window.addEventListener(pendingChargeEvent, retry);
        window.addEventListener('online', retry);
        window.addEventListener('storage', retry);
        return () => {
            alive = false;
            window.removeEventListener(pendingChargeEvent, retry);
            window.removeEventListener('online', retry);
            window.removeEventListener('storage', retry);
        };
    }, [owner, ready, record]);
}
