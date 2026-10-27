import { formatTemp, useRoastSettings } from '@features/active-roast';
import { formatDateTimeShort, formatDuration } from '@shared/lib/format';
import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import { sessionBatchNumberLabel } from '@shared/lib/sessionRoastTitle';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { Badge } from '@shared/ui/Badge';
import { ChevronLeft, FileText, Package } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChargeWeightEditor, QcMeasurementEditor } from './HistoryQcEditor';
import { HistorySessionChart } from './HistorySessionChart';
import { OutputWeightEditor } from './OutputWeightEditor';
import { RecordSections } from './RecordSections';
import { RecordTextEditor } from './RecordTextEditor';
import { RecordTitleEditor } from './RecordTitleEditor';
import { RoastColorEditor } from './RoastColorEditor';
import { SessionScorecard } from './SessionScorecard';
import { SummaryMetaEditor } from './SummaryMetaEditor';

const detailTitleCls = 'm-0 text-[11px] font-medium tracking-[0.3px] text-muted';

type HistorySessionDetailProps = {
    session: RoastSessionWithRelations;
    onBack: () => void;
    onSaveAsProfile: (id: string) => void;
};

export const HistorySessionDetail = ({ session, onBack, onSaveAsProfile }: HistorySessionDetailProps): ReactNode => {
    const { t } = useTranslation();
    const [exportContainer, setExportContainer] = useState<HTMLDivElement | null>(null);
    const { temperatureUnit, totalBatchPrefix } = useRoastSettings();
    const batchNumbers = sessionBatchNumberLabel(session, totalBatchPrefix);
    const metrics = sessionRoastMetrics(session);
    const results = [
        { label: 'history.table.duration', value: formatDuration(metrics.roastDurationSec) },
        { label: 'history.table.dropTemp', value: formatTemp(session.drop_temp_celsius, temperatureUnit) },
        { label: 'history.scorecard.devTime', value: formatDuration(metrics.devTimeSec) },
        { label: 'history.scorecard.devPct', value: metrics.dtrPct == null ? '—' : `${metrics.dtrPct.toFixed(1)}%` },
    ];
    return (
        <article data-testid="history-detail" className="@container min-w-0">
            <button
                type="button"
                data-testid="history-back"
                onClick={onBack}
                className="mb-3 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] text-muted transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-primary)"
            >
                <ChevronLeft size={14} strokeWidth={2} />
                {t('history.title')}
            </button>
            <header className="mb-4 flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
                <div className="min-w-0 flex-1">
                    <RecordTitleEditor key={session.id} session={session} />
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                        <span>{formatDateTimeShort(session.roasted_at)}</span>
                        {session.beans?.origin && (
                            <span className="text-[12px] text-secondary">{session.beans.origin}</span>
                        )}
                        {session.roast_level && <Badge tone="neutral">{session.roast_level}</Badge>}
                        {batchNumbers && (
                            <span
                                data-testid="history-batch-numbers"
                                className="font-mono"
                                title={t('history.batchNumbers.label')}
                            >
                                {batchNumbers}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <div ref={setExportContainer} />
                    <button
                        type="button"
                        onClick={() => onSaveAsProfile(session.id)}
                        className="inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border-subtle bg-main-bg px-4 py-2 text-[12px] font-medium text-secondary transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
                    >
                        {t('history.saveAsProfile')}
                    </button>
                </div>
            </header>
            <section
                aria-label={t('history.expanded.summary')}
                className="mb-5 rounded-2xl border border-border bg-main-bg"
            >
                <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-3.5 @min-[640px]:grid-cols-4">
                    {results.map(({ label, value }) => (
                        <div key={label} className="min-w-0">
                            <dt className={detailTitleCls}>{t(label)}</dt>
                            <dd className="m-0 mt-1 font-mono text-[22px] leading-tight tracking-[-0.5px] text-primary">
                                {value}
                            </dd>
                        </div>
                    ))}
                </dl>
            </section>
            <div className="grid min-w-0 items-start gap-6 @min-[1000px]:grid-cols-[minmax(0,1fr)_248px]">
                <div className="@container min-w-0 space-y-6">
                    <HistorySessionChart session={session} exportContainer={exportContainer} />
                    <SessionScorecard session={session} />
                    <RecordSections key={session.id} session={session} />
                </div>
                <aside className="grid min-w-0 gap-4 @min-[640px]:grid-cols-2 @min-[1000px]:grid-cols-1">
                    <section className="min-w-0 rounded-2xl border border-border bg-surface-warm p-4">
                        <h2 className="m-0 mb-3 flex items-center gap-2 text-[13px] font-semibold text-primary">
                            <Package size={15} strokeWidth={1.5} className="text-muted" />
                            {t('history.expanded.summary')}
                        </h2>
                        <SummaryMetaEditor key={session.id} session={session} />
                        <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
                            <div className="grid grid-cols-2 gap-2">
                                <ChargeWeightEditor key={session.id} session={session} />
                                <OutputWeightEditor key={session.id} session={session} />
                            </div>
                            <RoastColorEditor key={`color-${session.id}`} session={session} />
                            <QcMeasurementEditor key={`qc-${session.id}`} session={session} />
                        </div>
                    </section>
                    <section className="min-w-0 rounded-2xl border border-border bg-main-bg p-4">
                        <h2 className="m-0 mb-3 flex items-center gap-2 text-[13px] font-semibold text-primary">
                            <FileText size={15} strokeWidth={1.5} className="text-muted" />
                            {t('history.expanded.notes')}
                        </h2>
                        <RecordTextEditor key={session.id} session={session} />
                    </section>
                </aside>
            </div>
        </article>
    );
};
