import type { RoastNoteControls } from '@shared/types/roast';
import i18n from 'i18next';
import { getRoastSettings } from '../model/settings';
import { DEFAULT_MANUAL_CONTROLS, isNumericControlValue, type ManualControlSetting } from './manual-controls';

const controlName = (control: ManualControlSetting) => {
    const custom = control.label.trim();
    if (custom) return custom;
    if (control.id === 'drum') return i18n.t('activeRoast.controls.drum', { defaultValue: 'Drum' }) ?? 'Drum';
    if (control.id === 'airflow')
        return i18n.t('activeRoast.noteEntry.airflow', { defaultValue: 'Airflow' }) ?? 'Airflow';
    return i18n.t('activeRoast.noteEntry.gas', { defaultValue: 'Gas' }) ?? 'Gas';
};

const controlText = (control: ManualControlSetting, value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return '';
    const unit = isNumericControlValue(trimmed) ? control.unit.trim() : '';
    return `${controlName(control)} ${trimmed}${unit ? ` ${unit}` : ''}`;
};

/** Display only: keep the original comment and manual control values separate in storage. */
export const formatRoastNote = (entry: RoastNoteControls & { note?: string | null }, separator = ' · '): string => {
    const controls = getRoastSettings().manualControls ?? DEFAULT_MANUAL_CONTROLS;
    return [...controls.map((control) => controlText(control, entry[control.id])), entry.note]
        .filter(Boolean)
        .join(separator);
};

/** Fan and drum writes use the same `{name} {value}` text as a gas note. */
export const controlChangeLabel = (role: 'fan' | 'drum', value: number): string => {
    const name =
        role === 'fan'
            ? (i18n.t('activeRoast.controls.fan', { defaultValue: 'Fan' }) ?? 'Fan')
            : (i18n.t('activeRoast.controls.drum', { defaultValue: 'Drum' }) ?? 'Drum');
    return `${name} ${String(Number(value.toFixed(2)))}`;
};
