import { describe, expect, it, vi } from 'vitest';
import { dropControlRole, dropStoredControlRole, fanDrumMarkers, patchStoredControl } from './fan-drum-markers';

describe('fanDrumMarkers', () => {
    it('labels a changed fan or drum and skips a repeated fan write', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#abc' }));
        const markers = fanDrumMarkers([
            { id: 'a', timeSec: 10, values: { heater: 40, fan: 50, drum: 50 } },
            { id: 'b', timeSec: 20, values: { fan: 50, drum: 55 } },
        ]);
        expect(markers.map((marker) => [marker.logId, marker.event, marker.note, marker.timeSec])).toEqual([
            ['a:fan', 'Fan', '50', 10],
            ['a:drum', 'Drum', '50', 10],
            ['b:drum', 'Drum', '55', 20],
        ]);
        vi.unstubAllGlobals();
    });
});

describe('patchStoredControl', () => {
    const events = [{ id: 'a', type: 'Control', time_sec: 10, applied_control: { heater: 40, fan: 50, drum: 55 } }];

    it('changes the fan value and time on the stored control row', () => {
        expect(patchStoredControl(events, 'a:fan', { timeSec: 80, note: '45' })).toEqual([
            { id: 'a', type: 'Control', time_sec: 80, applied_control: { heater: 40, fan: 45, drum: 55 } },
        ]);
    });

    it('leaves other rows alone and rejects a bad value', () => {
        expect(patchStoredControl(events, 'missing:drum', { note: '1' })).toBeNull();
        expect(patchStoredControl(events, 'a:fan', { note: 'nope' })).toBeNull();
    });

    it('drops one role and keeps the other values on the row', () => {
        const row = {
            id: 'a',
            event: 'Control',
            appliedControl: { heater: 40, fan: 50, drum: 55 },
        };
        expect(dropControlRole([row], 'a:drum')).toEqual([
            { id: 'a', event: 'Control', appliedControl: { heater: 40, fan: 50 } },
        ]);
        expect(dropStoredControlRole(events, 'a:fan')).toEqual([
            { id: 'a', type: 'Control', time_sec: 10, applied_control: { heater: 40, drum: 55 } },
        ]);
    });
});
