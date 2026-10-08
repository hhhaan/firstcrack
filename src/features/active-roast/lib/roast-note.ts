import type { RoastNoteControls } from '@shared/types/roast';
import i18n from 'i18next';

/** Display only: keep the original comment and manual control values separate in storage. */
export const formatRoastNote = (entry: RoastNoteControls & { note?: string | null }): string =>
    [
        entry.gas && `${i18n.t('activeRoast.noteEntry.gas', { defaultValue: 'Gas' }) ?? 'Gas'} ${entry.gas}`,
        entry.airflow &&
            `${i18n.t('activeRoast.noteEntry.airflow', { defaultValue: 'Airflow' }) ?? 'Airflow'} ${entry.airflow}`,
        entry.drum && `${i18n.t('activeRoast.controls.drum', { defaultValue: 'Drum' }) ?? 'Drum'} ${entry.drum} RPM`,
        entry.note,
    ]
        .filter(Boolean)
        .join(' · ');
