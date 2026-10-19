import { formatTemp, useBbpTimer, useRoastSettings } from '@features/active-roast';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Current roaster readings, independent of the completed batch's snapshot and form. */
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

    return (
        <section
            aria-label={t('activeRoast.summary.bbpLive')}
            data-testid="roast-summary-bbp"
            className="mb-3.5 rounded-lg border border-border-subtle bg-surface-warm px-3 py-2"
        >
            <h3 className="m-0 mb-1 text-[11px] font-medium text-muted">{t('activeRoast.summary.bbpLive')}</h3>
            <dl className="m-0 grid grid-cols-3 gap-2 text-[13px]">
                {[
                    { label: 'BBP', value: elapsed },
                    { label: 'BT', value: formatTemp(fresh ? bt : null, unit) },
                    { label: 'ET', value: formatTemp(fresh ? et : null, unit) },
                ].map(({ label, value }) => (
                    <div key={label}>
                        <dt className="text-[10px] text-muted">{label}</dt>
                        <dd className="m-0 font-mono text-primary">{value}</dd>
                    </div>
                ))}
            </dl>
            {!fresh && <p className="m-0 mt-1 text-[11px] text-muted">{t('activeRoast.summary.liveUnavailable')}</p>}
        </section>
    );
};
