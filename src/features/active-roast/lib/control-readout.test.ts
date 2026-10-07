import { describe, expect, it } from 'vitest';
import { layoutControlAxes, resolveControlUnits } from './control-channels';
import { presetHeaterOnly, presetReadonlyDrumFan } from './control-preset-test-fixtures';
import {
    buildControlLiveReadout,
    buildControlReadoutGroups,
    CONTROL_STALE_AGE_FACTOR,
    type ControlLiveInput,
    controlLinkState,
    stepValueAt,
} from './control-readout';

const live = (over: Partial<ControlLiveInput> = {}): ControlLiveInput => ({
    liveData: { heater: 62, fan: 40, drum: 55.5, heater_set: 65 },
    capabilities: ['heater', 'fan', 'drum'],
    connected: true,
    reconnecting: false,
    quality: 'valid',
    pollIntervalMs: 1000,
    nowMs: 10_000,
    lastValidReceivedAtMs: 10_000,
    ...over,
});

describe('controlLinkState', () => {
    it.each([
        [{ connected: false, reconnecting: false, quality: 'valid' as const }, 'offline'],
        [{ connected: true, reconnecting: true, quality: 'valid' as const }, 'stale'],
        [{ connected: true, reconnecting: false, quality: 'stale' as const }, 'stale'],
        [{ connected: true, reconnecting: false, quality: 'poll_error' as const }, 'stale'],
        [{ connected: true, reconnecting: false, quality: null }, 'live'],
    ])('%o → %s', (input, state) => {
        expect(controlLinkState({ ...input, pollIntervalMs: 1000, nowMs: 10_000, lastValidReceivedAtMs: 10_000 })).toBe(
            state,
        );
    });

    it('marks retransmit stale when the last valid sample is older than 3× the poll interval', () => {
        const poll = 1000;
        const last = 10_000;
        expect(
            controlLinkState({
                connected: true,
                reconnecting: false,
                quality: 'retransmit',
                pollIntervalMs: poll,
                nowMs: last + CONTROL_STALE_AGE_FACTOR * poll + 1,
                lastValidReceivedAtMs: last,
            }),
        ).toBe('stale');
    });

    it('keeps retransmit live while the last valid sample is recent', () => {
        expect(
            controlLinkState({
                connected: true,
                reconnecting: false,
                quality: 'retransmit',
                pollIntervalMs: 1000,
                nowMs: 12_500,
                lastValidReceivedAtMs: 10_000,
            }),
        ).toBe('live');
    });
});

describe('buildControlLiveReadout', () => {
    it('keeps a measured 0', () => {
        const readout = buildControlLiveReadout(live({ liveData: { heater: 0, fan: 0, drum: 0 } }));
        expect(readout.values).toEqual({ drum: 0, heat: 0, fan: 0 });
    });

    it('leaves a missing heater as null, not 0', () => {
        expect(buildControlLiveReadout(live({ liveData: { heater: null, fan: 40, drum: 55 } })).values.heat).toBeNull();
    });

    it('lists Bühler drum/fan from preset read maps even when capabilities are empty', () => {
        expect(presetReadonlyDrumFan).toBeDefined();
        expect(
            Object.keys(
                buildControlLiveReadout(
                    live({
                        roasterKey: presetReadonlyDrumFan,
                        capabilities: [],
                        liveData: { heater: null, fan: 40, drum: 55 },
                    }),
                ).values,
            ).sort(),
        ).toEqual(['drum', 'fan']);
    });

    it('lists only heater when capabilities declare heater alone (Loring-like)', () => {
        expect(presetHeaterOnly).toBeDefined();
        expect(
            Object.keys(
                buildControlLiveReadout(
                    live({
                        roasterKey: presetHeaterOnly,
                        capabilities: ['heater'],
                        liveData: { heater: 62, fan: 0, drum: 0 },
                    }),
                ).values,
            ),
        ).toEqual(['heat']);
    });

    it('adds a channel declared only in control limits (custom write map)', () => {
        expect(
            Object.keys(buildControlLiveReadout(live({ capabilities: [], limits: { fan: { unit: '%' } } })).values),
        ).toEqual(['fan']);
    });

    it('drops every value when disconnected instead of showing the last one', () => {
        const readout = buildControlLiveReadout(live({ connected: false }));
        expect(readout).toEqual({ state: 'offline', values: { drum: null, heat: null, fan: null }, heatSet: null });
    });

    it('keeps the last values but marks them stale', () => {
        const readout = buildControlLiveReadout(live({ quality: 'stale' }));
        expect(readout.state).toBe('stale');
        expect(readout.values.heat).toBe(62);
    });
});

describe('stepValueAt', () => {
    const plan = { xs: [0, 120, 300], values: [80, 60, 60] };
    it('follows the step and stops outside the plan', () => {
        expect([stepValueAt(plan, -1), stepValueAt(plan, 0), stepValueAt(plan, 119), stepValueAt(plan, 130)]).toEqual([
            null,
            80,
            80,
            60,
        ]);
        expect(stepValueAt(plan, 301)).toBeNull();
    });
});

describe('buildControlReadoutGroups', () => {
    const units = resolveControlUnits({ drum: { unit: 'RPM', min: 0, max: 80 } });
    const shownAll = { drum: true, heat: true, fan: true };
    const axes = layoutControlAxes(shownAll, units, 0, 100);

    it('groups entries by axis side, keeps setpoints separate from measured values', () => {
        const groups = buildControlReadoutGroups({
            shown: shownAll,
            axes,
            units,
            live: buildControlLiveReadout(live()),
            hasHeatSet: true,
            heatTargetNow: 70,
        });
        expect(groups.left.map((e) => [e.key, e.text, e.unit])).toEqual([['drum', '55.5', 'RPM']]);
        expect(groups.right.map((e) => [e.key, e.kind, e.text])).toEqual([
            ['heat', 'measured', '62'],
            ['heat-set', 'set', '65'],
            ['heat-target', 'target', '70'],
            ['fan', 'measured', '40'],
        ]);
        expect([groups.leftUnit, groups.rightUnit]).toEqual(['RPM', '%']);
    });

    it('leaves no entry for hidden or unsupported channels', () => {
        const groups = buildControlReadoutGroups({
            shown: { drum: true, heat: true, fan: false },
            axes,
            units,
            live: buildControlLiveReadout(
                live({
                    roasterKey: presetHeaterOnly,
                    capabilities: ['heater'],
                    liveData: { heater: 62, fan: 0, drum: 0 },
                }),
            ),
            hasHeatSet: false,
        });
        expect([...groups.left, ...groups.right, ...groups.ownScale].map((e) => e.key)).toEqual(['heat']);
    });

    it('shows a dash (null) for a supported channel with no reading, and no numbers for saved records', () => {
        const offline = buildControlReadoutGroups({
            shown: shownAll,
            axes,
            units,
            live: buildControlLiveReadout(live({ connected: false })),
            hasHeatSet: true,
        });
        expect([...offline.left, ...offline.right].every((e) => e.text === null)).toBe(true);
        const saved = buildControlReadoutGroups({ shown: shownAll, axes, units, hasHeatSet: false });
        expect([...saved.left, ...saved.right].every((e) => e.text === undefined)).toBe(true);
    });
});
