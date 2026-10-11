import type { ArtisanMachineMapping, CropsterMachineMapping, mapFirescopeMachine } from '@entities/machine';
import {
    type mapFirescopeGraphSettings,
    type TemperatureUnit,
    toDisplayRoR,
    toDisplayTemp,
    type useRoastSettings,
} from '@features/active-roast';
import { Badge } from '@shared/ui/Badge';
import { FormSelect } from '@shared/ui/FormSelect';

type Translate = (key: string, options?: Record<string, string | number>) => string;

const readValue = (value: unknown, path: string): unknown =>
    path
        .split('.')
        .reduce<unknown>(
            (current, key) =>
                current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined,
            value,
        );

const temperature = (value: number, displayUnit: TemperatureUnit) =>
    `${Math.round(toDisplayTemp(value, displayUnit) * 10) / 10} °${displayUnit}`;

function ColorSample({ color }: { color: string }) {
    return (
        <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true" className="shrink-0">
            <path d="M2 6H26" stroke={color} strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

export function RoastingGraphPreview({
    graph,
    previous,
    checked,
    hasGraph,
    unit,
    disabled,
    onCheckedChange,
    onUnitChange,
    unitEditable = true,
    tk,
}: {
    graph: ReturnType<typeof mapFirescopeGraphSettings>;
    previous: ReturnType<typeof useRoastSettings>;
    checked: boolean;
    hasGraph: boolean;
    unit: TemperatureUnit | null;
    disabled: boolean;
    onCheckedChange: (checked: boolean) => void;
    onUnitChange: (unit: TemperatureUnit) => void;
    unitEditable?: boolean;
    tk: Translate;
}) {
    const mapped = graph.fields.filter(
        (field): field is typeof field & { target: string } =>
            field.status === 'mapped' && typeof field.target === 'string',
    );
    const colors = mapped.filter((field) => field.target.endsWith('.color'));
    const renderValue = (target: string, value: unknown, displayUnit: TemperatureUnit) => {
        if (target.endsWith('.color')) {
            return (
                <span className="inline-flex items-center gap-1.5">
                    {typeof value === 'string' && <ColorSample color={value} />}
                    {typeof value === 'string' ? value : tk('defaultColor')}
                </span>
            );
        }
        if (target === 'temperatureUnit') return `°${value}`;
        if ((target === 'tempMinC' || target === 'tempMaxC') && typeof value === 'number')
            return temperature(value, displayUnit);
        if ((target === 'rorYMin' || target === 'rorYMax') && typeof value === 'number')
            return `${Math.round(toDisplayRoR(value, displayUnit) * 10) / 10} °${displayUnit}/min`;
        if (target === 'timeRangeMin' && typeof value === 'number') return tk('minutes', { value });
        if (target === 'timeTickIntervalSec' && typeof value === 'number') return tk('seconds', { value });
        if (typeof value === 'boolean') return tk(value ? 'show' : 'hide');
        return value == null ? '—' : String(value);
    };

    return (
        <div className="min-w-0 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-w-0 items-start gap-3">
                    <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        checked={checked}
                        disabled={!hasGraph || disabled}
                        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
                    />
                    <span>
                        <span className="block text-[13px] font-medium text-primary">{tk('graph')}</span>
                        <span className="mt-0.5 block text-xs text-muted">{tk('graphHint')}</span>
                    </span>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                    {tk('sourceUnit')}
                    <FormSelect
                        value={unit ?? ''}
                        disabled={disabled || !unitEditable}
                        wrapperClassName="w-24"
                        className="h-8 py-1 text-xs"
                        onChange={(event) => onUnitChange(event.currentTarget.value as TemperatureUnit)}
                    >
                        <option value="" disabled>
                            {tk('chooseUnit')}
                        </option>
                        <option value="C">°C</option>
                        <option value="F">°F</option>
                    </FormSelect>
                </label>
            </div>
            <dl className="mb-0 mt-4 grid gap-3 text-xs @[500px]:grid-cols-3">
                {unit && typeof graph.patch.tempMinC === 'number' && typeof graph.patch.tempMaxC === 'number' && (
                    <div>
                        <dt className="text-muted">{tk('tempRange')}</dt>
                        <dd className="m-0 mt-1 text-[13px] font-medium text-primary">
                            {temperature(graph.patch.tempMinC, unit)} – {temperature(graph.patch.tempMaxC, unit)}
                        </dd>
                    </div>
                )}
                {typeof graph.patch.timeRangeMin === 'number' && (
                    <div>
                        <dt className="text-muted">{tk('timeRange')}</dt>
                        <dd className="m-0 mt-1 text-[13px] font-medium text-primary">
                            {tk('minutes', { value: graph.patch.timeRangeMin })}
                        </dd>
                    </div>
                )}
                {colors.length > 0 && (
                    <div>
                        <dt className="text-muted">{tk('curveColors')}</dt>
                        <dd className="m-0 mt-1 flex flex-wrap gap-x-3 gap-y-1.5 text-primary">
                            {colors.map((field) => (
                                <span key={field.field} className="inline-flex items-center gap-1">
                                    <ColorSample color={String(field.value)} />
                                    {tk(`graphFields.${field.field}`)}
                                </span>
                            ))}
                        </dd>
                    </div>
                )}
            </dl>
            {!unit && <p className="mb-0 mt-3 text-xs text-secondary">{tk('unknownUnit')}</p>}
            {graph.fields.some((field) => field.status !== 'mapped') && (
                <p className="mb-0 mt-3 text-xs text-muted">{tk('partialGraph')}</p>
            )}
            <details className="mt-3">
                <summary className="cursor-pointer text-xs text-secondary">{tk('details')}</summary>
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="text-muted">
                            <tr>
                                <th className="pb-2 pr-3 font-normal" aria-label={tk('chooseSettings')} />
                                <th className="pb-2 pr-3 font-normal">{tk('currentValue')}</th>
                                <th className="pb-2 font-normal">{tk('importedValue')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mapped.map((field) => (
                                <tr key={field.field} className="border-t border-border-subtle">
                                    <th className="py-2 pr-3 text-primary font-normal">
                                        {tk(`graphFields.${field.field}`)}
                                    </th>
                                    <td className="py-2 pr-3 text-muted">
                                        {renderValue(
                                            field.target,
                                            readValue(previous, field.target),
                                            previous.temperatureUnit,
                                        )}
                                    </td>
                                    <td className="py-2 text-primary">
                                        {renderValue(
                                            field.target,
                                            readValue(graph.patch, field.target),
                                            unit ?? previous.temperatureUnit,
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {graph.fields.some((field) => field.status === 'invalid') && (
                    <p className="mt-2 text-xs text-muted">{tk('invalidGraph')}</p>
                )}
            </details>
        </div>
    );
}

type MachineMapping = ReturnType<typeof mapFirescopeMachine> | ArtisanMachineMapping | CropsterMachineMapping;
type MachineConnection = { serial: boolean; endpoint: unknown; subtype: unknown; protocol: unknown };

const machineBadgeKey = (mapping: MachineMapping, imported: boolean, updateAvailable: boolean, current: boolean) => {
    if (imported) return 'alreadyImported';
    if (!mapping.draft) return 'manualSetup';
    if (updateAvailable) return 'updateAvailable';
    if (current) return 'current';
    return 'recovered';
};

const connectionSummary = (connection: MachineConnection, tk: Translate) => {
    const link = connection.serial ? tk('usb') : tk('network');
    const protocol =
        connection.protocol === 'modbus' ? 'Modbus' : connection.protocol === 's7' ? 'Siemens S7' : tk('dedicated');
    const subtype =
        typeof connection.subtype === 'string' && ['rtu', 'ascii', 'tcp', 'udp'].includes(connection.subtype)
            ? ` ${connection.subtype.toUpperCase()}`
            : '';
    return `${link} · ${protocol}${subtype}`;
};

const feedbackSummary = (mapping: MachineMapping, tk: Translate) =>
    mapping.draft?.capabilities.map((role) => {
        const params = mapping.draft?.connectionParams;
        const channel = Array.isArray(params?.channels)
            ? params.channels.find((value) => readValue(value, 'role') === role)
            : readValue(params?.modbus_registers, role);
        const unit = readValue(channel, 'unit');
        return `${tk(`feedback.${role === 'fan' && unit === 'Pa' ? 'airPressure' : role}`)} (${unit})`;
    }) ?? [];

const blockingIssue = (mapping: MachineMapping) =>
    mapping.issues.find((issue) => !mapping.draft || issue.code !== 'unsupported-channel');

const machineSelectable = (draft: unknown, imported: boolean) => Boolean(draft) && !imported;

const previewRowClass = (enabled: boolean, selected: boolean) =>
    enabled && selected ? 'min-w-0 bg-surface-warm' : 'min-w-0';

const previewDisabled = (enabled: boolean, disabled: boolean) => !enabled || disabled;

const previewChecked = (enabled: boolean, selected: boolean) => enabled && selected;

const extraSensorNote = (blocking: unknown, issueCount: number) => !blocking && issueCount > 0;

function MachinePreviewDetails({
    endpoint,
    blockingCode,
    feedback,
    extraSensors,
    tk,
}: {
    endpoint: unknown;
    blockingCode: string | null;
    feedback: string[];
    extraSensors: boolean;
    tk: Translate;
}) {
    return (
        <>
            {typeof endpoint === 'string' && (
                <span className="mt-1 block truncate text-xs text-muted" title={endpoint}>
                    {endpoint}
                </span>
            )}
            {blockingCode && <span className="mt-2 block text-xs text-muted">{tk(`issues.${blockingCode}`)}</span>}
            {feedback.length > 0 && <span className="mt-2 block text-xs text-secondary">{feedback.join(' · ')}</span>}
            {extraSensors && <span className="mt-2 block text-xs text-muted">{tk('extraSensors')}</span>}
        </>
    );
}

export function RoastingMachinePreview({
    current,
    connection,
    mapping,
    imported,
    updateAvailable,
    selected,
    disabled,
    onSelectedChange,
    tk,
}: {
    current: boolean;
    connection: MachineConnection;
    mapping: MachineMapping;
    imported: boolean;
    updateAvailable: boolean;
    selected: boolean;
    disabled: boolean;
    onSelectedChange: (selected: boolean) => void;
    tk: Translate;
}) {
    const enabled = machineSelectable(mapping.draft, imported);
    const blocking = blockingIssue(mapping);
    return (
        <div className={previewRowClass(enabled, selected)}>
            <label className="flex items-start gap-3 p-4">
                <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    disabled={previewDisabled(enabled, disabled)}
                    checked={previewChecked(enabled, selected)}
                    onChange={(event) => onSelectedChange(event.currentTarget.checked)}
                />
                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-primary">{mapping.name}</span>
                        <Badge size="sm">{tk(machineBadgeKey(mapping, imported, updateAvailable, current))}</Badge>
                    </span>
                    <span className="mt-1 block text-xs text-secondary">{connectionSummary(connection, tk)}</span>
                    <MachinePreviewDetails
                        endpoint={connection.endpoint}
                        blockingCode={blocking?.code ?? null}
                        feedback={feedbackSummary(mapping, tk)}
                        extraSensors={extraSensorNote(blocking, mapping.issues.length)}
                        tk={tk}
                    />
                </span>
            </label>
        </div>
    );
}
