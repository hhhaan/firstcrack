import { useActiveWorkspace } from '@entities/organization';
import { isRoastRecordConflict, useUpdateRoastRecord } from '@entities/roast';
import { recordSummary } from '@features/active-roast/lib/record-summary';
import { useWriteAccess } from '@shared/lib/features';
import type { Json, RoastSessionWithRelations } from '@shared/types/database.types';
import { useTranslation } from 'react-i18next';

const READ_ONLY_CODES = ['read_only_plan', 'trial_expired', 'trial_batch_cap'];

/** One save path for History event + Heat set edits. Each save sends the row it was opened against. */
export const useRoastRecordSave = (session: RoastSessionWithRelations) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const canWrite = useWriteAccess() && isWorkspaceReady && !!workspaceOwnerId && session.user_id === workspaceOwnerId;
    const { mutateAsync, isPending } = useUpdateRoastRecord(workspaceOwnerId);

    const save = async (events: Json, heaterEvents: Json | null) => {
        if (!canWrite) throw new Error('read_only_plan');
        const eventsChanged = JSON.stringify(events) !== JSON.stringify(session.events);
        const summary = eventsChanged ? recordSummary(session, events) : null;
        await mutateAsync({
            sessionId: session.id,
            expectedEvents: session.events,
            expectedHeaterEvents: session.heater_events,
            events,
            heaterEvents,
            dropTempCelsius: summary ? summary.dropTempCelsius : session.drop_temp_celsius,
            durationSeconds: summary ? summary.durationSeconds : session.duration_seconds,
            profileSummary: summary ? summary.profileSummary : null,
        });
    };

    const errorText = (error: unknown): string => {
        if (isRoastRecordConflict(error)) return t('history.edit.conflict');
        const text = `${(error as { message?: unknown } | null)?.message ?? ''}`;
        if (READ_ONLY_CODES.some((code) => text.includes(code))) return t('history.edit.readOnly');
        return t('history.edit.saveFailed');
    };

    return {
        canWrite,
        isPending,
        saveEvents: (events: Json) => save(events, session.heater_events),
        saveHeater: (heaterEvents: Json | null) => save(session.events, heaterEvents),
        errorText,
    };
};
