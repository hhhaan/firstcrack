import { useHistoryChart } from '@entities/roast';
import { useRoastSettings } from '@features/active-roast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { Flame, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoastRecordSave } from '../hooks/useRoastRecordSave';
import { sessionHeatPlan } from '../lib/record-heat';
import { RecordEventsEditor } from './RecordEventsEditor';
import { RecordHeaterEditor } from './RecordHeaterEditor';

const actionCls =
    'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-subtle bg-main-bg px-3 py-1.5 text-[12px] font-medium tracking-[0.14px] text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';

/** Entry points for editing a saved record's key marks and Heat set steps. */
export const RecordEditActions = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const record = useRoastRecordSave(session);
    const curve = useHistoryChart(session.tsv_path ?? null);
    const [open, setOpen] = useState<'events' | 'heat' | null>(null);
    const heatPlan = sessionHeatPlan(session, curve.points);
    // An unreadable stored edit still opens so it can be reverted to the recorded steps.
    const hasHeat = heatPlan.source === 'session' || heatPlan.events.length > 0;
    const readOnlyTitle = record.canWrite ? undefined : t('history.edit.readOnly');

    return (
        <div className="flex flex-wrap items-center gap-2">
            <button
                type="button"
                className={actionCls}
                disabled={!record.canWrite || record.isPending}
                data-testid="history-edit-events"
                title={readOnlyTitle}
                onClick={() => setOpen('events')}
            >
                <Pencil size={13} strokeWidth={2} />
                {t('history.edit.editEvents')}
            </button>
            <button
                type="button"
                data-testid="history-edit-heat"
                className={actionCls}
                disabled={!record.canWrite || record.isPending || curve.isLoading || !hasHeat}
                title={readOnlyTitle ?? (!hasHeat && !curve.isLoading ? t('history.edit.noHeat') : undefined)}
                onClick={() => setOpen('heat')}
            >
                <Flame size={13} strokeWidth={2} />
                {t('history.edit.editHeat')}
            </button>
            {open === 'events' && (
                <RecordEventsEditor
                    events={session.events}
                    unit={unit}
                    onSave={record.saveEvents}
                    errorText={record.errorText}
                    onClose={() => setOpen(null)}
                />
            )}
            {open === 'heat' && (
                <RecordHeaterEditor
                    session={session}
                    points={curve.points}
                    unit={unit}
                    onSave={record.saveHeater}
                    errorText={record.errorText}
                    onClose={() => setOpen(null)}
                />
            )}
        </div>
    );
};
