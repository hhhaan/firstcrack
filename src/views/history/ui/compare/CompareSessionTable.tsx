import { formatTemp, type PhaseSegment, useRoastSettings } from '@features/active-roast';
import { roastColorDisplay } from '@features/active-roast/lib/roastColorText';
import { formatDateShort, formatDuration } from '@shared/lib/format';
import type { RoastMetrics } from '@shared/lib/roast-delta';
import { sessionBatchNumberLabel, sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import type { StoredRoastEvent } from '@shared/types/roast';
import { useTranslation } from 'react-i18next';

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

    return (
        <section aria-labelledby="compare-metrics-title">
            <h3 id="compare-metrics-title" className="mb-2 text-[13px] font-semibold text-primary">
                {t('history.compare.metrics')}
            </h3>
            <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[760px] border-collapse text-left">
                    <thead className="bg-surface/45 text-[12px] font-medium text-secondary">
                        <tr className="border-b border-border">
                            <th scope="col" className="w-[24%] px-3 py-1.5 font-medium">
                                {t('history.compare.batch')}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-medium">
                                {t('history.compare.duration')}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-medium">
                                {t('history.compare.chargeTemp')}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-medium">
                                {t('history.compare.dropTemp')}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-medium">
                                {t('history.compare.dtr')}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-medium">
                                {t('history.expanded.colorWhole')}
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-medium">
                                {t('history.expanded.colorGround')}
                            </th>
                            <th scope="col" className="px-3 py-1.5 text-right font-medium">
                                {t('history.compare.weight')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => {
                            const { session, metrics } = item;
                            return (
                                <tr key={session.id} className="border-b border-border-subtle last:border-b-0">
                                    <th scope="row" className="px-3 py-2 font-normal">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className="flex h-6 min-w-8 shrink-0 items-center justify-center rounded border-l-4 px-1 font-mono text-xs font-semibold text-primary"
                                                style={{
                                                    borderColor: item.color,
                                                    backgroundColor: `color-mix(in srgb, ${item.color} 12%, transparent)`,
                                                }}
                                            >
                                                {session.profile_batch_number != null
                                                    ? `#${session.profile_batch_number}`
                                                    : String(index + 1).padStart(2, '0')}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="truncate text-[13px] font-semibold text-primary">
                                                    {sessionRoastTitle(session) ?? '—'}
                                                </div>
                                                <div className="truncate text-[11px] text-secondary">
                                                    {[
                                                        sessionBatchNumberLabel(session),
                                                        formatDateShort(session.roasted_at),
                                                        session.roast_profiles?.name,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </div>
                                            </div>
                                        </div>
                                    </th>
                                    <td className="px-2 py-2 font-mono text-[13px] font-semibold text-primary">
                                        {formatDuration(metrics.roastDurationSec)}
                                    </td>
                                    <td className="px-2 py-2 font-mono text-[13px] font-semibold text-primary">
                                        {formatTemp(item.chargeBt, unit)}
                                    </td>
                                    <td className="px-2 py-2">
                                        <div className="font-mono text-[13px] font-semibold text-primary">
                                            {formatTemp(item.dropBt, unit)}
                                        </div>
                                        <div className="whitespace-nowrap text-[11px] text-secondary">
                                            ET <span className="font-mono">{formatTemp(item.dropEt, unit)}</span>
                                        </div>
                                    </td>
                                    <td className="px-2 py-2">
                                        <div className="font-mono text-[13px] font-semibold text-primary">
                                            {metrics.dtrPct != null ? `${metrics.dtrPct.toFixed(1)}%` : '—'}
                                        </div>
                                        {metrics.rollingDevPct != null && (
                                            <div
                                                className="whitespace-nowrap text-[11px] text-secondary"
                                                title={t('history.compare.dtrRolling')}
                                            >
                                                Rolling{' '}
                                                <span className="font-mono">{metrics.rollingDevPct.toFixed(1)}%</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 font-mono text-[13px] font-semibold text-primary">
                                        {roastColorDisplay(session.color_whole)}
                                    </td>
                                    <td className="px-2 py-2 font-mono text-[13px] font-semibold text-primary">
                                        {roastColorDisplay(session.color_ground)}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="whitespace-nowrap font-mono text-[13px] font-semibold text-primary">
                                            {session.weight_grams.toLocaleString()} g
                                        </div>
                                        <div className="text-[11px] text-secondary" title={t('history.compare.level')}>
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
