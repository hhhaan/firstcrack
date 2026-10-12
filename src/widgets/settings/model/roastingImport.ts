import {
    type ArtisanMachineMapping,
    type CropsterMachineMapping,
    type FirescopeMachineMapping,
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
    type RoastSettings,
    type TemperatureUnit,
} from '@features/active-roast';
import { canAddMachine } from '@shared/lib/features';
import { captureRoastingImportFailure } from '@shared/lib/sentry';
import type { ArtisanSettingsSnapshot } from '@shared/types/artisan';
import type { CropsterSettingsSnapshot } from '@shared/types/cropster';
import type { FirescopeSettingsSnapshot } from '@shared/types/firescope';
import { isTauri } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';

export type ImportProduct = 'Firescope' | 'Artisan' | 'Cropster';
export type ImportResult = 'saved' | 'failed' | 'graphSavedMachinesFailed' | 'planLimit';

type SettingsQuery<T> = { data: T | undefined; error: unknown; isFetching: boolean };
type MachineDraft = Omit<Machine, 'id' | 'createdAt'>;
type MachineMapping = FirescopeMachineMapping | ArtisanMachineMapping | CropsterMachineMapping;
type FeedbackPatch = Pick<Machine, 'connectionParams' | 'capabilities'>;

export type ImportCandidate = {
    sequence: number;
    current: boolean;
    mapping: MachineMapping;
    existing: Machine | undefined;
    update: FeedbackPatch | null;
    connection: { serial: boolean; endpoint: unknown; subtype: unknown; protocol: unknown };
};

const loaded = <T>(query: SettingsQuery<T>): T | undefined => (query.error ? undefined : query.data);

const realMachineCount = (machines: Machine[]) => machines.filter((machine) => machine.id !== VIRTUAL_ID).length;

const allowsAdditions = (plan: string, machines: Machine[], additions: number) =>
    additions === 0 || canAddMachine(plan, realMachineCount(machines) + additions - 1);

const findImportedMachine = (product: ImportProduct, sourceId: string | number | null, machines: Machine[]) =>
    machines.find((machine) => machine.importSource?.product === product && machine.importSource.sourceId === sourceId);

const firescopeConnection = (settings: Record<string, unknown>): ImportCandidate['connection'] => {
    const raw = settings.connection as Record<string, unknown> | undefined;
    const serial = raw?.type === 'serial';
    const details = raw?.[serial ? 'serial' : 'ethernet'] as Record<string, unknown> | undefined;
    return {
        serial: serial || raw?.type === 'usb',
        endpoint: details?.[serial ? 'path' : 'ip'],
        subtype: details?.type,
        protocol: raw?.protocol,
    };
};

const singleConnection = (mapping: ArtisanMachineMapping | CropsterMachineMapping): ImportCandidate['connection'] => {
    const serial = ['rtu', 'ascii'].includes(mapping.transport ?? '');
    return {
        serial,
        endpoint: mapping.draft?.connectionParams[serial ? 'comport' : 'host'],
        subtype: mapping.transport,
        protocol: 'modbus',
    };
};

const firescopeCandidates = (
    firescope: FirescopeSettingsSnapshot | undefined,
    machines: Machine[],
): ImportCandidate[] =>
    (firescope?.machines ?? []).map((candidate) => {
        const mapping = mapFirescopeMachine(candidate.settings);
        const existing = findImportedMachine('Firescope', mapping.sourceId, machines);
        const update = existing && mapping.draft ? firescopeFeedbackUpdate(existing, mapping.draft) : null;
        return {
            sequence: candidate.sequence,
            current: candidate.current,
            mapping,
            existing,
            update,
            connection: firescopeConnection(candidate.settings),
        };
    });

const singleCandidate = (
    product: ImportProduct,
    mapping: ArtisanMachineMapping | CropsterMachineMapping,
    machines: Machine[],
): ImportCandidate => ({
    sequence: 0,
    current: product === 'Artisan',
    mapping,
    existing: findImportedMachine(product, mapping.sourceId, machines),
    update: null,
    connection: singleConnection(mapping),
});

const importTemperatureUnit = (
    artisan: ArtisanSettingsSnapshot | undefined,
    cropster: CropsterSettingsSnapshot | undefined,
    firescope: FirescopeSettingsSnapshot | undefined,
    unitOverride: TemperatureUnit | null,
): TemperatureUnit | null => {
    if (artisan) return artisanTemperatureUnit(artisan.settings?.Mode);
    if (cropster) return cropsterTemperatureUnit(cropster.preferences?.temperatureUnit);
    return unitOverride ?? firescopeTemperatureUnit(firescope?.graphTemperatureUnit ?? firescope?.global?.temperature);
};

const importGraph = (
    artisan: ArtisanSettingsSnapshot | undefined,
    cropster: CropsterSettingsSnapshot | undefined,
    firescope: FirescopeSettingsSnapshot | undefined,
    roastSettings: RoastSettings,
    unit: TemperatureUnit | null,
) => {
    if (artisan) return mapArtisanGraphSettings(artisan, roastSettings);
    if (cropster) return mapCropsterGraphSettings(cropster, roastSettings);
    if (firescope) return mapFirescopeGraphSettings(firescope, roastSettings, unit);
    return null;
};

export type ImportPlatform = 'supported' | 'browser' | 'unsupported-os';

export const detectImportPlatform = (): ImportPlatform => {
    if (!isTauri()) return 'browser';
    return platform() === 'macos' ? 'supported' : 'unsupported-os';
};

export const importQueryEnabled = (platformSupported: boolean, product: ImportProduct) => ({
    firescope: platformSupported && product === 'Firescope',
    artisan: platformSupported && product === 'Artisan',
    cropster: platformSupported && product === 'Cropster',
});

