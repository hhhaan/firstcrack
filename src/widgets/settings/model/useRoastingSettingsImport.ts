import {
    firescopeFeedbackUpdate,
    type Machine,
    mapArtisanMachine,
    mapCropsterMachine,
    mapFirescopeMachine,
    useMachines,
    VIRTUAL_ID,
} from '@entities/machine';
import {
    artisanTemperatureUnit,
    cropsterTemperatureUnit,
    firescopeTemperatureUnit,
    importArtisanGraphSettings,
    importCropsterGraphSettings,
    importFirescopeGraphSettings,
    mapArtisanGraphSettings,
    mapCropsterGraphSettings,
    mapFirescopeGraphSettings,
    type TemperatureUnit,
    useRoastSettings,
} from '@features/active-roast';
import {
    artisanSettingsKey,
    cropsterSettingsKey,
    firescopeSettingsKey,
    useArtisanSettings,
    useCropsterSettings,
    useFirescopeSettings,
} from '@features/import-roasting-settings';
import { canAddMachine, useEffectivePlan } from '@shared/lib/features';
import { useQueryClient } from '@tanstack/react-query';
import { platform } from '@tauri-apps/plugin-os';
import { useState } from 'react';

export function useRoastingSettingsImport() {
    const [platformSupported] = useState(() => {
        try {
            return platform() === 'macos';
        } catch {
            return /Macintosh/i.test(navigator.userAgent);
        }
    });
    const [product, setProduct] = useState<'Firescope' | 'Artisan' | 'Cropster'>('Firescope');
    const [confirmedVersion, setConfirmedVersion] = useState<'4.2.0' | null>(null);
    const firescopeQuery = useFirescopeSettings(platformSupported && product === 'Firescope');
    const artisanQuery = useArtisanSettings(platformSupported && product === 'Artisan');
    const cropsterQuery = useCropsterSettings(platformSupported && product === 'Cropster');
    const query = { Firescope: firescopeQuery, Artisan: artisanQuery, Cropster: cropsterQuery }[product];
    const queryClient = useQueryClient();
    const machines = useMachines((state) => state.machines);
    const plan = useEffectivePlan();
    const roastSettings = useRoastSettings();
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [includeGraph, setIncludeGraph] = useState(true);
    const [unitOverride, setUnitOverride] = useState<TemperatureUnit | null>(null);
    const [applying, setApplying] = useState(false);
    const [result, setResult] = useState<'saved' | 'failed' | 'graphSavedMachinesFailed' | 'planLimit' | null>(null);
    const snapshot = query.error ? undefined : query.data;
    const firescope = product === 'Firescope' && !firescopeQuery.error ? firescopeQuery.data : undefined;
    const artisan = product === 'Artisan' && !artisanQuery.error ? artisanQuery.data : undefined;
    const cropster = product === 'Cropster' && !cropsterQuery.error ? cropsterQuery.data : undefined;
    const unit = artisan
        ? artisanTemperatureUnit(artisan.settings?.Mode)
        : cropster
          ? cropsterTemperatureUnit(cropster.preferences?.temperatureUnit)
          : (unitOverride ??
            firescopeTemperatureUnit(firescope?.graphTemperatureUnit ?? firescope?.global?.temperature));
    const graph = artisan
        ? mapArtisanGraphSettings(artisan, roastSettings)
        : cropster
          ? mapCropsterGraphSettings(cropster, roastSettings)
          : firescope
            ? mapFirescopeGraphSettings(firescope, roastSettings, unit)
            : null;
    const importedMachine = (sourceId: string | number | null, saved = machines) =>
        saved.find(
            (machine) => machine.importSource?.product === product && machine.importSource.sourceId === sourceId,
        );
    const singleMapping = artisan?.settings
        ? mapArtisanMachine(artisan, confirmedVersion)
        : cropster?.machine
          ? mapCropsterMachine(cropster)
          : null;
    const serialConnection = ['rtu', 'ascii'].includes(singleMapping?.transport ?? '');
    const candidates = singleMapping
        ? [
              {
                  sequence: 0,
                  current: product === 'Artisan',
                  mapping: singleMapping,
                  existing: importedMachine(singleMapping.sourceId),
                  update: null,
                  connection: {
                      serial: serialConnection,
                      endpoint: singleMapping.draft?.connectionParams[serialConnection ? 'comport' : 'host'],
                      subtype: singleMapping.transport,
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
        platformSupported &&
        snapshot?.status === 'found' &&
        !busy &&
        withinLimit &&
        (selected.length > 0 || (includeGraph && hasGraph));

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
                else if (cropster) await importCropsterGraphSettings(cropster);
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

    const selectProduct = (next: typeof product) => {
        setProduct(next);
        setSelectedIds(new Set());
        setUnitOverride(null);
        setConfirmedVersion(null);
        setResult(null);
    };

    const rescan = () => {
        if (!platformSupported) return;
        setResult(null);
        setSelectedIds(new Set());
        setUnitOverride(null);
        setConfirmedVersion(null);
        void queryClient.invalidateQueries({
            queryKey: {
                Firescope: firescopeSettingsKey,
                Artisan: artisanSettingsKey,
                Cropster: cropsterSettingsKey,
            }[product],
        });
    };

    const confirmVersion = (confirmed: boolean) => {
        setConfirmedVersion(confirmed ? '4.2.0' : null);
        setSelectedIds(new Set());
    };

    const selectMachine = (sequence: number, checked: boolean) => {
        setSelectedIds((previous) => {
            const next = new Set(previous);
            if (checked) next.add(sequence);
            else next.delete(sequence);
            return next;
        });
    };

    return {
        platformSupported,
        product,
        confirmedVersion,
        query,
        snapshot,
        artisan,
        unit,
        graph,
        candidates,
        roastSettings,
        selectedIds,
        includeGraph,
        applying,
        result,
        busy,
        withinLimit,
        canApply,
        hasGraph,
        selectedCount: selected.length,
        apply,
        selectProduct,
        rescan,
        confirmVersion,
        selectMachine,
        setIncludeGraph,
        setUnitOverride,
    };
}
