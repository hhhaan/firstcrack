import type { TemperatureUnit } from '@features/active-roast';
import { heaterEventsToJson } from '@features/machine-control/lib/heater-events';
import type { ReplayPoint } from '@features/machine-control/lib/replay';
import { ProfileHeaterEventsEditor } from '@features/machine-control/ui/ProfileHeaterEventsEditor';
import type { Json, RoastSessionWithRelations } from '@shared/types/database.types';
import { sameHeatPlan, sessionHeatPlan } from '../lib/record-heat';

type Props = {
    session: RoastSessionWithRelations;
    points: ReplayPoint[];
    unit: TemperatureUnit;
    onSave: (heaterEvents: Json | null) => Promise<void>;
    errorText: (error: unknown) => string;
    onClose: () => void;
};

/**
 * Heat set steps of a saved record. Persists roast_sessions.heater_events only —
 * the TSV curve stays as measured and no command reaches the connected machine.
 */
export const RecordHeaterEditor = ({ session, points, unit, onSave, errorText, onClose }: Props) => {
    const plan = sessionHeatPlan(session, points);
    return (
        <ProfileHeaterEventsEditor
            mode="history"
            profile={session}
            events={plan.events}
            tpTime={plan.tpTime}
            btPoints={points}
            source={plan.source}
            unit={unit}
            saveErrorMessage={errorText}
            onClose={onClose}
            onApply={async (events) => {
                const unchangedRecorded =
                    plan.source === 'tsv' && events != null && sameHeatPlan(events, plan.recorded, plan.tpTime);
                if (!unchangedRecorded) await onSave(events ? heaterEventsToJson(events) : null);
                onClose();
            }}
        />
    );
};
