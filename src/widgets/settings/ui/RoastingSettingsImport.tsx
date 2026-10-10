import {
    firescopeFeedbackUpdate,
    type Machine,
    mapArtisanMachine,
    mapFirescopeMachine,
    useMachines,
    VIRTUAL_ID,
} from '@entities/machine';
import {
    artisanTemperatureUnit,
    firescopeTemperatureUnit,
    importArtisanGraphSettings,
    importFirescopeGraphSettings,
    mapArtisanGraphSettings,
    mapFirescopeGraphSettings,
    type TemperatureUnit,
    useRoastSettings,
} from '@features/active-roast';
import {
    artisanSettingsKey,
    firescopeSettingsKey,
    useArtisanSettings,
    useFirescopeSettings,
} from '@features/import-roasting-settings';
import { canAddMachine, useEffectivePlan } from '@shared/lib/features';
import { FormSelect } from '@shared/ui/FormSelect';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RoastingGraphPreview, RoastingMachinePreview } from './RoastingImportPreviews';
import { SettingsSection } from './SettingsSection';

export function RoastingSettingsImport() {
    const { t } = useTranslation();
    const [product, setProduct] = useState<'Firescope' | 'Artisan'>('Firescope');
    const [confirmedVersion, setConfirmedVersion] = useState<'4.2.0' | null>(null);
    const firescopeQuery = useFirescopeSettings(product === 'Firescope');
    const artisanQuery = useArtisanSettings(product === 'Artisan');
    const query = product === 'Firescope' ? firescopeQuery : artisanQuery;
    const queryClient = useQueryClient();
    const machines = useMachines((state) => state.machines);
    const plan = useEffectivePlan();
    const roastSettings = useRoastSettings();
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [includeGraph, setIncludeGraph] = useState(true);
    const [unitOverride, setUnitOverride] = useState<TemperatureUnit | null>(null);
    const [applying, setApplying] = useState(false);
    const [result, setResult] = useState<'saved' | 'failed' | 'graphSavedMachinesFailed' | 'planLimit' | null>(null);
    const tk = (key: string, options?: Record<string, string | number>) =>
        t(
            product === 'Artisan'
                ? [`settings.artisan.${key}`, `settings.firescope.${key}`]
                : `settings.firescope.${key}`,
            options,
        );
    const snapshot = query.error ? undefined : query.data;
    const firescope = product === 'Firescope' && !firescopeQuery.error ? firescopeQuery.data : undefined;
    const artisan = product === 'Artisan' && !artisanQuery.error ? artisanQuery.data : undefined;
    const unit = artisan
        ? artisanTemperatureUnit(artisan.settings?.Mode)
        : (unitOverride ?? firescopeTemperatureUnit(firescope?.graphTemperatureUnit ?? firescope?.global?.temperature));
    const graph = artisan
        ? mapArtisanGraphSettings(artisan, roastSettings)
        : firescope
          ? mapFirescopeGraphSettings(firescope, roastSettings, unit)
          : null;
    const importedMachine = (sourceId: string | number | null, saved = machines) =>
        saved.find(
            (machine) => machine.importSource?.product === product && machine.importSource.sourceId === sourceId,
        );
    const artisanMapping = artisan?.settings ? mapArtisanMachine(artisan, confirmedVersion) : null;
    const artisanSerial = ['rtu', 'ascii'].includes(artisanMapping?.transport ?? '');
    const candidates = artisanMapping
        ? [
              {
                  sequence: 0,
                  current: true,
                  mapping: artisanMapping,
                  existing: importedMachine(artisanMapping.sourceId),
                  update: null,
                  connection: {
                      serial: artisanSerial,
                      endpoint: artisanMapping.draft?.connectionParams[artisanSerial ? 'comport' : 'host'],
                      subtype: artisanMapping.transport,
                      protocol: 'modbus',
                  },
              },
          ]
        : (firescope?.machines.map((candidate) => {
              const mapping = mapFirescopeMachine(candidate.settings);
              const existing = importedMachine(mapping.sourceId);
              const update = existing && mapping.draft ? firescopeFeedbackUpdate(existing, mapping.draft) : null;
              const raw = candidate.settings.connection as Record<string, unknown> | undefined;
              const serial = raw?.type === 'serial';
              const details = raw?.[serial ? 'serial' : 'ethernet'] as Record<string, unknown> | undefined;
              return {
                  ...candidate,
                  mapping,
                  existing,
                  update,
                  connection: {
                      serial: serial || raw?.type === 'usb',
                      endpoint: details?.[serial ? 'path' : 'ip'],
                      subtype: details?.type,
                      protocol: raw?.protocol,
                  },
              };
          }) ?? []);
    const selected = candidates.filter(
        (candidate) =>
            candidate.mapping.draft && (!candidate.existing || candidate.update) && selectedIds.has(candidate.sequence),
    );
    const hasGraph = graph !== null && Object.keys(graph.patch).length > 0;
    const busy = applying || query.isFetching;
    const newCount = selected.filter((candidate) => !candidate.existing).length;
    const withinLimit =
        newCount === 0 ||
        canAddMachine(plan, machines.filter((machine) => machine.id !== VIRTUAL_ID).length + newCount - 1);
    const canApply =
        snapshot?.status === 'found' && !busy && withinLimit && (selected.length > 0 || (includeGraph && hasGraph));

    const apply = async () => {
        if (!snapshot || !canApply) return;
        const state = useMachines.getState();
        const newCount = selected.filter(({ mapping }) => !importedMachine(mapping.sourceId, state.machines)).length;
        if (
            newCount > 0 &&
            !canAddMachine(plan, state.machines.filter((machine) => machine.id !== VIRTUAL_ID).length + newCount - 1)
        ) {
            setResult('planLimit');
            return;
        }
        setApplying(true);
        setResult(null);
        let graphApplied = false;
        try {
            if (includeGraph && hasGraph) {
                if (artisan) await importArtisanGraphSettings(artisan);
                else if (firescope) await importFirescopeGraphSettings(firescope, unit);
                graphApplied = true;
            }
            const latest = useMachines.getState();
            const pending: Omit<Machine, 'id' | 'createdAt'>[] = [];
            const updates: { id: string; patch: Pick<Machine, 'connectionParams' | 'capabilities'> }[] = [];
            for (const { mapping } of selected) {
                if (!mapping.draft) continue;
                const existing = importedMachine(mapping.sourceId, latest.machines);
                if (!existing) pending.push(mapping.draft);
                else if (product === 'Firescope') {
                    const patch = firescopeFeedbackUpdate(existing, mapping.draft);
                    if (patch) updates.push({ id: existing.id, patch });
                }
            }
            if (pending.length > 0 || updates.length > 0) {
                if (
                    pending.length > 0 &&
                    !canAddMachine(
                        plan,
                        latest.machines.filter((machine) => machine.id !== VIRTUAL_ID).length + pending.length - 1,
                    )
                )
                    throw new Error('machine limit');
                latest.importMachines(pending, updates);
            }
            setResult('saved');
        } catch {
            setResult(graphApplied ? 'graphSavedMachinesFailed' : 'failed');
        } finally {
            setApplying(false);
        }
    };

    return (
        <SettingsSection group="import">
            <SettingsSection.Header title={tk('title')} description={tk('description')} />
            <SettingsSection.Body className="grid gap-3">
                <label className="flex flex-wrap items-center gap-3 text-xs text-secondary">
                    {t('settings.roastingImport.source')}
                    <FormSelect
                        value={product}
                        disabled={applying}
                        wrapperClassName="w-40"
                        className="h-8 py-1 text-xs"
                        onChange={(event) => {
                            setProduct(event.currentTarget.value as 'Firescope' | 'Artisan');
                            setSelectedIds(new Set());
                            setUnitOverride(null);
                            setConfirmedVersion(null);
                            setResult(null);
                        }}
                    >
                        <option value="Firescope">Firescope</option>
                        <option value="Artisan">Artisan</option>
                    </FormSelect>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="m-0 text-xs text-secondary" role="status">
                        {query.isFetching
                            ? tk('searching')
                            : query.error
                              ? tk('scanFailed')
                              : snapshot
                                ? tk(`status.${snapshot.status}`)
                                : tk('searching')}
                    </p>
                    <SurfaceButton
                        disabled={busy}
                        onClick={() => {
                            setResult(null);
                            setSelectedIds(new Set());
                            setUnitOverride(null);
                            setConfirmedVersion(null);
                            void queryClient.invalidateQueries({
                                queryKey: product === 'Firescope' ? firescopeSettingsKey : artisanSettingsKey,
                            });
                        }}
                    >
                        {tk('rescan')}
                    </SurfaceButton>
                </div>
                {snapshot?.status === 'found' && (
                    <>
                        {artisan && artisan.source.version === null && (
                            <label className="flex items-start gap-3 text-xs text-secondary">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                    checked={confirmedVersion !== null}
                                    disabled={applying}
                                    onChange={(event) => {
                                        setConfirmedVersion(event.currentTarget.checked ? '4.2.0' : null);
                                        setSelectedIds(new Set());
                                    }}
                                />
                                <span>{tk('confirmVersion')}</span>
                            </label>
                        )}
                        <div className="min-w-0 overflow-hidden rounded-xl border border-border">
                            <div className="border-b border-border-subtle px-4 py-3">
                                <h3 className="m-0 text-[13px] font-medium text-primary">{tk('machineHeading')}</h3>
                                <p className="mb-0 mt-1 text-xs text-muted">{tk('machineHint')}</p>
                            </div>
                            <div className="divide-y divide-border-subtle">
                                {candidates.map(({ sequence, current, connection, mapping, existing, update }) => (
                                    <RoastingMachinePreview
                                        key={sequence}
                                        current={current}
                                        connection={connection}
                                        mapping={mapping}
                                        imported={Boolean(existing) && !update}
                                        updateAvailable={Boolean(update)}
                                        selected={selectedIds.has(sequence)}
                                        disabled={applying}
                                        onSelectedChange={(checked) =>
                                            setSelectedIds((previous) => {
                                                const next = new Set(previous);
                                                if (checked) next.add(sequence);
                                                else next.delete(sequence);
                                                return next;
                                            })
                                        }
                                        tk={tk}
                                    />
                                ))}
                                {candidates.length === 0 && (
                                    <p className="m-0 p-4 text-xs text-muted">{tk('noMachines')}</p>
                                )}
                            </div>
                        </div>
                        {graph && graph.fields.length > 0 && (
                            <RoastingGraphPreview
                                graph={graph}
                                previous={roastSettings}
                                checked={includeGraph}
                                hasGraph={hasGraph}
                                unit={unit}
                                disabled={applying}
                                onCheckedChange={setIncludeGraph}
                                onUnitChange={setUnitOverride}
                                unitEditable={product === 'Firescope'}
                                tk={tk}
                            />
                        )}
                        <p className="m-0 text-xs text-muted">{tk('applyNote')}</p>
                        {!withinLimit && (
                            <p className="m-0 text-xs text-secondary" role="alert">
                                {tk('planLimit')}
                            </p>
                        )}
                        <PillButton
                            type="button"
                            disabled={!canApply}
                            className="justify-center disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => void apply()}
                        >
                            {applying
                                ? tk('saving')
                                : selected.length > 0
                                  ? tk(includeGraph && hasGraph ? 'applyBoth' : 'applyMachines', {
                                        count: selected.length,
                                    })
                                  : tk(includeGraph && hasGraph ? 'applyGraph' : 'apply')}
                        </PillButton>
                    </>
                )}
                {result && (
                    <p
                        className={`m-0 text-xs ${result === 'failed' || result === 'graphSavedMachinesFailed' ? 'text-phase-danger' : 'text-secondary'}`}
                        role={result === 'failed' || result === 'graphSavedMachinesFailed' ? 'alert' : 'status'}
                    >
                        {tk(result)}
                    </p>
                )}
            </SettingsSection.Body>
        </SettingsSection>
    );
}
