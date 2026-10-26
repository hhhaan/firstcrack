import { ROASTER_REGISTRY, useMachines } from '@entities/machine';
import { useHistoryChart } from '@entities/roast';
import { tempUnitLabel, useRoastSettings } from '@features/active-roast';
import { formatEditTime, profileHeaterBounds } from '@features/machine-control/lib/heater-events';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoastRecordSave } from '../hooks/useRoastRecordSave';
import { toEventDrafts } from '../lib/record-edit';
import { sessionHeatPlan } from '../lib/record-heat';
import { RecordEventsEditor } from './RecordEventsEditor';
import { RecordHeaterEditor } from './RecordHeaterEditor';

const editCls =
    'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border-subtle bg-main-bg px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) disabled:cursor-not-allowed disabled:opacity-40';

const sectionTitleCls = 'm-0 text-[13px] font-semibold text-primary';

type SectionProps = { title: string; action: ReactNode; children: ReactNode; testId: string };

const Section = ({ title, action, children, testId }: SectionProps) => (
    <section data-testid={testId} className="min-w-0 rounded-xl border border-border-subtle bg-main-bg p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitleCls}>{title}</h2>
            {action}
        </div>
        {children}
    </section>
);

const rowCls = 'flex items-baseline justify-between gap-3 border-t border-border-subtle py-3 first:border-t-0';

/** Key marks + Heat set steps of a saved record, each with its edit entry (PR 1 save path). */
export const RecordSections = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const machines = useMachines((s) => s.machines);
    const heaterUnit = profileHeaterBounds(session, machines, ROASTER_REGISTRY).unit;
    const curve = useHistoryChart(session.tsv_path ?? null);
    const [open, setOpen] = useState<{
        section: 'events' | 'heat';
        session: RoastSessionWithRelations;
    } | null>(null);
    const record = useRoastRecordSave(open?.session ?? session);
    const eventsBtn = useRef<HTMLButtonElement>(null);
    const heatBtn = useRef<HTMLButtonElement>(null);

    const marks = toEventDrafts(session.events, unit);
    const heat = sessionHeatPlan(session, curve.points);
    const readOnlyTitle = record.canWrite ? undefined : t('history.edit.readOnly');

    const close = () => {
        const back = open?.section === 'heat' ? heatBtn.current : eventsBtn.current;
        setOpen(null);
        requestAnimationFrame(() => back?.focus());
    };

    return (
        <div className="grid gap-5 @min-[600px]:grid-cols-2">
            <Section
                testId="history-section-events"
                title={t('history.expanded.keyEvents')}
                action={
                    <button
                        ref={eventsBtn}
                        type="button"
                        data-testid="history-edit-events"
                        className={editCls}
                        disabled={!record.canWrite || record.isPending || marks.length === 0}
                        title={readOnlyTitle}
                        onClick={() => setOpen({ section: 'events', session })}
                    >
                        {t('history.edit.editEvents')}
                    </button>
                }
            >
                {marks.length === 0 ? (
                    <p className="m-0 text-[13px] text-muted">{t('history.edit.noEvents')}</p>
                ) : (
                    <ul className="m-0 list-none p-0">
                        {marks.map((m) => (
                            <li key={m.index} className={rowCls}>
                                <span className="text-[13px] font-medium text-primary">{roastEventLabel(m.type)}</span>
                                <span className="font-mono text-[12px] text-secondary">
                                    {m.time}
                                    <span className="text-muted"> · </span>
                                    {m.temp ? `${m.temp}${tempUnitLabel(unit)}` : '—'}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <Section
                testId="history-section-heat"
                title={t('history.expanded.heatRecord')}
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        {heat.source && (
                            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-secondary dark:bg-surface-elevated">
                                {t(
                                    heat.source === 'session'
                                        ? 'heaterEventsEditor.sourceSession'
                                        : 'heaterEventsEditor.sourceTsv',
                                )}
                            </span>
                        )}
                        <button
                            ref={heatBtn}
                            type="button"
                            data-testid="history-edit-heat"
                            className={editCls}
                            disabled={!record.canWrite || record.isPending || curve.isLoading}
                            title={readOnlyTitle}
                            onClick={() => setOpen({ section: 'heat', session })}
                        >
                            {t('history.edit.editHeat')}
                        </button>
                    </div>
                }
            >
                {curve.isLoading ? (
                    <p className="m-0 text-[13px] text-muted" role="status">
                        {t('history.expanded.chartLoading')}
                    </p>
                ) : heat.events.length === 0 ? (
                    <p className="m-0 text-[13px] text-muted">{t('history.edit.noHeat')}</p>
                ) : (
                    <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
                        {heat.events.map((e, i) => (
                            <li key={`${i}-${e.t}`} className={rowCls}>
                                <span className="font-mono text-[12px] text-secondary">{formatEditTime(e.t)}</span>
                                <span className="font-mono text-[13px] font-medium text-primary">
                                    {e.heater}
                                    {heaterUnit}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            {open?.section === 'events' && (
                <RecordEventsEditor
                    events={open.session.events}
                    unit={unit}
                    onSave={record.saveEvents}
                    errorText={record.errorText}
                    onClose={close}
                />
            )}
            {open?.section === 'heat' && (
                <RecordHeaterEditor
                    session={open.session}
                    points={curve.points}
                    unit={unit}
                    onSave={record.saveHeater}
                    errorText={record.errorText}
                    onClose={close}
                />
            )}
        </div>
    );
};
