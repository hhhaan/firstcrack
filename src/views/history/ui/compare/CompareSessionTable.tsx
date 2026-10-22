import { formatTemp, type PhaseSegment, useRoastSettings } from '@features/active-roast';
import { roastColorDisplay } from '@features/active-roast/lib/roastColorText';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { formatDateShort, formatDuration, formatElapsed } from '@shared/lib/format';
import type { RoastMetrics } from '@shared/lib/roast-delta';
import { sessionBatchNumberLabel, sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
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
                <h3 id="compare-metrics-title" className="text-sm font-semibold text-primary">
                    {t('history.compare.metrics')}
                </h3>
                <div className="flex gap-4 text-xs text-secondary">
                    {[
                        ['Drying', 'bg-(--color-phase-drying)'],
                        ['Maillard', 'bg-(--color-phase-maillard)'],
                        ['Development', 'bg-(--color-phase-development)'],
                    ].map(([name, color]) => (
                        <span key={name} className="flex items-center gap-1.5">
                            <span className={`h-2.5 w-2.5 rounded-sm ${color}`} />
                            {t(`history.compare.phase${name}`)}
                        </span>
                    ))}
                </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[1000px] border-collapse text-left">
                    <thead className="bg-surface/45 text-[13px] font-medium text-secondary">
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
                                <tr key={session.id} className="border-b border-border-subtle last:border-b-0">
                                    <th scope="row" className="px-4 py-4 font-normal">
                                        <div className="flex items-start gap-3">
                                            <span
                                                className="flex h-8 w-10 shrink-0 items-center justify-center rounded border-l-4 font-mono text-sm font-semibold text-primary"
                                                style={{
                                                    borderColor: item.color,
                                                    backgroundColor: `color-mix(in srgb, ${item.color} 12%, transparent)`,
                                                }}
                                            >
                                                {String(index + 1).padStart(2, '0')}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-primary">
                                                    {sessionRoastTitle(session) ?? '—'}
                                                </div>
                                                {sessionBatchNumberLabel(session) && (
                                                    <div className="mt-1 font-mono text-xs text-secondary">
                                                        {sessionBatchNumberLabel(session)}
                                                    </div>
                                                )}
                                                <dl className="mt-1 flex flex-wrap gap-x-3 text-xs text-secondary">
                                                    {[
                                                        ['colorWhole', session.color_whole],
                                                        ['colorGround', session.color_ground],
                                                    ].map(([key, color]) => (
                                                        <div key={key} className="flex gap-1">
                                                            <dt>{t(`history.expanded.${key}`)}</dt>
                                                            <dd className="font-mono">{roastColorDisplay(color)}</dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                                <div className="mt-1 text-xs text-secondary">
                                                    {formatDateShort(session.roasted_at)}
                                                    {session.roast_profiles?.name &&
                                                        ` · ${session.roast_profiles.name}`}
                                                </div>
                                            </div>
                                        </div>
                                    </th>
                                    <td className="px-3 py-4 font-mono text-[15px] font-semibold text-primary">
                                        {formatDuration(metrics.roastDurationSec)}
                                    </td>
                                    <td className="px-3 py-4 font-mono text-[15px] font-semibold text-primary">
                                        {formatTemp(item.chargeBt, unit)}
                                    </td>
                                    <td className="px-3 py-4">
                                        <div className="font-mono text-[15px] font-semibold text-primary">
                                            {formatTemp(item.dropBt, unit)}
                                        </div>
                                        <div className="mt-1 whitespace-nowrap text-xs text-secondary">
                                            ET <span className="font-mono">{formatTemp(item.dropEt, unit)}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-4">
                                        <div className="font-mono text-[15px] font-semibold text-primary">
                                            {metrics.dtrPct != null ? `${metrics.dtrPct.toFixed(1)}%` : '—'}
                                        </div>
                                        {metrics.rollingDevPct != null && (
                                            <div
                                                className="mt-1 whitespace-nowrap text-xs text-secondary"
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
                                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
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
                                        <div className="whitespace-nowrap font-mono text-[15px] font-semibold text-primary">
                                            {session.weight_grams.toLocaleString()} g
                                        </div>
                                        <div className="mt-1 text-xs text-secondary" title={t('history.compare.level')}>
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
