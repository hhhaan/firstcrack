import type { RoastProfileWithSource } from '@entities/roast-profile';
import { tempUnitLabel, toDisplayTemp, useRoastSettings } from '@features/active-roast';
import { formatDuration } from '@shared/lib/format';
import { useTranslation } from 'react-i18next';

type ProfileSummary = Pick<
    RoastProfileWithSource,
    | 'duration_sec'
    | 'charge_temp_celsius'
    | 'drop_temp_celsius'
    | 'dev_time_sec'
    | 'dev_pct'
    | 'target_level'
    | 'machine_name'
>;

export const ProfileRoastSummary = ({ profile }: { profile: ProfileSummary }) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;

    return (
        <div className="@container mb-6">
            <div className="grid gap-6 pb-6 @[556px]:grid-cols-[minmax(140px,0.78fr)_minmax(0,2fr)] @[556px]:gap-8">
                <dl className="min-w-0 self-center">
                    <div className="flex items-baseline justify-between gap-4 @[556px]:block">
                        <dt className="text-xs font-medium leading-5 text-muted">
                            {t('profiles.detail.totalDuration')}
                        </dt>
                        <dd className="font-inconsolata text-[40px] font-[450] leading-[1.1] tracking-[-0.03em] text-primary @[556px]:mt-3 @[556px]:text-5xl">
                            {formatDuration(profile.duration_sec)}
                        </dd>
                    </div>
                </dl>
                <dl className="grid min-w-0 grid-cols-2 font-inconsolata text-xl font-medium leading-7 tracking-[-0.03em] text-primary @[375px]:text-[22px] @[556px]:text-[23px]">
                    <div className="grid min-w-0 grid-cols-[minmax(0,23fr)_minmax(0,27fr)] items-baseline border-b border-border pb-3.5 pt-1">
                        <dt className="font-body text-xs font-medium leading-5 tracking-[0.14px] text-muted">
                            {t('profiles.detail.chargeTemp')}
                        </dt>
                        <dd className="whitespace-nowrap pe-3 @[556px]:pe-6">
                            {profile.charge_temp_celsius == null ? (
                                '—'
                            ) : (
                                <>
                                    {toDisplayTemp(profile.charge_temp_celsius, unit).toFixed(1)}
                                    <span className="ms-0.5 text-xs font-[450] text-secondary @[375px]:text-sm">
                                        {tempUnitLabel(unit)}
                                    </span>
                                </>
                            )}
                        </dd>
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,23fr)_minmax(0,27fr)] items-baseline border-b border-border pb-3.5 pt-1">
                        <dt className="font-body text-xs font-medium leading-5 tracking-[0.14px] text-muted">
                            {t('profiles.detail.dropTemp')}
                        </dt>
                        <dd className="whitespace-nowrap">
                            {profile.drop_temp_celsius == null ? (
                                '—'
                            ) : (
                                <>
                                    {toDisplayTemp(profile.drop_temp_celsius, unit).toFixed(1)}
                                    <span className="ms-0.5 text-xs font-[450] text-secondary @[375px]:text-sm">
                                        {tempUnitLabel(unit)}
                                    </span>
                                </>
                            )}
                        </dd>
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,23fr)_minmax(0,27fr)] items-baseline pb-1 pt-3.5">
                        <dt className="font-body text-xs font-medium leading-5 tracking-[0.14px] text-muted">
                            {t('profiles.detail.devTime')}
                        </dt>
                        <dd className="whitespace-nowrap pe-3 @[556px]:pe-6">{formatDuration(profile.dev_time_sec)}</dd>
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,23fr)_minmax(0,27fr)] items-baseline pb-1 pt-3.5">
                        <dt className="font-body text-xs font-medium leading-5 tracking-[0.14px] text-muted">
                            {t('profiles.detail.devPct')}
                        </dt>
                        <dd className="whitespace-nowrap">
                            {profile.dev_pct != null ? `${profile.dev_pct.toFixed(1)}%` : '—'}
                        </dd>
                    </div>
                </dl>
            </div>
            <dl className="grid gap-2 border-t border-border pt-4 text-xs leading-5 @[375px]:flex @[375px]:flex-wrap @[375px]:gap-x-8 @[375px]:gap-y-3">
                <div className="flex min-w-0 items-baseline justify-between gap-2 @[375px]:justify-start">
                    <dt className="shrink-0 text-muted">{t('profiles.detail.targetLevel')}</dt>
                    <dd className="min-w-0 break-words font-medium text-secondary">{profile.target_level ?? '—'}</dd>
                </div>
                <div className="flex min-w-0 items-baseline justify-between gap-2 @[375px]:justify-start">
                    <dt className="shrink-0 text-muted">{t('profiles.detail.machine')}</dt>
                    <dd className="min-w-0 break-words font-medium text-secondary">{profile.machine_name ?? '—'}</dd>
                </div>
            </dl>
        </div>
    );
};
