import { isSimulatorMachine, useMachines, useVisibleMachines } from '@entities/machine';
import {
    isBuiltinManualControlId,
    isVirtualControlId,
    MANUAL_CONTROL_IDS,
    MANUAL_CONTROL_LABEL_MAX,
    MANUAL_CONTROL_RANGE_LIMIT,
    MANUAL_CONTROL_UNIT_MAX,
    type ManualControlSetting,
    manualControlsFor,
    newVirtualControl,
    VIRTUAL_CONTROL_LIMIT,
    type VirtualControlNameError,
    virtualControlNameError,
} from '@features/active-roast/lib/manual-controls';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useSidecarStatus } from '@features/machine-control/api/useSidecarStatus';
import { sanitizeDecimal } from '@shared/lib/format';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

const fieldCls =
    'h-8 min-w-0 rounded-md border border-border bg-transparent px-3 text-xs text-primary outline-none focus:border-primary';

const builtinKey = (id: (typeof MANUAL_CONTROL_IDS)[number]) =>
    id === 'drum' ? 'activeRoast.controls.drum' : `activeRoast.noteEntry.${id}`;

const addBtnCls =
    'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-transparent px-3 text-[13px] font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

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

function LabelInput({
    value,
    ariaLabel,
    onCommit,
}: {
    value: string;
    ariaLabel: string;
    onCommit: (next: string) => boolean;
}) {
    const [text, setText] = useState(value);
    const focused = useRef(false);

    useEffect(() => {
        if (!focused.current) setText(value);
    }, [value]);

    return (
        <input
            value={text}
            maxLength={MANUAL_CONTROL_LABEL_MAX}
            aria-label={ariaLabel}
            className={fieldCls}
            onFocus={() => {
                focused.current = true;
            }}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
                focused.current = false;
                const next = text.trim();
                if (!next || next === value || !onCommit(next)) setText(value);
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
    const allMachines = useMachines((state) => state.machines);
    const { data: status } = useSidecarStatus(true);
    const activeMachineId = useRoastingStore((state) => state.machineSnapshot?.machine_id);
    const activeMachine = allMachines.find((machine) =>
        status?.connected
            ? machine.id === status.machine_id && machine.roasterKey === status.roaster
            : machine.id === activeMachineId,
    );
    const orderedMachines = activeMachine
        ? [activeMachine, ...machines.filter((machine) => machine.id !== activeMachine.id)]
        : machines;
    const [pickedId, setPickedId] = useState<string | null>(null);
    const selectedId = orderedMachines.some((machine) => machine.id === pickedId)
        ? pickedId
        : (activeMachine?.id ??
          machines.find((machine) => !isSimulatorMachine(machine.id))?.id ??
          machines[0]?.id ??
          null);
    const controls = manualControlsFor(settings, selectedId);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<VirtualControlNameError | null>(null);
    const virtuals = controls.filter((row) => isVirtualControlId(row.id));
    const atLimit = virtuals.length >= VIRTUAL_CONTROL_LIMIT;

    const save = (next: ManualControlSetting[]) => {
        if (!selectedId) {
            updateRoastSettings({ manualControls: next });
            return;
        }
        updateRoastSettings({
            manualControlsByMachine: { ...settings.manualControlsByMachine, [selectedId]: next },
        });
    };
    const patch = (id: string, row: Partial<ManualControlSetting>) =>
        save(controls.map((item) => (item.id === id ? { ...item, ...row } : item)));
    const commitRange = (id: string, bound: 'min' | 'max', parsed: number) => {
        if (parsed < -MANUAL_CONTROL_RANGE_LIMIT || parsed > MANUAL_CONTROL_RANGE_LIMIT) return false;
        const row = controls.find((item) => item.id === id);
        if (!row) return false;
        const min = bound === 'min' ? parsed : row.min;
        const max = bound === 'max' ? parsed : row.max;
        if (min >= max) return false;
        patch(id, { min, max });
        return true;
    };
    const add = () => {
        const nameError = virtualControlNameError(
            draft,
            [...MANUAL_CONTROL_IDS.map((id) => t(builtinKey(id))), ...virtuals.map((row) => row.label)],
            atLimit,
        );
        if (nameError) {
            setError(nameError);
            return;
        }
        save([...controls, newVirtualControl(draft)]);
        setDraft('');
        setError(null);
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
                            {orderedMachines.map((machine) => (
                                <SelectItem key={machine.id} value={machine.id}>
                                    {machine.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {controls.map((row) => {
                    if (isBuiltinManualControlId(row.id)) {
                        const builtin = t(builtinKey(row.id));
                        return (
                            <div
                                key={row.id}
                                className="flex items-center gap-2.5 border-b border-border-subtle py-3 first:pt-0"
                            >
                                <input
                                    type="checkbox"
                                    checked={row.enabled}
                                    aria-label={builtin}
                                    onChange={() => patch(row.id, { enabled: !row.enabled })}
                                    className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                />
                                <span className="min-w-0 flex-1 text-[13px] font-medium text-primary">{builtin}</span>
                                <span className="text-xs text-muted">{row.unit}</span>
                            </div>
                        );
                    }
                    const name = row.label;
                    return (
                        <div
                            key={row.id}
                            className="grid grid-cols-[auto_minmax(0,1fr)_auto_5.5rem_auto] items-center gap-2 border-b border-border-subtle py-3"
                        >
                            <input
                                type="checkbox"
                                checked={row.enabled}
                                aria-label={name}
                                onChange={() => patch(row.id, { enabled: !row.enabled })}
                                className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            />
                            <LabelInput
                                value={row.label}
                                ariaLabel={`${name} ${tk('manualControlName')}`}
                                onCommit={(label) => {
                                    const taken =
                                        virtuals.some((item) => item.id !== row.id && item.label.trim() === label) ||
                                        MANUAL_CONTROL_IDS.some((id) => t(builtinKey(id)) === label);
                                    if (taken) return false;
                                    patch(row.id, { label });
                                    return true;
                                }}
                            />
                            <div className="flex items-center gap-1">
                                <RangeBoundInput
                                    value={row.min}
                                    ariaLabel={`${name} ${tk('manualControlMin')}`}
                                    onCommit={(next) => commitRange(row.id, 'min', next)}
                                />
                                <span className="text-xs text-muted" aria-hidden="true">
                                    –
                                </span>
                                <RangeBoundInput
                                    value={row.max}
                                    ariaLabel={`${name} ${tk('manualControlMax')}`}
                                    onCommit={(next) => commitRange(row.id, 'max', next)}
                                />
                            </div>
                            <input
                                value={row.unit}
                                maxLength={MANUAL_CONTROL_UNIT_MAX}
                                placeholder={tk('manualControlUnit')}
                                aria-label={`${name} ${tk('manualControlUnit')}`}
                                className={fieldCls}
                                onChange={(event) => patch(row.id, { unit: event.target.value })}
                                onBlur={(event) => patch(row.id, { unit: event.target.value.trim() })}
                            />
                            <button
                                type="button"
                                className="cursor-pointer rounded-md border-none bg-transparent p-1.5 text-[#9CA3AF] hover:text-red-600"
                                aria-label={tk('manualControlRemove')}
                                onClick={() => save(controls.filter((item) => item.id !== row.id))}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    );
                })}
                <div className="flex items-center gap-2 py-3">
                    <input
                        value={draft}
                        maxLength={MANUAL_CONTROL_LABEL_MAX}
                        placeholder={tk('manualControlName')}
                        aria-label={tk('manualControlName')}
                        aria-invalid={error != null}
                        aria-describedby={error ? 'manual-control-name-error' : undefined}
                        className={fieldCls}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            if (error) setError(null);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                add();
                            }
                        }}
                    />
                    <button type="button" className={addBtnCls} disabled={atLimit} onClick={add}>
                        {tk('manualControlAdd')}
                    </button>
                </div>
                {error ? (
                    <p
                        id="manual-control-name-error"
                        role="alert"
                        className="m-0 text-xs text-red-600 dark:text-red-400"
                    >
                        {tk(error === 'limit' ? 'manualControlLimit' : 'manualControlNameInvalid')}
                    </p>
                ) : null}
            </SettingsSection.Body>
        </SettingsSection>
    );
}
