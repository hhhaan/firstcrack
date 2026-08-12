/**
 * Optional test harness exposed only when VITE_E2E=1.
 * Seeds handoff / machine phase without hardware; End→Summary→Save still uses real UI.
 */
import { useRoastingStore } from '@features/active-roast/model/status';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';

export type FcE2eBridge = {
    startBatch: (handoff: PlanBatchHandoff) => void;
    clearBatch: () => void;
    /** Preheating → standby → charged so End Roast is available without a live machine. */
    forceChargedSession: () => void;
};

declare global {
    interface Window {
        __FC_E2E__?: FcE2eBridge;
    }
}

export function installE2eBridge() {
    if (import.meta.env.VITE_E2E !== '1' && import.meta.env.VITE_E2E !== 'true') return;
    window.__FC_E2E__ = {
        startBatch: (handoff) => useRoastSessionStore.getState().startBatch(handoff),
        clearBatch: () => useRoastSessionStore.getState().completeBatch(),
        forceChargedSession: () => {
            const store = useRoastingStore.getState();
            store.enterPreheating(['heater', 'fan', 'drum']);
            store.enterStandby();
            store.startCharge();
            store.updateLiveData({
                bt: 185,
                et: 210,
                ror: 8,
                ror_et: 5,
                heater: 70,
                fan: 40,
                drum: 55,
            });
        },
    };
}
