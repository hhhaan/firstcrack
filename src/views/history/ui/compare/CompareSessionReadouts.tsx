import type { CompareChartSeries } from '@features/active-roast/lib/chart-option';
import {
    type CompareChannel,
    compareChannelValue,
    comparePointAtTime,
} from '@features/active-roast/lib/chart-option/compare-channels';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { formatDateShort, formatElapsed } from '@shared/lib/format';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import { AlertCircle, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CompareSessionItem } from './CompareSessionTable';

interface CompareSessionReadoutsProps {
    items: CompareSessionItem[];
    series: CompareChartSeries[];
    channels: CompareChannel[];
    temperatureUnit: TemperatureUnit;
    cursorTime: number;
    xView: { start: number; end: number };
    onCursorChange: (time: number) => void;
    onToggle: (id: string) => void;
    onFocusSession: (id: string | null) => void;
}

export const CompareSessionReadouts = ({
    items,
    series,
    channels,
    temperatureUnit,
    cursorTime,
    xView,
    onCursorChange,
    onToggle,
    onFocusSession,
}: CompareSessionReadoutsProps) => {
    const { t } = useTranslation();
    const visibleCount = items.filter((item) => item.visible).length;
    const cursorLabel = formatElapsed(cursorTime).padStart(5, '0');
    return (
        <aside className="border-t border-border p-4 min-[900px]:w-60 min-[900px]:shrink-0 min-[900px]:border-t-0 min-[900px]:border-l">
            <div className="mb-4 flex items-center gap-4 min-[900px]:block">
                <div>
                    <p className="text-xs text-secondary">{t('history.compare.cursorTime')}</p>
                    <span data-testid="compare-cursor-time" className="font-mono text-2xl font-semibold text-primary">
                        {cursorLabel}
                    </span>
                </div>
                <input
                    type="range"
                    min={Math.ceil(xView.start)}
                    max={Math.floor(xView.end)}
                    step={1}
                    value={cursorTime}
                    aria-label={t('history.compare.cursorTime')}
                    aria-valuetext={cursorLabel}
                    onChange={(event) => onCursorChange(Number(event.target.value))}
                    className="h-4 w-full accent-primary min-[900px]:mt-2"
                />
            </div>
            <div
                role="group"
                aria-label={t('history.compare.sidebarTitle', { count: items.length })}
                className="grid gap-4 min-[600px]:grid-cols-2 min-[900px]:grid-cols-1"
            >
                {items.map(({ session, color, visible, hasCurve }, index) => {
                    const name = sessionBeanName(session) ?? session.roast_profiles?.name ?? '—';
                    const sample = comparePointAtTime(series[index].points, cursorTime);
                    return (
                        <section
                            key={session.id}
                            data-testid="compare-batch-readout"
                            className="min-w-0 border-l-2 pl-3"
                            style={{ borderColor: color }}
                        >
                            <button
                                type="button"
                                aria-pressed={visible}
                                aria-label={`${name} · ${formatDateShort(session.roasted_at)}`}
                                aria-disabled={visible && visibleCount === 1}
                                onClick={() => {
                                    onToggle(session.id);
                                    onFocusSession(null);
                                }}
                                onMouseEnter={() => onFocusSession(visible ? session.id : null)}
                                onMouseLeave={() => onFocusSession(null)}
                                onFocus={() => onFocusSession(visible ? session.id : null)}
                                onBlur={() => onFocusSession(null)}
                                className="flex w-full items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                            >
                                <span
                                    aria-hidden="true"
                                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-main-bg"
                                    style={{ borderColor: color, backgroundColor: visible ? color : undefined }}
                                >
                                    {visible && <Check size={12} strokeWidth={2.5} />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block break-words text-sm font-semibold text-primary">
                                        <span className="mr-1.5 font-mono text-xs text-secondary">
                                            {String(index + 1).padStart(2, '0')}
                                        </span>
                                        {name}
                                    </span>
                                    <span className="mt-1 block text-xs text-secondary">
                                        {formatDateShort(session.roasted_at)}
                                    </span>
                                </span>
                                {!hasCurve && (
                                    <span title={t('history.compare.noCurveData')}>
                                        <AlertCircle size={13} className="text-secondary" />
                                    </span>
                                )}
                            </button>
                            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                                {channels.map((channel) => {
                                    const value =
                                        sample && visible
                                            ? compareChannelValue(sample, channel, temperatureUnit)
                                            : null;
                                    return (
                                        <div
                                            key={channel.key}
                                            className={
                                                channel.kind === 'other'
                                                    ? 'col-span-2 flex items-baseline justify-between gap-2'
                                                    : ''
                                            }
                                        >
                                            <dt className="text-xs font-medium text-secondary">
                                                {channel.label}
                                                <span className="ml-1 text-[11px] font-normal">{channel.unit}</span>
                                            </dt>
                                            <dd
                                                className="font-mono text-lg leading-6 font-medium tabular-nums"
                                                style={{ color: visible ? color : undefined }}
                                            >
                                                {value == null ? '—' : value.toFixed(1)}
                                            </dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        </section>
                    );
                })}
            </div>
        </aside>
    );
};
