import type { SessionSummary } from '@entities/roast-profile';
import { formatTemp, useRoastSettings } from '@features/active-roast';
import { formatDuration } from '@shared/lib/format';
import { labelCls } from '@shared/ui/form-styles';
import { useTranslation } from 'react-i18next';

type ProfileCurveSummaryProps = {
    summary: SessionSummary;
};

const valueCls =
    'flex items-baseline justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-surface dark:bg-surface-elevated text-sm font-medium text-primary tabular-nums';
const unitCls = 'text-[11px] font-normal text-muted';

/** Read-only: charge/drop temp, drop time, FC, DT·DTR — all cut from the source session's marks. */
export const ProfileCurveSummary = ({ summary }: ProfileCurveSummaryProps) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const na = summary.fc_time_sec == null;

    return (
        <>
            <div className="grid grid-cols-2 gap-6">
                <div>
                    <div className={labelCls}>{t('newProfileModal.chargeTemp')}</div>
                    <div className={valueCls}>{formatTemp(summary.charge_temp_celsius, unit)}</div>
                </div>
                <div>
                    <div className={labelCls}>{t('newProfileModal.dropTemp')}</div>
                    <div className={valueCls}>{formatTemp(summary.drop_temp_celsius, unit)}</div>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
                <div>
                    <div className={labelCls}>{t('newProfileModal.dropTime')}</div>
                    <div className={valueCls}>{formatDuration(summary.duration_sec)}</div>
                </div>
                <div>
                    <div className={labelCls}>{t('newProfileModal.fcTime')}</div>
                    <div className={`${valueCls} ${na ? 'text-muted' : ''}`}>{formatDuration(summary.fc_time_sec)}</div>
                </div>
                <div>
                    <div className={labelCls}>
                        {t('newProfileModal.devTime')} · {t('newProfileModal.devPct')}
                    </div>
                    <div className={`${valueCls} ${na ? 'text-muted' : ''}`}>
                        <span>{formatDuration(summary.dev_time_sec)}</span>
                        <span className={unitCls}>{summary.dev_pct != null ? `${summary.dev_pct}%` : '—'}</span>
                    </div>
                </div>
            </div>
            <p className="-mt-3 text-[12px] text-muted">{t('newProfileModal.computedHint')}</p>
        </>
    );
};
