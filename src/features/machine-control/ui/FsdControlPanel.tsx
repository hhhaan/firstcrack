import { useTranslation } from 'react-i18next';
import type { useFsdControl } from '../model/useFsdControl';

export const FsdControlPanel = ({
    fsd,
    unit,
    heaterUnit,
    commandsLocked,
}: {
    fsd: ReturnType<typeof useFsdControl>;
    unit: 'C' | 'F';
    heaterUnit: string;
    commandsLocked: boolean;
}) => {
    const { t } = useTranslation();
    if (!fsd.available) return null;
    const curve = fsd.curve;
    const temperature = (value: number | null | undefined, difference = false) =>
        value == null ? '—' : `${(unit === 'F' ? (value * 9) / 5 + (difference ? 0 : 32) : value).toFixed(1)}°${unit}`;
    const reason = fsd.failure ?? fsd.reason;
    return (
        <section className="flex flex-col gap-2 border-t border-border-subtle pt-2" aria-label={t('fsd.title')}>
            <div className="flex justify-between gap-1 text-[11px] font-semibold">
                <span>{t('fsd.title')}</span>
                <span role="status">
                    {curve
                        ? t(`fsd.states.${curve.phase === 'active' ? curve.runner_state : curve.phase}`)
                        : t('fsd.states.off')}
                </span>
            </div>
            <p className="text-[10px] text-muted">{t('fsd.description')}</p>
            {curve && (
                <dl className="grid grid-cols-2 gap-1 text-[11px]">
                    <dt>{t('fsd.target')}</dt>
                    <dd className="text-right font-mono">{temperature(curve.target_bt_c)}</dd>
                    <dt>{t('fsd.pv')}</dt>
                    <dd className="text-right font-mono">{temperature(curve.control_pv_c)}</dd>
                    <dt>{t('fsd.error')}</dt>
                    <dd className="text-right font-mono">{temperature(curve.error_c, true)}</dd>
                    <dt>{t('fsd.gas')}</dt>
                    <dd className="text-right font-mono">
                        {curve.last_applied_heat_set == null
                            ? '—'
                            : `${curve.last_applied_heat_set.toFixed(1)} ${heaterUnit}`}
                    </dd>
                </dl>
            )}
            {curve?.reason && (
                <p className="text-[11px] leading-snug text-secondary">{t(`fsd.reasons.${curve.reason}`)}</p>
            )}
            {reason && (
                <p role={fsd.failure ? 'alert' : undefined} className="text-[11px] leading-snug text-secondary">
                    {t(`fsd.reasons.${reason}`, { defaultValue: reason })}
                </p>
            )}
            {fsd.failureDetail && (
                <p role="alert" className="text-[11px] leading-snug text-secondary">
                    {fsd.failureDetail}
                </p>
            )}
            {fsd.receiptStatus?.unavailable && (
                <p role="alert" className="text-[11px] text-secondary">
                    {t('history.receipts.unavailable')}
                </p>
            )}
            {Boolean(fsd.receiptStatus?.gaps) && (
                <p role="alert" className="text-[11px] text-secondary">
                    {t('fsd.receiptGap')}
                </p>
            )}
            {Boolean(fsd.receiptStatus?.unresolved) && (
                <p role="status" className="text-[11px] text-secondary">
                    {t('history.receipts.unresolved', { count: fsd.receiptStatus?.unresolved })}
                </p>
            )}
            {fsd.active || fsd.failure === 'stop_failed' || fsd.failure === 'stop_unconfirmed' ? (
                <button
                    type="button"
                    disabled={fsd.busy}
                    onClick={() => void fsd.stop()}
                    className="rounded border border-border-subtle px-2 py-1.5 text-[11px] disabled:opacity-50"
                >
                    {t('fsd.takeManual')}
                </button>
            ) : (
                <button
                    type="button"
                    disabled={Boolean(fsd.reason) || fsd.busy || commandsLocked}
                    onClick={() => void fsd.start()}
                    className="rounded border border-border-subtle px-2 py-1.5 text-[11px] disabled:opacity-50"
                >
                    {t('fsd.start')}
                </button>
            )}
        </section>
    );
};
