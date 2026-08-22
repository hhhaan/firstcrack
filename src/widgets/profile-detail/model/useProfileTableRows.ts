import type { RoastProfileWithSource } from '@entities/roast-profile';
import { formatTemp, useRoastSettings } from '@features/active-roast';
import { formatDuration } from '@shared/lib/format';
import { useTranslation } from 'react-i18next';

type ProfileTableRow = { label: string; getValue: (p: RoastProfileWithSource) => string };

export const useProfileTableRows = (
    durationLabelKey: 'profiles.detail.duration' | 'profiles.detail.totalDuration',
): ProfileTableRow[] => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    return [
        { label: t(durationLabelKey), getValue: (p) => formatDuration(p.duration_sec) },
        {
            label: t('profiles.detail.dropTemp'),
            getValue: (p) => formatTemp(p.drop_temp_celsius, unit),
        },
        {
            label: t('profiles.detail.chargeTemp'),
            getValue: (p) => formatTemp(p.charge_temp_celsius, unit),
        },
        { label: t('profiles.detail.devTime'), getValue: (p) => formatDuration(p.dev_time_sec) },
        { label: t('profiles.detail.devPct'), getValue: (p) => (p.dev_pct != null ? `${p.dev_pct.toFixed(1)}%` : '—') },
        { label: t('profiles.detail.targetLevel'), getValue: (p) => p.target_level ?? '—' },
    ];
};
