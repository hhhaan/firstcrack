import type { mapFirescopeMachine } from '@entities/machine';
import type { mapFirescopeGraphSettings, TemperatureUnit } from '@features/active-roast';

type Translate = (key: string) => string;

const valueText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
};

export function FirescopeGraphPreview({
    graph,
    checked,
    hasGraph,
    unit,
    disabled,
    onCheckedChange,
    onUnitChange,
    tk,
}: {
    graph: ReturnType<typeof mapFirescopeGraphSettings>;
    checked: boolean;
    hasGraph: boolean;
    unit: TemperatureUnit | null;
    disabled: boolean;
    onCheckedChange: (checked: boolean) => void;
    onUnitChange: (unit: TemperatureUnit) => void;
    tk: Translate;
}) {
    return (
        <div className="grid gap-2 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-[13px] font-medium text-primary">
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={!hasGraph || disabled}
                    onChange={(event) => onCheckedChange(event.currentTarget.checked)}
                />
                {tk('graph')}
            </label>
            <label className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                {tk('sourceUnit')}
                <select
                    value={unit ?? ''}
                    disabled={disabled}
                    className="rounded-md border border-border bg-main-bg px-2 py-1 text-primary"
                    onChange={(event) => onUnitChange(event.currentTarget.value as TemperatureUnit)}
                >
                    <option value="" disabled>
                        {tk('chooseUnit')}
                    </option>
                    <option value="C">°C</option>
                    <option value="F">°F</option>
                </select>
            </label>
            <p className="m-0 text-xs text-muted">{tk('unitNote')}</p>
            {graph.fields.some((field) => field.status !== 'mapped') && (
                <p className="m-0 text-xs text-secondary">{tk('partialGraph')}</p>
            )}
            <details>
                <summary className="cursor-pointer text-xs text-secondary">{tk('preview')}</summary>
                <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr>
                                <th className="p-1">Firescope</th>
                                <th className="p-1">FC</th>
                                <th className="p-1">{tk('mapping')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {graph.fields.map((field) => {
                                const mappedValue = field.target
                                    ?.split('.')
                                    .reduce<unknown>(
                                        (value, key) =>
                                            value && typeof value === 'object'
                                                ? (value as Record<string, unknown>)[key]
                                                : undefined,
                                        graph.patch,
                                    );
                                return (
                                    <tr key={field.field} className="border-t border-border-subtle">
                                        <td className="p-1 align-top">
                                            <span className="font-mono">{field.field}</span>
                                            <div className="max-w-64 break-words text-muted">
                                                {valueText(field.value)}
                                            </div>
                                        </td>
                                        <td className="p-1 align-top font-mono">
                                            {field.target ?? '—'}
                                            {field.status === 'mapped' && (
                                                <div className="text-muted">{valueText(mappedValue)}</div>
                                            )}
                                        </td>
                                        <td className="p-1 align-top">{tk(`mappingStatus.${field.status}`)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </details>
        </div>
    );
}

export function FirescopeMachinePreview({
    current,
    settings,
    mapping,
    imported,
    selected,
    disabled,
    onSelectedChange,
    tk,
}: {
    current: boolean;
    settings: Record<string, unknown>;
    mapping: ReturnType<typeof mapFirescopeMachine>;
    imported: boolean;
    selected: boolean;
    disabled: boolean;
    onSelectedChange: (selected: boolean) => void;
    tk: Translate;
}) {
    const enabled = Boolean(mapping.draft) && !imported;
    return (
        <div className="grid gap-2 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-[13px] font-medium text-primary">
                <input
                    type="checkbox"
                    disabled={!enabled || disabled}
                    checked={enabled && selected}
                    onChange={(event) => onSelectedChange(event.currentTarget.checked)}
                />
                {mapping.name}
                <span className="text-xs font-normal text-muted">
                    {imported ? tk('alreadyImported') : current ? tk('current') : tk('recovered')}
                </span>
            </label>
            <p className="m-0 text-xs text-secondary">
                {mapping.driver} · {mapping.transport}
            </p>
            {mapping.issues.length > 0 && (
                <ul className="m-0 grid gap-1 pl-4 text-xs text-muted">
                    {mapping.issues.map((issue) => (
                        <li key={`${issue.field}-${issue.code}`}>
                            {tk(`issues.${issue.code}`)} <span className="font-mono">({issue.field})</span>
                        </li>
                    ))}
                </ul>
            )}
            <details>
                <summary className="cursor-pointer text-xs text-secondary">{tk('addresses')}</summary>
                <div className="mt-2 grid gap-2 @[600px]:grid-cols-2">
                    <div>
                        <p className="mb-1 text-xs font-medium">Firescope</p>
                        <pre className="max-h-64 overflow-auto rounded-md bg-surface p-2 text-[11px] text-secondary">
                            {JSON.stringify(settings.connection, null, 2)}
                        </pre>
                    </div>
                    {mapping.draft && (
                        <div>
                            <p className="mb-1 text-xs font-medium">FC</p>
                            <pre className="max-h-64 overflow-auto rounded-md bg-surface p-2 text-[11px] text-secondary">
                                {JSON.stringify(mapping.draft.connectionParams, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            </details>
        </div>
    );
}
