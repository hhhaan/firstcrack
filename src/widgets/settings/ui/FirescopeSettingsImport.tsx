import { firescopeFeedbackUpdate, type Machine, mapFirescopeMachine, useMachines, VIRTUAL_ID } from '@entities/machine';
import {
    firescopeTemperatureUnit,
    importFirescopeGraphSettings,
    mapFirescopeGraphSettings,
    type TemperatureUnit,
    useRoastSettings,
} from '@features/active-roast';
import { firescopeSettingsKey, useFirescopeSettings } from '@features/import-roasting-settings';
import { canAddMachine, useEffectivePlan } from '@shared/lib/features';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FirescopeGraphPreview, FirescopeMachinePreview } from './FirescopeImportPreviews';
import { SettingsSection } from './SettingsSection';

export function FirescopeSettingsImport() {
    const { t } = useTranslation();
    const query = useFirescopeSettings();
    const queryClient = useQueryClient();
    const machines = useMachines((state) => state.machines);
    const plan = useEffectivePlan();
    const roastSettings = useRoastSettings();
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [includeGraph, setIncludeGraph] = useState(true);
    const [unitOverride, setUnitOverride] = useState<TemperatureUnit | null>(null);
    const [applying, setApplying] = useState(false);
    const [result, setResult] = useState<'saved' | 'failed' | 'graphSavedMachinesFailed' | 'planLimit' | null>(null);
    const tk = (key: string, options?: Record<string, string | number>) => t(`settings.firescope.${key}`, options);
    const snapshot = query.error ? undefined : query.data;
    const unit =
        unitOverride ?? firescopeTemperatureUnit(snapshot?.graphTemperatureUnit ?? snapshot?.global?.temperature);
    const graph = snapshot ? mapFirescopeGraphSettings(snapshot, roastSettings, unit) : null;
    const importedMachine = (sourceId: string | number | null, saved = machines) =>
        saved.find(
            (machine) => machine.importSource?.product === 'Firescope' && machine.importSource.sourceId === sourceId,
        );
    const candidates =
        snapshot?.machines.map((candidate) => {
            const mapping = mapFirescopeMachine(candidate.settings);
            const existing = importedMachine(mapping.sourceId);
            const update = existing && mapping.draft ? firescopeFeedbackUpdate(existing, mapping.draft) : null;
            return { ...candidate, mapping, existing, update };
        }) ?? [];
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
                await importFirescopeGraphSettings(snapshot, unit);
                graphApplied = true;
            }
            const latest = useMachines.getState();
            const pending: Omit<Machine, 'id' | 'createdAt'>[] = [];
            const updates: { id: string; patch: Pick<Machine, 'connectionParams' | 'capabilities'> }[] = [];
            for (const { mapping } of selected) {
                if (!mapping.draft) continue;
                const existing = importedMachine(mapping.sourceId, latest.machines);
                if (!existing) pending.push(mapping.draft);
                else {
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
                            void queryClient.invalidateQueries({ queryKey: firescopeSettingsKey });
                        }}
                    >
                        {tk('rescan')}
                    </SurfaceButton>
                </div>
                {snapshot?.status === 'found' && (
                    <>
                        <div className="min-w-0 overflow-hidden rounded-xl border border-border">
                            <div className="border-b border-border-subtle px-4 py-3">
                                <h3 className="m-0 text-[13px] font-medium text-primary">{tk('machineHeading')}</h3>
                                <p className="mb-0 mt-1 text-xs text-muted">{tk('machineHint')}</p>
                            </div>
                            <div className="divide-y divide-border-subtle">
                                {candidates.map(({ sequence, current, settings, mapping, existing, update }) => (
                                    <FirescopeMachinePreview
                                        key={sequence}
                                        current={current}
                                        settings={settings}
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
                            <FirescopeGraphPreview
                                graph={graph}
                                previous={roastSettings}
                                checked={includeGraph}
                                hasGraph={hasGraph}
                                unit={unit}
                                disabled={applying}
                                onCheckedChange={setIncludeGraph}
                                onUnitChange={setUnitOverride}
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
