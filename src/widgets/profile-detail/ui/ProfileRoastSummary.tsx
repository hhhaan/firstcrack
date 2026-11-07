import type { RoastProfileWithSource } from '@entities/roast-profile';
import { formatTemp, useRoastSettings } from '@features/active-roast';
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
            <dl className="grid gap-4 py-1 @[560px]:grid-cols-[1fr_1.7fr_1.3fr] @[560px]:gap-6">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @[560px]:block">
                    <dt className="text-xs font-medium leading-5 text-muted @[560px]:min-h-10">
                        {t('profiles.detail.totalDuration')}
                    </dt>
                    <dd className="font-inconsolata text-[32px] font-medium leading-9 tracking-[-0.03em] text-primary @[560px]:mt-2">
                        {formatDuration(profile.duration_sec)}
                    </dd>
                </div>
                <div className="flex min-w-0 items-baseline justify-between gap-4 @[560px]:block">
                    <dt className="text-xs font-medium leading-5 text-muted @[560px]:min-h-10">
                        {t('profiles.detail.chargeTemp')}
                        <span className="mx-1.5">→</span>
                        {t('profiles.detail.dropTemp')}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-2 font-inconsolata text-2xl font-medium leading-9 tracking-[-0.03em] text-primary @[560px]:mt-2 @[560px]:text-[28px]">
                        <span>{formatTemp(profile.charge_temp_celsius, unit)}</span>
                        <span className="font-body text-sm text-muted">→</span>
                        <span>{formatTemp(profile.drop_temp_celsius, unit)}</span>
                    </dd>
                </div>
                <div className="flex min-w-0 items-baseline justify-between gap-4 @[560px]:block">
                    <dt className="text-xs font-medium leading-5 text-muted @[560px]:min-h-10">
                        {t('profiles.detail.devTime')}
                        <span className="mx-1.5">/</span>
                        {t('profiles.detail.devPct')}
                    </dt>
                    <dd className="flex shrink-0 items-baseline gap-2 font-inconsolata leading-9 tracking-[-0.03em] @[560px]:mt-2">
                        <span className="text-2xl font-medium text-primary @[560px]:text-[28px]">
                            {formatDuration(profile.dev_time_sec)}
                        </span>
                        <span className="text-sm text-muted">/</span>
                        <span className="text-lg text-secondary">
                            {profile.dev_pct != null ? `${profile.dev_pct.toFixed(1)}%` : '—'}
                        </span>
                    </dd>
                </div>
            </dl>
            <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4 text-xs leading-5">
                <div className="flex min-w-0 items-baseline gap-2">
                    <dt className="shrink-0 text-muted">{t('profiles.detail.targetLevel')}</dt>
                    <dd className="min-w-0 break-words font-medium text-secondary">{profile.target_level ?? '—'}</dd>
                </div>
                <div className="flex min-w-0 items-baseline gap-2">
                    <dt className="shrink-0 text-muted">{t('profiles.detail.machine')}</dt>
                    <dd className="min-w-0 break-words font-medium text-secondary">{profile.machine_name ?? '—'}</dd>
                </div>
            </dl>
        </div>
    );
};
