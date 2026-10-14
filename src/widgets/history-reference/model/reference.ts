import { formatDateShort } from '@shared/lib/format';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import type { RoastSessionWithRelations } from '@shared/types/database.types';

export type HistoryReference = {
    id: string;
    ownerId: string;
    name: string;
    tsvPath: string;
    bbpPath: string | null;
    events: unknown;
    heaterEvents: unknown;
    durationSec: number | null;
    machineId: string | null;
    machineKey: string | null;
};

export const historyReferenceTitle = (session: RoastSessionWithRelations) =>
    `${session.bean_label?.trim() || sessionBeanName(session) || '—'} · ${formatDateShort(session.roasted_at)}`;

export const toHistoryReference = (session: RoastSessionWithRelations, ownerId: string): HistoryReference | null => {
    if (!session.tsv_path || session.user_id !== ownerId) return null;
    return {
        id: session.id,
        ownerId,
        name: historyReferenceTitle(session),
        tsvPath: session.tsv_path,
        bbpPath: session.bbp_tsv_path,
        events: session.events,
        heaterEvents: session.heater_events,
        durationSec: session.duration_seconds,
        machineId: session.machine_id,
        machineKey: session.machine_roaster_key,
    };
};
