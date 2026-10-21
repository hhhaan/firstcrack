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

/** Fan and drum writes use the same `{name} {value}` text as a gas note. */
export const controlChangeLabel = (role: 'fan' | 'drum', value: number): string => {
    const name =
        role === 'fan'
            ? (i18n.t('activeRoast.controls.fan', { defaultValue: 'Fan' }) ?? 'Fan')
            : (i18n.t('activeRoast.controls.drum', { defaultValue: 'Drum' }) ?? 'Drum');
    return `${name} ${String(Number(value.toFixed(2)))}`;
};
