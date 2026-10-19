import { formatTemp, type PhaseSegment, useRoastSettings } from '@features/active-roast';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { formatDateShort, formatDuration, formatElapsed } from '@shared/lib/format';
import type { RoastMetrics } from '@shared/lib/roast-delta';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import type { StoredRoastEvent } from '@shared/types/roast';
import { useTranslation } from 'react-i18next';
import { ComparePhaseBar } from './ComparePhaseBar';

export type CompareSessionItem = {
    session: RoastSessionWithRelations;
    color: string;
    hasCurve: boolean;
    events: StoredRoastEvent[];
    metrics: RoastMetrics;
    segments: PhaseSegment[];
    chargeBt: number | null;
    dropBt: number | null;
    dropEt: number | null;
    visible: boolean;
};

export const CompareSessionTable = ({ items }: { items: CompareSessionItem[] }) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const maxSec = Math.max(1, ...items.map((item) => item.metrics.roastDurationSec ?? 0));

    return (
        <section aria-labelledby="compare-metrics-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 id="compare-metrics-title" className="text-[13px] font-medium text-primary">
                    {t('history.compare.metrics')}
                </h3>
                <div className="flex gap-4 text-[10px] text-muted">
                    {[
                        ['Drying', 'bg-(--color-phase-drying)'],
                        ['Maillard', 'bg-(--color-phase-maillard)'],
                        ['Development', 'bg-(--color-phase-development)'],
                    ].map(([name, color]) => (
                        <span key={name} className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-sm ${color}`} />
                            {t(`history.compare.phase${name}`)}
                        </span>
                    ))}
                </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[1000px] border-collapse text-left">
                    <thead className="bg-surface/45 text-[11px] font-medium text-muted">
                        <tr className="border-b border-border">
                            <th scope="col" className="w-[24%] px-4 py-3 font-medium">
                                {t('history.compare.batch')}
                            </th>
                            <th scope="col" className="px-3 py-3 font-medium">
                                {t('history.compare.duration')}
                            </th>
                            <th scope="col" className="px-3 py-3 font-medium">
                                {t('history.compare.chargeTemp')}
                            </th>
                            <th scope="col" className="px-3 py-3 font-medium">
                                {t('history.compare.dropTemp')}
                            </th>
                            <th scope="col" className="px-3 py-3 font-medium">
                                {t('history.compare.dtr')}
                            </th>
                            <th scope="col" className="w-[25%] min-w-60 px-3 py-3 font-medium">
                                {t('history.compare.phases')}
                            </th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">
                                {t('history.compare.weight')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => {
                            const { session, metrics } = item;
                            return (
                                <tr
                                    key={session.id}
                                    className={`border-b border-border-subtle last:border-b-0 ${item.visible ? '' : 'opacity-45'}`}
                                >
                                    <th scope="row" className="px-4 py-4 font-normal">
                                        <div className="flex items-start gap-3">
                                            <span className="mt-0.5 font-mono text-xs" style={{ color: item.color }}>
                                                {String(index + 1).padStart(2, '0')}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-xs font-medium text-primary">
                                                    {sessionBeanName(session) ?? '—'}
                                                </div>
                                                <div className="mt-1 text-[10px] text-muted">
                                                    {formatDateShort(session.roasted_at)}
                                                    {session.roast_profiles?.name &&
                                                        ` · ${session.roast_profiles.name}`}
                                                </div>
                                            </div>
                                        </div>
                                    </th>
                                    <td className="px-3 py-4 font-mono text-[13px] text-primary">
                                        {formatDuration(metrics.roastDurationSec)}
                                    </td>
                                    <td className="px-3 py-4 font-mono text-[13px] text-primary">
                                        {formatTemp(item.chargeBt, unit)}
                                    </td>
                                    <td className="px-3 py-4">
                                        <div className="font-mono text-[13px] text-primary">
                                            {formatTemp(item.dropBt, unit)}
                                        </div>
                                        <div className="mt-1 whitespace-nowrap text-[10px] text-muted">
                                            ET <span className="font-mono">{formatTemp(item.dropEt, unit)}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-4">
                                        <div className="font-mono text-[13px] text-primary">
                                            {metrics.dtrPct != null ? `${metrics.dtrPct.toFixed(1)}%` : '—'}
                                        </div>
                                        {metrics.rollingDevPct != null && (
                                            <div
                                                className="mt-1 whitespace-nowrap text-[10px] text-muted"
                                                title={t('history.compare.dtrRolling')}
                                            >
                                                Rolling{' '}
                                                <span className="font-mono">{metrics.rollingDevPct.toFixed(1)}%</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-4">
                                        <ComparePhaseBar
                                            segments={item.segments}
                                            totalSec={metrics.roastDurationSec ?? 0}
                                            maxSec={maxSec}
                                        />
                                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
                                            {['FC Start', 'Drop'].map((type) => {
                                                const event = item.events.find((entry) => entry.type === type);
                                                return (
                                                    <span key={type}>
                                                        {roastEventLabel(type)}{' '}
                                                        <span className="font-mono">
                                                            {event ? formatElapsed(event.time_sec) : '—'}
                                                        </span>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        <div className="whitespace-nowrap font-mono text-[13px] text-primary">
                                            {session.weight_grams.toLocaleString()} g
                                        </div>
                                        <div className="mt-1 text-[10px] text-muted" title={t('history.compare.level')}>
                                            {session.roast_level ?? '—'}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
};
