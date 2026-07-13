import type { RoastProfileWithSource } from '@entities/roast-profile';
import { resolveSourceSession, useRoastProfileCurves } from '@entities/roast-profile';
import { generateProfileCurve } from '@shared/data/roast-profiles';
import type { SeriesData } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { COMPARE_COLORS, ProfileCurveChart } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { AlertCircle, GitCompare, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const fmtDuration = (sec: number | null): string => {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

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
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EFEFF0] dark:bg-surface-elevated ">
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
            className="flex items-center gap-1 px-2.5 py-1 rounded-full border-none bg-surface dark:bg-surface-elevated cursor-pointer  hover:bg-palette-teal/12 transition-colors"
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
            <span className="text-[11px] font-medium text-muted tracking-[0.3px]">
                {t('profiles.detail.setDefault')}
            </span>
        </button>
    );
};

const useTableRows = (): { label: string; getValue: (p: RoastProfileWithSource) => string }[] => {
    const { t } = useTranslation();
    return [
        { label: t('profiles.detail.duration'), getValue: (p) => fmtDuration(p.duration_sec) },
        {
            label: t('profiles.detail.dropTemp'),
            getValue: (p) => (p.drop_temp_celsius != null ? `${p.drop_temp_celsius}°C` : '—'),
        },
        {
            label: t('profiles.detail.chargeTemp'),
            getValue: (p) => (p.charge_temp_celsius != null ? `${p.charge_temp_celsius}°C` : '—'),
        },
        { label: t('profiles.detail.devTime'), getValue: (p) => fmtDuration(p.dev_time_sec) },
        { label: t('profiles.detail.devPct'), getValue: (p) => (p.dev_pct != null ? `${p.dev_pct.toFixed(1)}%` : '—') },
        { label: t('profiles.detail.targetLevel'), getValue: (p) => p.target_level ?? '—' },
    ];
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
    const TABLE_ROWS = useTableRows();
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
            <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-lg px-8 py-7 flex flex-col items-center justify-center gap-3 min-h-[320px]">
                <GitCompare size={32} strokeWidth={1.5} color="var(--color-muted)" />
                <p className="text-sm text-muted tracking-[0.14px]">{t('profiles.detail.selectToCompare')}</p>
            </div>
        );
    }

    return (
        <div className="bg-main-bg rounded-lg px-8 py-7 dark:border dark:border-[#585d61]">
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface dark:bg-surface-elevated ">
                    <GitCompare size={11} strokeWidth={2} color="var(--color-secondary)" />
                    <span className="text-[11px] font-medium text-secondary tracking-[0.3px]">
                        {t('profiles.detail.compareMode', { count: compareIds.length })}
                    </span>
                </div>
                <div className="flex gap-1.5 items-center">
                    <DefaultBadge id={primaryId} defaultId={defaultId} onSetDefault={onSetDefault} />
                    <button
                        type="button"
                        disabled
                        title={t('profiles.detail.editDisabledMulti')}
                        className="w-8 h-8 rounded-lg border-none bg-surface dark:bg-surface-elevated/50 flex items-center justify-center cursor-not-allowed opacity-35 "
                    >
                        <Pencil size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                    </button>
                    <button
                        type="button"
                        title={t('profiles.detail.more')}
                        className="w-8 h-8 rounded-lg border-none bg-surface dark:bg-surface-elevated flex items-center justify-center cursor-pointer "
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            color="var(--color-secondary)"
                        >
                            <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
                            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                            <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4 pt-4 pb-2 mb-3 ">
                <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                    {t('profiles.detail.curveOverlay')}
                </div>
                <ProfileCurveChart key={chartKey} series={chartSeries} />
            </div>

            <div className="flex flex-wrap gap-2 mb-5">
                {compareProfiles.map((p, i) => {
                    const hasReal = (compareQueries[i]?.data?.length ?? 0) > 0;
                    return (
                        <div
                            key={p.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface dark:bg-surface-elevated "
                        >
                            <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: COMPARE_COLORS[i] }}
                            />
                            <span className="text-[12px] font-medium text-secondary tracking-[0.14px]">{p.name}</span>
                            {!hasReal && (
                                <span title={t('profiles.detail.noRecordedData')} className="flex items-center">
                                    <AlertCircle size={10} strokeWidth={2} className="text-amber-500" />
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="bg-surface dark:bg-surface-elevated rounded-lg  overflow-hidden mb-5">
                <div
                    className="grid"
                    style={{
                        gridTemplateColumns: `140px repeat(${compareProfiles.length}, 1fr)`,
                    }}
                >
                    <div className="px-3.5 py-2.5 border-b border-black/5 dark:border-[#585d61]" />
                    {compareProfiles.map((p, i) => (
                        <div
                            key={p.id}
                            className="px-3.5 py-2.5 border-b border-black/5 dark:border-[#585d61] border-l border-l-black/5 dark:border-l-[#585d61] dark:border-l-[#585d61]"
                        >
                            <div className="flex items-center gap-1.5">
                                <div
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: COMPARE_COLORS[i] }}
                                />
                                <span className="text-[11px] font-semibold text-primary tracking-[0.14px] truncate">
                                    {p.name}
                                </span>
                            </div>
                        </div>
                    ))}
                    {TABLE_ROWS.flatMap(({ label, getValue }, rowIdx) => [
                        <div
                            key={`lbl-${label}`}
                            className={`px-3.5 py-2.5 ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                        >
                            <span className="text-[11px] font-medium text-muted tracking-[0.4px] uppercase">
                                {label}
                            </span>
                        </div>,
                        ...compareProfiles.map((p) => (
                            <div
                                key={`${p.id}-${label}`}
                                className={`px-3.5 py-2.5 border-l border-l-black/5 dark:border-l-[#585d61] ${rowIdx < TABLE_ROWS.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                            >
                                <span className="text-[12px] font-semibold text-primary font-mono tracking-[-0.2px]">
                                    {getValue(p)}
                                </span>
                            </div>
                        )),
                    ])}
                </div>
            </div>
        </div>
    );
};
