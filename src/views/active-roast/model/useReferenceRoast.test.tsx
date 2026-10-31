// @vitest-environment jsdom
import { roastProfileKeys } from '@entities/roast-profile/queries';
import { resolveReplayPlan } from '@features/machine-control/lib/heater-events';
import { fetchTsvFromR2 } from '@shared/lib/r2';
import { roastCurveKeys } from '@shared/lib/roast-curve';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HistoryReference } from '@widgets/history-reference/model/reference';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReferenceRoast } from './useReferenceRoast';

vi.mock('@shared/lib/r2', () => ({ fetchTsvFromR2: vi.fn() }));
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const points = [
    { t: 90, bt: 120, heaterSet: 70 },
    { t: 300, bt: 170, heaterSet: 40 },
];
const history: HistoryReference = {
    id: 'history',
    ownerId: 'owner',
    name: 'History',
    tsvPath: 'history.tsv',
    bbpPath: null,
    events: [{ type: 'Drop', time_sec: 350 }],
    heaterEvents: null,
    durationSec: 400,
    machineId: 'history-machine',
    machineKey: 'history-key',
};
const profile = {
    id: 'profile',
    user_id: 'owner',
    name: 'Profile',
    source_session_id: 'source',
    duration_sec: 999,
    machine_id: 'profile-machine',
    machine_roaster_key: 'profile-key',
    heater_events: [{ t: 0, bt: 150, heater: 99, trigger: 'bt' }],
    source_session: {
        tsv_path: 'source.tsv',
        bbp_tsv_path: 'source.bbp.tsv',
        duration_seconds: 400,
        events: [
            { type: 'TP', time_sec: 60 },
            { type: 'FC Start', time_sec: 250 },
            { type: 'Drop', time_sec: 350 },
        ],
        heater_events: null,
        machine_id: 'source-machine',
        machine_roaster_key: 'source-key',
    },
};

