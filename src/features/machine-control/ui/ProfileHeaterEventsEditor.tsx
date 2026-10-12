import { ROASTER_REGISTRY, useMachines } from '@entities/machine';
import { useTranslation } from 'react-i18next';
import { useSidecarStatus } from '../api/useSidecarStatus';
import { liveHeaterFromStatus, profileHeaterBounds, type ReplayPlanSource } from '../lib/heater-events';
import type { ReplayEvent, ReplayPoint } from '../lib/replay';
import { HeaterEventsEditor } from './HeaterEventsEditor';

/** Profile or saved roast record — both carry the machine snapshot that fixes heater bounds. */
type Profile = { machine_id?: string | null; machine_roaster_key?: string | null };

type Props = {
    profile: Profile;
    events: ReplayEvent[];
    tpTime: number;
    btPoints: ReplayPoint[];
    source: ReplayPlanSource | null;
    unit: 'C' | 'F';
    /** `history` edits the saved record, including new and removed steps. Never sends machine commands. */
    mode?: 'profile' | 'history';
    saveErrorMessage?: (error: unknown) => string | null;
    onClose: () => void;
    onApply: (events: ReplayEvent[] | null) => void | Promise<void>;
};

export const ProfileHeaterEventsEditor = ({
    profile,
    events,
    tpTime,
    btPoints,
    source,
    unit,
    mode = 'profile',
    saveErrorMessage,
    onClose,
    onApply,
}: Props) => {
    const { t } = useTranslation();
    const machines = useMachines((s) => s.machines);
    const statusQuery = useSidecarStatus(true);
    const live = statusQuery.isSuccess ? liveHeaterFromStatus(statusQuery.data) : undefined;
    const heater = profileHeaterBounds(profile, machines, ROASTER_REGISTRY, live);
    if (statusQuery.isFetching) return null;
    return (
        <HeaterEventsEditor
            mode={mode}
            events={events}
            tpTime={tpTime}
            btPoints={btPoints}
            source={source}
            unit={unit}
            heaterMin={heater.min}
            heaterMax={heater.max}
            heaterUnit={heater.unit}
            heaterStep={heater.step}
            boundsNote={heater.origin === 'fallback' ? t('heaterEventsEditor.boundsFallback') : undefined}
            saveErrorMessage={saveErrorMessage}
            onClose={onClose}
            onApply={onApply}
        />
    );
};
