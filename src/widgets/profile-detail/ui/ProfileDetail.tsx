import type { RoastProfileWithSource } from '@entities/roast-profile';
import { useProfileBeanHistory, useSourceSessionEvents } from '@entities/roast-profile';
import { useRoastSettings } from '@features/active-roast';
import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { parseStoredRoastEvents, storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import { RoastLog } from '@features/active-roast/ui/RoastLog';
import { useCsvFileExport } from '@features/export-csv';
import { generateProfileCurve } from '@shared/data/roast-profiles';
import { logger } from '@shared/lib/logger';
import type { View } from '@shared/types/view';
import { Badge } from '@shared/ui/Badge';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { ProfileCurveChart } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { AlertCircle, Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { profileExportBasename, profileToCsv } from '../lib/export-profile-csv';
import { useProfileTableRows } from '../model/useProfileTableRows';
import { ConsistencyCard } from './ConsistencyCard';

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
            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#EFEFF0] px-2.5 py-1 dark:bg-surface-elevated">
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
            className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border-none bg-surface px-2.5 py-1 transition-colors hover:bg-palette-teal/12 dark:bg-surface-elevated"
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
    const [moreOpen, setMoreOpen] = useState(false);
    const { data: beanHistory = [] } = useProfileBeanHistory(selected.id ?? '');
    const { data: sourceEvents = null } = useSourceSessionEvents(selected.source_session_id);
    const TABLE_ROWS = useProfileTableRows('profiles.detail.totalDuration');
    const exportFile = useCsvFileExport();
    const unit = useRoastSettings().temperatureUnit;
    const roastLogEntries = useMemo(
        () => storedEventsToLogEntries(parseStoredRoastEvents(sourceEvents), unit),
        [sourceEvents, unit],
    );

    const handleExport = useCallback(async () => {
        setMoreOpen(false);
        try {
            const curve = selectedHasReal
                ? selectedRealCurve
                : generateProfileCurve(selected.drop_temp_celsius ?? 200, selected.duration_sec ?? 720).map((p) => ({
                      t: p.t,
                      bt: p.bt,
                  }));
            const csv = profileToCsv(selected, curve, selectedHasReal ? 'session' : 'synthetic');

            await exportFile(csv, `${profileExportBasename(selected.name)}.csv`, {
                title: t('profiles.detail.exportTitle'),
                okLabel: t('profiles.detail.exportOkLabel'),
                cancelLabel: t('profiles.detail.exportCancelLabel'),
                confirmMessage: (path) => t('profiles.detail.exportConfirm', { path }),
            });
        } catch (err) {
            logger.capture(err, { context: 'export profile csv' });
        }
    }, [selected, selectedHasReal, selectedRealCurve, t, exportFile]);

    const iconBtnClass =
        'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-surface dark:bg-surface-elevated';
    const menuItemClass =
        'flex w-full cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent px-2.5 py-2 text-left text-[13px] tracking-[0.14px]';

    return (
        <div className="min-w-0 bg-main-bg rounded-lg px-8 py-7 dark:border dark:border-[#585d61]">
            <div className="mb-5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <h2 className="mb-1 break-words font-display text-[26px] font-light leading-[1.2] tracking-[-0.3px] text-primary">
                        {selected.name}
                    </h2>
                    {selected.description && (
                        <p className="break-words text-sm leading-normal tracking-[0.14px] text-secondary">
                            {selected.description}
                        </p>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <DefaultBadge id={selected.id} defaultId={defaultId} onSetDefault={onSetDefault} />
                    <button type="button" title={t('profiles.detail.edit')} onClick={onEdit} className={iconBtnClass}>
                        <Pencil size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                    </button>
                    <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                title={t('profiles.detail.more')}
                                aria-label={t('profiles.detail.more')}
                                className={iconBtnClass}
                            >
                                <MoreHorizontal size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-1.5" align="end" side="bottom">
                            <button
                                type="button"
                                onClick={() => void handleExport()}
                                className={`${menuItemClass} text-primary hover:bg-surface`}
                            >
                                <Download size={14} strokeWidth={2} />
                                {t('profiles.detail.export')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMoreOpen(false);
                                    onDelete(selected.id);
                                }}
                                className={`${menuItemClass} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15`}
                            >
                                <Trash2 size={14} strokeWidth={2} />
                                {t('profiles.detail.delete')}
                            </button>
                        </PopoverContent>
                    </Popover>
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
