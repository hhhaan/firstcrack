import { formatTemp, useBbpTimer, useRoastSettings } from '@features/active-roast';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Current roaster readings, pinned in the save dialog footer. */
export const RoastSummaryLiveStatus = () => {
    const { t } = useTranslation();
    const elapsed = useBbpTimer();
    const { temperatureUnit: unit, pollIntervalMs } = useRoastSettings();
    const bt = useRoastingStore((s) => s.liveData?.bt ?? null);
    const et = useRoastingStore((s) => s.liveData?.et ?? null);
    const connected = useRoastingStore((s) => s.sidecarConnected && !s.reconnecting);
    const observation = useRoastingStore((s) => s.displayObservation);
    const [expired, setExpired] = useState(true);
    const bbpActive = elapsed !== null;
    const maxAgeMs = Math.max(3000, pollIntervalMs * 3);
    useEffect(() => {
        if (!bbpActive || observation?.quality !== 'valid') {
            setExpired(true);
            return;
        }
        const remainingMs = Math.max(0, maxAgeMs - Math.max(0, Date.now() - observation.receivedAtMs));
        setExpired(remainingMs === 0);
        if (remainingMs === 0) return;
        const timeout = setTimeout(() => setExpired(true), remainingMs);
        return () => clearTimeout(timeout);
    }, [bbpActive, observation, maxAgeMs]);
    if (elapsed === null) return null;
    const fresh = connected && observation?.quality === 'valid' && !expired;

    const temps = `BT ${formatTemp(fresh ? bt : null, unit)} · ET ${formatTemp(fresh ? et : null, unit)}`;

    return (
        <section aria-label={t('activeRoast.summary.bbpLive')} data-testid="roast-summary-bbp">
            <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold uppercase text-muted">{t('activeRoast.sidebar.bbp')}</span>
                    <span className="font-inconsolata text-xl font-medium leading-tight text-primary">{elapsed}</span>
                </span>
                <span className="font-(--font-mono) text-[11px] tracking-[0.14px] text-muted">{temps}</span>
            </div>
            {!fresh && <p className="m-0 mt-1 text-[11px] text-muted">{t('activeRoast.summary.liveUnavailable')}</p>}
        </section>
    );
};
