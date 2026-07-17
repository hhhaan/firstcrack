import type { RoastProfileWithSource } from '@entities/roast-profile';
import { resolveSourceSession, useProfileBeanHistory } from '@entities/roast-profile';
import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { parseStoredRoastEvents, storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import { RoastLog } from '@features/active-roast/ui/RoastLog';
import { generateProfileCurve } from '@shared/data/roast-profiles';
import type { View } from '@shared/types/view';
import { Badge } from '@shared/ui/Badge';
import { ProfileCurveChart } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { AlertCircle, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ConsistencyCard } from './ConsistencyCard';

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

interface ProfileDetailProps {
    selected: RoastProfileWithSource;
    selectedRealCurve: { t: number; bt: number }[];
    selectedHasReal: boolean;
    defaultId: string | null;
    chartKey: string;
    onSetDefault: (id: string) => void;
    onEdit: () => void;
    onDelete: (id: string) => void;
    onNavigate: (view: View) => void;
}

const useTableRows = (): { label: string; getValue: (p: RoastProfileWithSource) => string }[] => {
    const { t } = useTranslation();
    return [
        { label: t('profiles.detail.totalDuration'), getValue: (p) => fmtDuration(p.duration_sec) },
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

export const ProfileDetail = ({
    selected,
    selectedRealCurve,
    selectedHasReal,
    defaultId,
    chartKey,
    onSetDefault,
    onEdit,
    onDelete,
    onNavigate,
}: ProfileDetailProps) => {
    const { t } = useTranslation();
    const { data: beanHistory = [] } = useProfileBeanHistory(selected.id ?? '');
    const TABLE_ROWS = useTableRows();
    const roastLogEntries = useMemo(() => {
        const sourceSession = resolveSourceSession(selected.source_session);
        return storedEventsToLogEntries(parseStoredRoastEvents(sourceSession?.events));
    }, [selected.source_session]);

    return (
        <div className="bg-main-bg rounded-lg px-8 py-7 dark:border dark:border-[#585d61]">
            <div className="flex items-start justify-between mb-5">
                <div>
                    <h2 className="font-display font-light text-[26px] leading-[1.2] text-primary tracking-[-0.3px] mb-1">
                        {selected.name}
                    </h2>
                    {selected.description && (
                        <p className="text-sm text-secondary tracking-[0.14px] leading-normal">
                            {selected.description}
                        </p>
                    )}
                </div>
                <div className="flex gap-1.5 items-center">
                    <DefaultBadge id={selected.id} defaultId={defaultId} onSetDefault={onSetDefault} />
                    {[
                        { icon: Copy, labelKey: 'profiles.detail.duplicate' },
                        { icon: Pencil, labelKey: 'profiles.detail.edit', onClick: onEdit },
                        { icon: MoreHorizontal, labelKey: 'profiles.detail.more' },
                    ].map(({ icon: Icon, labelKey, onClick }) => (
                        <button
                            type="button"
                            key={labelKey}
                            title={t(labelKey)}
                            onClick={onClick}
                            className="w-8 h-8 rounded-lg border-none bg-surface dark:bg-surface-elevated flex items-center justify-center cursor-pointer "
                        >
                            <Icon size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4 pt-4 pb-2 mb-5 ">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[12px] font-medium text-muted tracking-[0.5px] uppercase">
                        {t('profiles.detail.profileCurve')}
                    </div>
                    {!selectedHasReal && (
                        <Badge
                            size="sm"
                            tone="yellow"
                            icon={<AlertCircle size={10} strokeWidth={2} />}
                            className="tracking-[0.2px]"
                        >
                            No recorded data · Reference curve
                        </Badge>
                    )}
                </div>
                <ProfileCurveChart
                    key={chartKey}
                    series={[
                        {
                            curve: selectedHasReal
                                ? selectedRealCurve.map((pt) => ({ t: pt.t, bt: pt.bt }))
                                : generateProfileCurve(selected.drop_temp_celsius ?? 200, selected.duration_sec ?? 720),
                            color: 'var(--color-primary)',
                            label: selected.name,
                        },
                    ]}
                />
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
                {TABLE_ROWS.map(({ label, getValue }) => (
                    <div key={label} className="bg-surface dark:bg-surface-elevated rounded-lg px-3.5 py-3 ">
                        <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-1">
                            {label}
                        </div>
                        <div className="text-sm font-semibold text-primary font-mono tracking-[-0.2px]">
                            {getValue(selected)}
                        </div>
                    </div>
                ))}
            </div>

            <ConsistencyCard profileId={selected.id} />

            {roastLogEntries.length > 0 && (
                <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4 py-3 mb-5">
                    <p className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                        {t('profiles.detail.roastLog')}
                    </p>
                    <RoastLog entries={roastLogEntries} eventMarkerColor={EVENT_MARKER_COLORS} variant="main" />
                </div>
            )}

            {beanHistory.length > 0 && (
                <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4 py-3 mb-5">
                    <p className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                        {t('profiles.detail.beansRoasted')}
                    </p>
                    <div className="space-y-1">
                        {beanHistory.map((item) => (
                            <div
                                key={item.name}
                                className="flex justify-between items-center text-xs py-1 border-b border-black/4 dark:border-[#585d61] last:border-0"
                            >
                                <span className="text-primary font-medium">{item.name}</span>
                                <span className="text-muted">
                                    {t('profiles.detail.times', { count: item.count })}
                                    {item.lastDate &&
                                        ` · ${t('profiles.detail.lastDate', { date: new Date(item.lastDate).toLocaleDateString() })}`}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex gap-2.5">
                <button
                    type="button"
                    onClick={() => onNavigate('roast')}
                    className="flex-1 py-2.5 rounded-full border-none dark:border-white bg-primary dark:bg-[#0d0d0d] text-white text-sm font-medium cursor-pointer tracking-[0.14px] "
                >
                    {t('profiles.detail.startWith')}
                </button>
                <button
                    type="button"
                    onClick={() => onDelete(selected.id)}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-full border-none bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400 text-sm font-medium cursor-pointer tracking-[0.14px]"
                >
                    <Trash2 size={14} strokeWidth={2} />
                    {t('profiles.detail.delete')}
                </button>
            </div>
        </div>
    );
};
