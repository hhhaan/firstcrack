import { useMachines } from '@entities/machine';
import { type TemperatureUnit, useRoastSettings } from '@features/active-roast';
import {
    artisanSettingsKey,
    cropsterSettingsKey,
    firescopeSettingsKey,
    useArtisanSettings,
    useCropsterSettings,
    useFirescopeSettings,
} from '@features/import-roasting-settings';
import { useEffectivePlan } from '@shared/lib/features';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
    deriveRoastingImport,
    detectImportPlatform,
    type ImportProduct,
    type ImportResult,
    importExceedsPlan,
    importQueryEnabled,
    saveRoastingImport,
} from './roastingImport';

export function useRoastingSettingsImport() {
    const [importPlatform] = useState(detectImportPlatform);
    const platformSupported = importPlatform === 'supported';
    const [product, setProduct] = useState<ImportProduct>('Firescope');
    const [confirmedVersion, setConfirmedVersion] = useState<'4.2.0' | null>(null);
    const enabled = importQueryEnabled(platformSupported, product);
    const firescopeQuery = useFirescopeSettings(enabled.firescope);
    const artisanQuery = useArtisanSettings(enabled.artisan);
    const cropsterQuery = useCropsterSettings(enabled.cropster);
    const query = { Firescope: firescopeQuery, Artisan: artisanQuery, Cropster: cropsterQuery }[product];
    const queryClient = useQueryClient();
    const machines = useMachines((state) => state.machines);
    const plan = useEffectivePlan();
    const roastSettings = useRoastSettings();
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [includeGraph, setIncludeGraph] = useState(true);
    const [unitOverride, setUnitOverride] = useState<TemperatureUnit | null>(null);
    const [applying, setApplying] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const { selected, cropster, firescope, ...derived } = deriveRoastingImport({
        platformSupported,
        product,
        confirmedVersion,
        query,
        firescopeQuery,
        artisanQuery,
        cropsterQuery,
        machines,
        plan,
        roastSettings,
        selectedIds,
        includeGraph,
        unitOverride,
        applying,
    });

    const apply = async () => {
        if (!derived.snapshot || !derived.canApply) return;
        if (importExceedsPlan(selected, product, plan)) {
            setResult('planLimit');
            return;
        }
        setApplying(true);
        setResult(null);
        try {
            setResult(
                await saveRoastingImport({
                    product,
                    selected,
                    includeGraph,
                    hasGraph: derived.hasGraph,
                    artisan: derived.artisan,
                    cropster,
                    firescope,
                    unit: derived.unit,
                    plan,
                }),
            );
        } finally {
            setApplying(false);
        }
    };

    const selectProduct = (next: ImportProduct) => {
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
        importPlatform,
        platformSupported,
        product,
        confirmedVersion,
        query,
        snapshot: derived.snapshot,
        artisan: derived.artisan,
        unit: derived.unit,
        graph: derived.graph,
        candidates: derived.candidates,
        roastSettings,
        selectedIds,
        includeGraph,
        applying,
        result,
        busy: derived.busy,
        withinLimit: derived.withinLimit,
        canApply: derived.canApply,
        hasGraph: derived.hasGraph,
        selectedCount: derived.selectedCount,
        apply,
        selectProduct,
        rescan,
        confirmVersion,
        selectMachine,
        setIncludeGraph,
        setUnitOverride,
    };
}
