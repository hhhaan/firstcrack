import {
    MANUAL_CONTROL_LABEL_MAX,
    MANUAL_CONTROL_UNIT_MAX,
    type ManualControlId,
    type ManualControlSetting,
} from '@features/active-roast/lib/manual-controls';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from './SettingsSection';

const fieldCls =
    'h-8 min-w-0 rounded-md border border-border bg-transparent px-3 text-xs text-primary outline-none focus:border-primary';

const builtinKey = (id: ManualControlId) =>
    id === 'drum' ? 'activeRoast.controls.drum' : `activeRoast.noteEntry.${id}`;

export function ManualControlSection() {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const controls = useRoastSettings().manualControls;

    const save = (next: ManualControlSetting[]) => updateRoastSettings({ manualControls: next });
    const patch = (id: ManualControlId, row: Partial<ManualControlSetting>) =>
        save(controls.map((item) => (item.id === id ? { ...item, ...row } : item)));

    return (
        <SettingsSection group="events">
            <SettingsSection.Header title={tk('manualControls')} description={tk('manualControlsDescription')} />
            <SettingsSection.Body>
                {controls.map((row) => {
                    const builtin = t(builtinKey(row.id));
                    return (
                        <div
                            key={row.id}
                            className="grid grid-cols-[auto_minmax(0,1fr)_5.5rem] items-center gap-2 border-b border-border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
                        >
                            <input
                                type="checkbox"
                                checked={row.enabled}
                                aria-label={builtin}
                                onChange={() => patch(row.id, { enabled: !row.enabled })}
                                className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            />
                            <input
                                value={row.label}
                                maxLength={MANUAL_CONTROL_LABEL_MAX}
                                placeholder={builtin}
                                aria-label={`${builtin} ${tk('manualControlName')}`}
                                className={fieldCls}
                                onChange={(event) => patch(row.id, { label: event.target.value })}
                                onBlur={(event) => patch(row.id, { label: event.target.value.trim() })}
                            />
                            <input
                                value={row.unit}
                                maxLength={MANUAL_CONTROL_UNIT_MAX}
                                placeholder={tk('manualControlUnit')}
                                aria-label={`${builtin} ${tk('manualControlUnit')}`}
                                className={fieldCls}
                                onChange={(event) => patch(row.id, { unit: event.target.value })}
                                onBlur={(event) => patch(row.id, { unit: event.target.value.trim() })}
                            />
                        </div>
                    );
                })}
            </SettingsSection.Body>
        </SettingsSection>
    );
}
