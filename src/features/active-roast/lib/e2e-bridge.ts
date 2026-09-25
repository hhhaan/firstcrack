/**
 * Optional test harness exposed only when VITE_E2E=1.
 * Seeds handoff / machine phase without hardware; End→Summary→Save still uses real UI.
 */
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';

export type FcE2eBridge = {
    startBatch: (handoff: PlanBatchHandoff) => void;
    clearBatch: () => void;
    /** Preheating → standby → charged so End Roast is available without a live machine. */
    forceChargedSession: () => void;
    /** Live BBP session. Chart-only preheat must not survive a document reload. */
    bbpLive: () => {
        active: boolean;
        recording: boolean;
        startMs: number;
        count: number;
        firstT: number | null;
        lastT: number | null;
    };
    /** New React tree, same document. Chart-only preheat must not keep the previous curve. */
    remountRoast?: () => void;
    /** Saved BBP length after Charge finalize. Null until finalize runs. */
    readFinalizedBbp: () => { seconds: number | null; span: number };
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
        bbpLive: () => {
            const s = useBbpStore.getState();
            const first = s.points[0];
            const last = s.points[s.points.length - 1];
            return {
                active: s.active,
                recording: s.recording,
                startMs: s.startMs,
                count: s.points.length,
                firstT: first ? first.t : null,
                lastT: last ? last.t : null,
            };
        },
        readFinalizedBbp: () => {
            const { finalized, finalizedPoints } = useBbpStore.getState();
            const span =
                finalizedPoints.length >= 2
                    ? Math.round(finalizedPoints[finalizedPoints.length - 1].t - finalizedPoints[0].t)
                    : 0;
            return { seconds: finalized?.seconds ?? null, span };
        },
    };
}
