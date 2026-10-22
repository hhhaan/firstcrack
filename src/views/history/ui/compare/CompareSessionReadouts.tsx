import type { CompareChartSeries } from '@features/active-roast/lib/chart-option';
import {
    type CompareChannel,
    compareChannelValue,
    compareCurveStyle,
    comparePointAtTime,
} from '@features/active-roast/lib/chart-option/compare-channels';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { useCurveStyles } from '@features/active-roast/model/useCurveStyles';
import { COMPARE_MARKERS } from '@shared/lib/compare-style';
import { formatDateTimeShort } from '@shared/lib/format';
import { sessionBatchNumberLabel, sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { AlertCircle, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CompareSessionItem } from './CompareSessionTable';

interface CompareSessionReadoutsProps {
    items: CompareSessionItem[];
    series: CompareChartSeries[];
    channels: CompareChannel[];
    selectedKey: string | null;
    focusedSessionId: string | null;
    temperatureUnit: TemperatureUnit;
    cursorTime: number | null;
    onToggle: (id: string) => void;
    onFocusSession: (id: string | null) => void;
}

export const CompareSessionReadouts = ({
    items,
    series,
    channels,
    selectedKey,
    focusedSessionId,
    temperatureUnit,
    cursorTime,
    onToggle,
    onFocusSession,
}: CompareSessionReadoutsProps) => {
    const { t } = useTranslation();
    const curves = useCurveStyles();
    const visibleCount = items.filter((item) => item.visible).length;
    return (
        <div
            role="group"
            aria-label={t('history.compare.sidebarTitle', { count: items.length })}
            className="overflow-x-auto border-t border-border"
        >
            <table className="w-full min-w-[760px] border-collapse text-left">
                <thead className="border-b border-border bg-surface/45">
                    <tr>
                        <th scope="col" className="min-w-64 px-4 py-3 text-xs font-medium text-secondary">
                            {t('history.compare.batch')}
                        </th>
                        {channels.map((channel) => (
                            <th
                                key={channel.key}
                                scope="col"
                                className={`whitespace-nowrap px-3 py-3 text-xs font-medium text-secondary ${channel.key === selectedKey ? 'bg-surface' : ''}`}
                            >
                                <span className="flex items-center gap-1.5">
                                    <span
                                        aria-hidden="true"
                                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                                        style={{ backgroundColor: compareCurveStyle(channel, curves).color }}
                                    />
                                    {channel.label}
                                </span>
                                <span className="mt-0.5 block text-[11px] font-normal">{channel.unit}</span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {items.map(({ session, visible, hasCurve }, index) => {
                        const name = sessionRoastTitle(session) ?? session.roast_profiles?.name ?? '—';
                        const batchNumbers = sessionBatchNumberLabel(session);
                        const sample =
                            cursorTime === null ? undefined : comparePointAtTime(series[index].points, cursorTime);
                        return (
                            <tr
                                key={session.id}
                                data-testid="compare-batch-readout"
                                onMouseEnter={() => onFocusSession(visible ? session.id : null)}
                                onMouseLeave={() => onFocusSession(null)}
                                className={`border-b border-border-subtle last:border-b-0 ${
                                    focusedSessionId === session.id ? 'bg-surface-warm' : ''
                                } ${visible ? '' : 'opacity-45'}`}
                            >
                                <th scope="row" className="px-4 py-3 font-normal">
                                    <button
                                        type="button"
                                        aria-pressed={visible}
                                        aria-label={`${name} · ${formatDateTimeShort(session.roasted_at)}`}
                                        aria-disabled={visible && visibleCount === 1}
                                        onClick={() => {
                                            onToggle(session.id);
                                            onFocusSession(null);
                                        }}
                                        onFocus={() => onFocusSession(visible ? session.id : null)}
                                        onBlur={() => onFocusSession(null)}
                                        className="flex w-full items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary ${visible ? 'bg-primary text-main-bg' : ''}`}
                                        >
                                            {visible && <Check size={12} strokeWidth={2.5} />}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1.5 text-secondary">
                                            <svg
                                                width="14"
                                                height="14"
                                                viewBox="-6 -6 12 12"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.4"
                                                aria-hidden="true"
                                            >
                                                <path d={COMPARE_MARKERS[index % COMPARE_MARKERS.length]} />
                                            </svg>
                                            <span className="font-mono text-xs">
                                                {String(index + 1).padStart(2, '0')}
                                            </span>
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-xs font-semibold text-primary">{name}</span>
                                            <span className="mt-1 block text-[11px] text-secondary">
                                                {formatDateTimeShort(session.roasted_at)}
                                                {batchNumbers && ` · ${batchNumbers}`}
                                            </span>
                                        </span>
                                        {!hasCurve && (
                                            <span title={t('history.compare.noCurveData')}>
                                                <AlertCircle size={13} className="text-secondary" />
                                            </span>
                                        )}
                                    </button>
                                </th>
                                {channels.map((channel) => {
                                    const value =
                                        sample && visible
                                            ? compareChannelValue(sample, channel, temperatureUnit)
                                            : null;
                                    return (
                                        <td
                                            key={channel.key}
                                            data-channel={channel.key}
                                            className={`px-3 py-3 font-mono text-sm tabular-nums text-primary ${channel.key === selectedKey ? 'bg-surface font-semibold' : ''}`}
                                        >
                                            {value == null ? '—' : value.toFixed(1)}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
