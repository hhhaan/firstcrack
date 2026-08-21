import type { RoastProfileWithSource } from '@entities/roast-profile';
import { resolveSourceSession, useRoastProfileCurves } from '@entities/roast-profile';
import { formatTemp, useRoastSettings } from '@features/active-roast';
import { generateProfileCurve } from '@shared/data/roast-profiles';
import { formatDuration } from '@shared/lib/format';
import type { SeriesData } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { COMPARE_COLORS, ProfileCurveChart } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { useProfileTableRows } from '@widgets/profile-detail/model/useProfileTableRows';
import { AlertCircle, GitCompare, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DefaultBadge = ({
    id,
    defaultId,
    onSetDefault,
}: {
    id: string;
    defaultId: string | null;
    onSetDefault: (id: string) => void;
}) => {
    const { t } = useTranslation();
    if (defaultId === id) {
        return (
            <div className="flex items-center gap-1 rounded-full bg-[#EFEFF0] px-2.5 py-1 dark:bg-surface-elevated">
                <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="text-[#FFB900]"
                    strokeWidth={2}
                >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span className="text-[11px] font-medium tracking-[0.3px]">{t('profiles.detail.default')}</span>
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={() => onSetDefault(id)}
            title={t('profiles.detail.setDefault')}
            className="flex cursor-pointer items-center gap-1 rounded-full border-none bg-surface px-2.5 py-1 transition-colors hover:bg-palette-teal/12 dark:bg-surface-elevated"
        >
            <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                color="#FFB900"
                stroke="currentColor"
                strokeWidth={2}
            >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span className="text-[11px] font-medium tracking-[0.3px] text-muted">
                {t('profiles.detail.setDefault')}
            </span>
        </button>
    );
};

interface ProfileCompareProps {
    compareIds: string[];
    compareProfiles: RoastProfileWithSource[];
    defaultId: string | null;
    primaryId: string;
    chartKey: string;
    onSetDefault: (id: string) => void;
}

export const ProfileCompare = ({
    compareIds,
    compareProfiles,
    defaultId,
    primaryId,
    chartKey,
    onSetDefault,
}: ProfileCompareProps) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const TABLE_ROWS = useProfileTableRows('profiles.detail.duration');
    const compareQueries = useRoastProfileCurves(
        compareProfiles.map((p) => resolveSourceSession(p.source_session)?.tsv_path),
        compareProfiles.map((p) => p.id),
    );

    const chartSeries: SeriesData[] = compareProfiles.map((p, i) => {
        const real = compareQueries[i]?.data ?? [];
        const curve =
            real.length > 0
                ? real.map((pt) => ({ t: pt.t, bt: pt.bt }))
                : generateProfileCurve(p.drop_temp_celsius ?? 200, p.duration_sec ?? 720);
        return { curve, color: COMPARE_COLORS[i], label: p.name };
    });

    if (compareIds.length === 0) {
        return (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg bg-main-bg px-8 py-7 dark:border dark:border-[#585d61]">
                <GitCompare size={32} strokeWidth={1.5} color="var(--color-muted)" />
                <p className="text-sm tracking-[0.14px] text-muted">{t('profiles.detail.selectToCompare')}</p>
            </div>
        );
    }

    return (
        <div className="min-w-0 rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
            <div className="flex items-center justify-between border-b border-black/5 px-6 py-4 dark:border-[#585d61]">
                <div className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 dark:bg-surface-elevated">
                    <GitCompare size={11} strokeWidth={2} color="var(--color-secondary)" />
                    <span className="text-[11px] font-medium tracking-[0.3px] text-secondary">
                        {t('profiles.detail.compareMode', { count: compareIds.length })}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <DefaultBadge id={primaryId} defaultId={defaultId} onSetDefault={onSetDefault} />
                    <button
                        type="button"
                        disabled
                        title={t('profiles.detail.editDisabledMulti')}
                        className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-lg border-none bg-surface opacity-35 dark:bg-surface-elevated/50"
                    >
                        <Pencil size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                    </button>
                </div>
            </div>

            <div className="flex min-h-0">
                <div className="min-w-0 flex-1 px-6 py-5">
                    <div className="mb-2 text-[12px] font-medium tracking-[0.14px] text-primary">
                        {t('profiles.detail.curveOverlay')}
                    </div>
                    <div className="rounded-lg bg-surface px-3 pt-3 pb-2 dark:bg-surface-elevated">
                        <ProfileCurveChart key={chartKey} series={chartSeries} />
                    </div>

                    <div className="mt-5 overflow-hidden rounded-lg border border-black/5 dark:border-[#585d61]">
                        <div
                            className="grid"
                            style={{
                                gridTemplateColumns: `120px repeat(${compareProfiles.length}, minmax(0, 1fr))`,
                            }}
                        >
                            <div className="border-b border-black/5 px-3 py-2.5 dark:border-[#585d61]" />
                            {compareProfiles.map((p, i) => (
                                <div
                                    key={p.id}
                                    className="border-b border-l border-black/5 px-3 py-2.5 dark:border-[#585d61]"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <div
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ backgroundColor: COMPARE_COLORS[i] }}
                                        />
                                        <span className="truncate text-[11px] font-semibold tracking-[0.14px] text-primary">
                                            {p.name}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {TABLE_ROWS.flatMap(({ label, getValue }, rowIdx) => [
                                <div
                                    key={`lbl-${label}`}
                                    className={`px-3 py-2.5 ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                                >
                                    <span className="text-[11px] font-medium uppercase tracking-[0.4px] text-muted">
                                        {label}
                                    </span>
                                </div>,
                                ...compareProfiles.map((p) => (
                                    <div
                                        key={`${p.id}-${label}`}
                                        className={`border-l border-black/5 px-3 py-2.5 dark:border-[#585d61] ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                                    >
                                        <span className="font-mono text-[12px] font-semibold tracking-[-0.2px] text-primary tabular-nums">
                                            {getValue(p)}
                                        </span>
                                    </div>
                                )),
                            ])}
                        </div>
                    </div>
                </div>

                <aside className="w-[220px] shrink-0 border-l border-black/5 bg-[rgba(248,246,244,0.55)] px-3 py-4 dark:border-[#585d61] dark:bg-[rgba(24,29,33,0.65)]">
                    <div className="mb-3 px-1 font-mono text-[13px] font-medium tracking-[0.14px] text-muted tabular-nums">
                        {t('profiles.detail.compareMode', { count: compareProfiles.length })}
                    </div>
                    <div className="space-y-2">
                        {compareProfiles.map((p, i) => {
                            const hasReal = (compareQueries[i]?.data?.length ?? 0) > 0;
                            const color = COMPARE_COLORS[i];
                            return (
                                <div
                                    key={p.id}
                                    className="rounded-lg border border-black/6 bg-surface px-3 py-2.5 dark:border-[#585d61] dark:bg-surface-elevated"
                                >
                                    <div className="mb-2 flex items-center gap-2">
                                        <span
                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: color }}
                                        />
                                        <span className="truncate text-[12px] font-semibold tracking-[0.14px] text-primary">
                                            {p.name}
                                        </span>
                                        {!hasReal && (
                                            <span
                                                title={t('profiles.detail.noRecordedData')}
                                                className="ml-auto flex items-center"
                                            >
                                                <AlertCircle size={11} strokeWidth={2} className="text-amber-500" />
                                            </span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                        <div className="flex items-baseline justify-between gap-1">
                                            <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                                {t('profiles.detail.dropTemp')}
                                            </span>
                                            <span
                                                className="font-mono text-[12px] font-semibold tabular-nums"
                                                style={{ color }}
                                            >
                                                {formatTemp(p.drop_temp_celsius, unit)}
                                            </span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-1">
                                            <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                                {t('profiles.detail.duration')}
                                            </span>
                                            <span className="font-mono text-[11px] tabular-nums text-secondary">
                                                {formatDuration(p.duration_sec)}
                                            </span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-1">
                                            <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                                {t('profiles.detail.devPct')}
                                            </span>
                                            <span className="font-mono text-[11px] tabular-nums text-secondary">
                                                {p.dev_pct != null ? `${p.dev_pct.toFixed(1)}%` : '—'}
                                            </span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-1">
                                            <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                                {t('profiles.detail.chargeTemp')}
                                            </span>
                                            <span className="font-mono text-[11px] tabular-nums text-secondary">
                                                {formatTemp(p.charge_temp_celsius, unit)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </aside>
            </div>
        </div>
    );
};
