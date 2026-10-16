import { formatTemp, useRoastSettings } from '@features/active-roast';
import type { DashboardRecentSession } from '@features/dashboard-summary';
import { formatDuration } from '@shared/lib/format';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import type { View } from '@shared/types/view';
import { Badge } from '@shared/ui/Badge';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { levelBg, levelColor } from '../lib/constants';
import { formatDate, formatWeight } from '../lib/format';

interface RecentSessionsTableProps {
    data: DashboardRecentSession[];
    loading: boolean;
    onNavigate: (view: View) => void;
}

export const RecentSessionsTable = ({ data, loading, onNavigate }: RecentSessionsTableProps) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;

    return (
        <div className="bg-main-bg rounded-lg overflow-hidden dark:border dark:border-[#585d61]">
            <div className="px-6 pt-4.5 pb-3.5 flex items-center justify-between border-b border-divider">
                <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">
                    {t('dashboard.recentSessions')}
                </h2>
                <button
                    type="button"
                    onClick={() => onNavigate('history')}
                    className="flex items-center gap-1 text-[13px] font-medium text-muted bg-transparent border-0 cursor-pointer tracking-[0.14px]"
                >
                    {t('dashboard.viewAll')} <ChevronRight size={13} strokeWidth={2} />
                </button>
            </div>
            <table className="w-full border-collapse">
                <thead>
                    <tr className="border-b border-divider">
                        {[
                            t('dashboard.table.date'),
                            t('dashboard.table.bean'),
                            t('dashboard.table.profile'),
                            t('dashboard.table.weight'),
                            t('dashboard.table.dropTemp'),
                            t('dashboard.table.duration'),
                            t('dashboard.table.level'),
                        ].map((h) => (
                            <th
                                key={h}
                                className="px-6 py-2.5 text-left text-xs font-medium text-muted tracking-[0.5px] uppercase whitespace-nowrap overflow-hidden text-ellipsis"
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={7} className="px-6 py-8 text-center text-[13px] text-muted">
                                {t('dashboard.loading')}
                            </td>
                        </tr>
                    ) : data.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="px-6 py-8 text-center text-[13px] text-muted">
                                {t('dashboard.noSessions')}
                            </td>
                        </tr>
                    ) : (
                        data.map((session, i) => {
                            const level = session.roast_level ?? '';
                            return (
                                <tr key={session.id} className={i < data.length - 1 ? 'border-b border-divider' : ''}>
                                    <td className="px-6 py-3 text-[13px] text-muted font-normal whitespace-nowrap">
                                        {session.roasted_at ? formatDate(session.roasted_at) : '—'}
                                    </td>
                                    <td className="px-6 py-3 text-[13px] text-primary font-medium tracking-[0.14px] whitespace-nowrap">
                                        {sessionBeanName(session) ?? '—'}
                                    </td>
                                    <td className="px-6 py-3 text-[13px] text-secondary tracking-[0.14px] whitespace-nowrap">
                                        {session.roast_profiles?.name ?? '—'}
                                    </td>
                                    <td className="px-6 py-3 text-[13px] text-secondary whitespace-nowrap">
                                        {formatWeight(session.weight_grams)}
                                    </td>
                                    <td className="px-6 py-3 text-[13px] text-secondary font-mono whitespace-nowrap">
                                        {formatTemp(session.drop_temp_celsius, unit)}
                                    </td>
                                    <td className="px-6 py-3 text-[13px] text-secondary font-mono whitespace-nowrap">
                                        {formatDuration(session.roastDurationSec)}
                                    </td>
                                    <td className="px-6 py-3">
                                        {level && (
                                            <Badge
                                                color={levelColor[level] || 'var(--color-muted)'}
                                                bg={levelBg[level] || 'var(--color-surface)'}
                                            >
                                                {level}
                                            </Badge>
                                        )}
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
};
