import { formatTemp, useBbpTimer, useRoastSettings } from '@features/active-roast';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Current roaster readings, independent of the completed batch's snapshot and form. */
export const RoastSummaryLiveStatus = ({ ambientLine = null }: { ambientLine?: string | null }) => {
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
            className="rounded-[16px] border border-border-subtle bg-surface-warm-solid px-4 py-3 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px] dark:border-[#585d61]"
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
            {ambientLine ? (
                <p className="m-0 mt-2 font-(--font-mono) text-[11px] tracking-[0.14px] text-muted">{ambientLine}</p>
            ) : null}
        </section>
    );
};