describe('reference roast read composition', () => {
    let client: QueryClient;
    let root: Root;
    let value: ReturnType<typeof useReferenceRoast> | undefined;
    const current = () => {
        if (!value) throw new Error('Reference roast did not render');
        return value;
    };
    function Probe(input: Parameters<typeof useReferenceRoast>[0]) {
        value = useReferenceRoast(input);
        return null;
    }
    const render = async (patch: Partial<Parameters<typeof useReferenceRoast>[0]> = {}) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Probe
                        workspaceOwnerId="owner"
                        targetProfileId="profile"
                        historyReference={null}
                        unit="C"
                        bbpEnabled={true}
                        machineSnapshot={null}
                        {...patch}
                    />
                </QueryClientProvider>,
            );
        });
    };
    const flush = async () => {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    };
    beforeEach(() => {
        value = undefined;
        client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        client.setQueryData(roastProfileKeys.all('owner'), [profile]);
        client.setQueryData([...roastProfileKeys.all('owner'), 'batch_counters'], {});
        client.setQueryData(roastCurveKeys.byPath('source.tsv'), points);
        client.setQueryData(roastCurveKeys.byPath('history.tsv'), [{ t: 0, bt: 180, heaterSet: 20 }]);
        client.setQueryData(['bbp_curve', 'owner', 'source', 'source.bbp.tsv'], [{ t: 20, bt: 200 }]);
        root = createRoot(document.createElement('div'));
        vi.mocked(fetchTsvFromR2).mockReset();
        vi.mocked(fetchTsvFromR2).mockImplementation(() => new Promise(() => {}));
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
    });

    it.each([false, true])(
        'reads the source record and keeps recorded coordinates separate from Replay (TSV only %s)',
        async (tsvOnly) => {
            const recorded = points.map((point, i) => ({
                id: `heater-${i}`,
                type: 'Heater',
                time_sec: point.t,
                temp_c: point.bt,
                note: String(point.heaterSet),
            }));
            const source = { ...profile.source_session, events: tsvOnly ? [] : recorded };
            client.setQueryData(roastProfileKeys.all('owner'), [{ ...profile, source_session: [source] }]);
            await render();
            expect(current().referenceLog?.entries.map((entry) => entry.timeSec)).toEqual([90, 300]);
            expect(current().heatEvents).toBeUndefined();
            expect(
                resolveReplayPlan({ points: current().replayPoints, profileEvents: current().heatEvents }).plan?.events,
            ).toEqual([
                { t: 90, bt: 120, heater: 70 },
                { t: 300, bt: 170, heater: 40 },
            ]);
            expect(current().replayDropTime).toBe(400);
            expect(source.events).toEqual(tsvOnly ? [] : recorded);
        },
    );

    it('uses source marks, machine and BBP while retaining memoized roast-only outputs on live renders', async () => {
        const machineSnapshot = {
            machine_id: 'source-machine',
            machine_roaster_key: 'source-key',
            machine_name: null,
            machine_brand: null,
            machine_protocol: null,
        };
        await render({ machineSnapshot });
        const before = current();
        expect(before).toMatchObject({
            replayDropTime: 350,
            referenceTpTime: 60,
            referenceFcStartSec: 250,
            replayMachineMismatch: false,
        });
        expect(before.referenceTimeline.bbp).toEqual([{ t: 20, bt: 200 }]);
        expect(before.replayPoints).toEqual(points);
        expect(before.referenceTimeline.roast).toBe(before.replayPoints);
        await render({ machineSnapshot });
        expect(current().backgroundCurvePoints).toBe(before.backgroundCurvePoints);
        expect(current().replayPoints).toBe(before.replayPoints);
        expect(current().referenceLog).toBe(before.referenceLog);
        expect(current().heatTarget).toBe(before.heatTarget);
        expect(current().referenceTimeline).toBe(before.referenceTimeline);
    });

    it('returns the owned History snapshot itself and never borrows Profile BBP metadata', async () => {
        await render({ historyReference: history });
        expect(current().reference).toBe(history);
        expect(current()).toMatchObject({
            referenceId: 'history',
            replayDropTime: 350,
            referenceTpTime: null,
            referenceFcStartSec: null,
        });
        expect(current().referenceLog?.name).toBe('History');
        expect(current().referenceTimeline.bbp).toEqual([]);
        expect(current().replayPoints).toEqual([{ t: 0, bt: 180, heaterSet: 20 }]);
        await render({ historyReference: { ...history, ownerId: 'foreign' } });
        expect(current().reference).toBeNull();
        expect(current().referenceLog?.name).toBe('Profile');
        expect(current().referenceTimeline.bbp).toEqual([{ t: 20, bt: 200 }]);
    });

    it.each([
        { storedHeat: null, invalid: false },
        { storedHeat: undefined, invalid: false },
        { storedHeat: [], invalid: true },
        { storedHeat: { malformed: true }, invalid: true },
        { storedHeat: [{ t: 123.5, bt: 140, heater: 50 }], invalid: false },
    ])(
        'preserves the source heat sentinel $storedHeat and ignores the profile copy',
        async ({ storedHeat, invalid }) => {
            client.setQueryData(roastProfileKeys.all('owner'), [
                { ...profile, source_session: { ...profile.source_session, heater_events: storedHeat } },
            ]);
            await render({ unit: 'F' });
            expect(current().heatEvents).toEqual(storedHeat ?? undefined);
            const resolved = resolveReplayPlan({ points: current().replayPoints, profileEvents: current().heatEvents });
            expect(resolved.overrideInvalid).toBe(invalid);
            if (Array.isArray(storedHeat) && storedHeat.length > 0) {
                expect(current().referenceLog?.entries.find((entry) => entry.timeSec === 123.5)).toMatchObject({
                    timeSec: 123.5,
                    note: '50',
                });
            }
        },
    );

    it('keeps the selected id without an owned profile and keeps source BBP identity without a join', async () => {
        client.setQueryData(roastProfileKeys.all('owner'), [{ ...profile, user_id: 'foreign' }]);
        await render();
        const empty = current().replayPoints;
        expect(current().referenceId).toBe('profile');
        expect(current().referenceLog).toBeUndefined();
        expect(current().heatTarget).toBeUndefined();
        expect(empty).toEqual([]);
        await render({ targetProfileId: null });
        expect(current().referenceId).toBeNull();
        const noSelection = current().replayPoints;
        expect(noSelection).toEqual([]);
        await render({ targetProfileId: null });
        expect(current().replayPoints).toBe(noSelection);
        client.setQueryData(roastProfileKeys.all('owner'), [{ ...profile, source_session: null }]);
        client.setQueryData(['bbp_curve', 'owner', 'source', null], [{ t: 5, bt: 220 }]);
        await render();
        expect(current().backgroundCurvePoints.length).toBeGreaterThan(0);
        expect(current().referenceTimeline.bbp).toEqual([{ t: 5, bt: 220 }]);
        expect(current().referenceLog?.entries).toEqual([]);
        expect(current().heatEvents).toBeUndefined();
        expect(current().replayDropTime).toBeNull();
    });

    it.each([false, true])(
        'preserves selected curve loading and error with synthetic Profile fallback (History %s)',
        async (selectHistory) => {
            client.removeQueries({ queryKey: roastCurveKeys.byPath('source.tsv') });
            client.removeQueries({ queryKey: roastCurveKeys.byPath('history.tsv') });
            await render({ historyReference: selectHistory ? history : null });
            expect(current().referenceLog?.loading).toBe(true);
            expect(current().replayPoints).toBeNull();
            expect(current().backgroundCurvePoints.length > 0).toBe(!selectHistory);
            vi.mocked(fetchTsvFromR2).mockRejectedValue(new Error('download failed'));
            await act(async () => {
                await client.resetQueries({
                    queryKey: roastCurveKeys.byPath(selectHistory ? 'history.tsv' : 'source.tsv'),
                });
            });
            await flush();
            expect(current().referenceLog).toMatchObject({ loading: false, error: true });
            expect(current().historyReferenceFailed).toBe(selectHistory);
            expect(current().backgroundCurvePoints.length > 0).toBe(!selectHistory);
        },
    );

    it.each(['source-machine', 'other-machine'])(
        'preserves the same-machine Standard migration exception for %s',
        async (machineId) => {
            client.setQueryData(roastProfileKeys.all('owner'), [
                { ...profile, source_session: { ...profile.source_session, machine_roaster_key: 'giesen_standard' } },
            ]);
            await render({
                machineSnapshot: {
                    machine_id: machineId,
                    machine_roaster_key: 'giesen_w45a_w60a',
                    machine_name: null,
                    machine_brand: null,
                    machine_protocol: null,
                },
            });
            expect(current().replayMachineMismatch).toBe(machineId !== 'source-machine');
        },
    );
});