export const deriveRoastingImport = (input: {
    platformSupported: boolean;
    product: ImportProduct;
    confirmedVersion: '4.2.0' | null;
    query: SettingsQuery<FirescopeSettingsSnapshot | ArtisanSettingsSnapshot | CropsterSettingsSnapshot>;
    firescopeQuery: SettingsQuery<FirescopeSettingsSnapshot>;
    artisanQuery: SettingsQuery<ArtisanSettingsSnapshot>;
    cropsterQuery: SettingsQuery<CropsterSettingsSnapshot>;
    machines: Machine[];
    plan: string;
    roastSettings: RoastSettings;
    selectedIds: ReadonlySet<number>;
    includeGraph: boolean;
    unitOverride: TemperatureUnit | null;
    applying: boolean;
}) => {
    const snapshot = loaded(input.query);
    const firescope = input.product === 'Firescope' ? loaded(input.firescopeQuery) : undefined;
    const artisan = input.product === 'Artisan' ? loaded(input.artisanQuery) : undefined;
    const cropster = input.product === 'Cropster' ? loaded(input.cropsterQuery) : undefined;
    const unit = importTemperatureUnit(artisan, cropster, firescope, input.unitOverride);
    const graph = importGraph(artisan, cropster, firescope, input.roastSettings, unit);
    const singleMapping = artisan?.settings
        ? mapArtisanMachine(artisan, input.confirmedVersion)
        : cropster?.machine
          ? mapCropsterMachine(cropster)
          : null;
    const candidates = singleMapping
        ? [singleCandidate(input.product, singleMapping, input.machines)]
        : firescopeCandidates(firescope, input.machines);
    const selected = candidates.filter(
        (candidate) =>
            candidate.mapping.draft &&
            (!candidate.existing || candidate.update) &&
            input.selectedIds.has(candidate.sequence),
    );
    const hasGraph = graph !== null && Object.keys(graph.patch).length > 0;
    const busy = input.applying || input.query.isFetching;
    const withinLimit = allowsAdditions(
        input.plan,
        input.machines,
        selected.filter((candidate) => !candidate.existing).length,
    );
    const canApply =
        input.platformSupported &&
        snapshot?.status === 'found' &&
        !busy &&
        withinLimit &&
        (selected.length > 0 || (input.includeGraph && hasGraph));
    return {
        snapshot,
        artisan,
        cropster,
        firescope,
        unit,
        graph,
        candidates,
        selected,
        busy,
        withinLimit,
        canApply,
        hasGraph,
        selectedCount: selected.length,
    };
};

export const importExceedsPlan = (selected: ImportCandidate[], product: ImportProduct, plan: string) => {
    const machines = useMachines.getState().machines;
    const additions = selected.filter(
        ({ mapping }) => !findImportedMachine(product, mapping.sourceId, machines),
    ).length;
    return !allowsAdditions(plan, machines, additions);
};

const importSelectedGraph = async (input: {
    artisan: ArtisanSettingsSnapshot | undefined;
    cropster: CropsterSettingsSnapshot | undefined;
    firescope: FirescopeSettingsSnapshot | undefined;
    unit: TemperatureUnit | null;
}) => {
    if (input.artisan) await importArtisanGraphSettings(input.artisan);
    else if (input.cropster) await importCropsterGraphSettings(input.cropster);
    else if (input.firescope) await importFirescopeGraphSettings(input.firescope, input.unit);
};

const pendingMachineWrites = (product: ImportProduct, selected: ImportCandidate[], machines: Machine[]) => {
    const pending: MachineDraft[] = [];
    const updates: { id: string; patch: FeedbackPatch }[] = [];
    for (const { mapping } of selected) {
        if (!mapping.draft) continue;
        const existing = findImportedMachine(product, mapping.sourceId, machines);
        if (!existing) pending.push(mapping.draft);
        else if (product === 'Firescope') {
            const patch = firescopeFeedbackUpdate(existing, mapping.draft);
            if (patch) updates.push({ id: existing.id, patch });
        }
    }
    return { pending, updates };
};

export const saveRoastingImport = async (input: {
    product: ImportProduct;
    selected: ImportCandidate[];
    includeGraph: boolean;
    hasGraph: boolean;
    artisan: ArtisanSettingsSnapshot | undefined;
    cropster: CropsterSettingsSnapshot | undefined;
    firescope: FirescopeSettingsSnapshot | undefined;
    unit: TemperatureUnit | null;
    plan: string;
}): Promise<Exclude<ImportResult, 'planLimit'>> => {
    let graphApplied = false;
    let stage: 'graph' | 'machines' = 'graph';
    let pendingCount = 0;
    let updatesCount = 0;
    try {
        if (input.includeGraph && input.hasGraph) {
            await importSelectedGraph(input);
            graphApplied = true;
        }
        stage = 'machines';
        const latest = useMachines.getState();
        const { pending, updates } = pendingMachineWrites(input.product, input.selected, latest.machines);
        pendingCount = pending.length;
        updatesCount = updates.length;
        if (pending.length > 0 || updates.length > 0) {
            if (!allowsAdditions(input.plan, latest.machines, pending.length)) throw new Error('machine limit');
            latest.importMachines(pending, updates);
        }
        return 'saved';
    } catch (error) {
        if (!(error instanceof Error && error.message === 'machine limit')) {
            captureRoastingImportFailure(error, {
                product: input.product,
                stage,
                counts: { selected: input.selected.length, pending: pendingCount, updates: updatesCount },
            });
        }
        return graphApplied ? 'graphSavedMachinesFailed' : 'failed';
    }
};
