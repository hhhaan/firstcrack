import { isSimulatorMachine, useVisibleMachines } from '@entities/machine';
import {
    MANUAL_CONTROL_LABEL_MAX,
    MANUAL_CONTROL_RANGE_LIMIT,
    MANUAL_CONTROL_UNIT_MAX,
    type ManualControlId,
    type ManualControlSetting,
    manualControlsFor,
} from '@features/active-roast/lib/manual-controls';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { sanitizeDecimal } from '@shared/lib/format';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

const fieldCls =
    'h-8 min-w-0 rounded-md border border-border bg-transparent px-3 text-xs text-primary outline-none focus:border-primary';

const builtinKey = (id: ManualControlId) =>
    id === 'drum' ? 'activeRoast.controls.drum' : `activeRoast.noteEntry.${id}`;

const rangeDraft = (value: string) => {
    const negative = value.trim().startsWith('-');
    const body = sanitizeDecimal(value);
    if (!body) return negative ? '-' : '';
    return `${negative ? '-' : ''}${body}`;
};

function RangeBoundInput({
    value,
    ariaLabel,
    onCommit,
}: {
    value: number;
    ariaLabel: string;
    onCommit: (next: number) => boolean;
}) {
    const [text, setText] = useState(() => String(value));
    const focused = useRef(false);

    useEffect(() => {
        if (!focused.current) setText(String(value));
    }, [value]);

    return (
        <input
            value={text}
            inputMode="decimal"
            aria-label={ariaLabel}
            className={`${fieldCls} w-16 px-2 text-right`}
            onFocus={() => {
                focused.current = true;
            }}
            onChange={(event) => setText(rangeDraft(event.target.value))}
            onBlur={() => {
                focused.current = false;
                const parsed = Number(text);
                if (!Number.isFinite(parsed) || parsed === value || !onCommit(parsed)) setText(String(value));
            }}
        />
    );
}

export function ManualControlSection() {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const settings = useRoastSettings();
    const { recordVirtualControls } = settings;
    const machines = useVisibleMachines();
    const [pickedId, setPickedId] = useState<string | null>(null);
    const selectedId = machines.some((machine) => machine.id === pickedId)
        ? pickedId
        : (machines.find((machine) => !isSimulatorMachine(machine.id))?.id ?? machines[0]?.id ?? null);
    const controls = manualControlsFor(settings, selectedId);

    const save = (next: ManualControlSetting[]) => {
        if (!selectedId) {
            updateRoastSettings({ manualControls: next });
            return;
        }
        updateRoastSettings({
            manualControlsByMachine: { ...settings.manualControlsByMachine, [selectedId]: next },
        });
    };
    const patch = (id: ManualControlId, row: Partial<ManualControlSetting>) =>
        save(controls.map((item) => (item.id === id ? { ...item, ...row } : item)));
    const commitRange = (id: ManualControlId, bound: 'min' | 'max', parsed: number) => {
        if (parsed < -MANUAL_CONTROL_RANGE_LIMIT || parsed > MANUAL_CONTROL_RANGE_LIMIT) return false;
        const row = controls.find((item) => item.id === id);
        if (!row) return false;
        const min = bound === 'min' ? parsed : row.min;
        const max = bound === 'max' ? parsed : row.max;
        if (min >= max) return false;
        patch(id, { min, max });
        return true;
    };

    return (
        <SettingsSection group="events">
            <SettingsSection.Header title={tk('manualControls')} description={tk('manualControlsDescription')} />
            <SettingsSection.Body>
                <SettingsCheckRow
                    checked={recordVirtualControls}
                    label={tk('recordVirtualControls')}
                    description={tk('recordVirtualControlsDescription')}
                    onChange={() => updateRoastSettings({ recordVirtualControls: !recordVirtualControls })}
                />
                {selectedId && (
                    <Select value={selectedId} onValueChange={setPickedId}>
                        <SelectTrigger className="my-4 w-full" aria-label={tk('manualControlMachine')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {machines.map((machine) => (
                                <SelectItem key={machine.id} value={machine.id}>
                                    {machine.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {controls.map((row) => {
                    const builtin = t(builtinKey(row.id));
                    return (
                        <div
                            key={row.id}
                            className="grid grid-cols-[auto_minmax(0,1fr)_auto_5.5rem] items-center gap-2 border-b border-border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0"
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
                            <div className="flex items-center gap-1">
                                <RangeBoundInput
                                    value={row.min}
                                    ariaLabel={`${builtin} ${tk('manualControlMin')}`}
                                    onCommit={(next) => commitRange(row.id, 'min', next)}
                                />
                                <span className="text-xs text-muted" aria-hidden="true">
                                    –
                                </span>
                                <RangeBoundInput
                                    value={row.max}
                                    ariaLabel={`${builtin} ${tk('manualControlMax')}`}
                                    onCommit={(next) => commitRange(row.id, 'max', next)}
                                />
                            </div>
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
