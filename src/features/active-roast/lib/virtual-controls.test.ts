import { describe, expect, it } from 'vitest';
import {
    holdControlSamples,
    manualNotesToControlChanges,
    registeredNoteControlIds,
    virtualControlLinesAllowed,
    withVirtualControlLines,
} from './virtual-controls';

describe('manualNotesToControlChanges', () => {
    it('reads gas, airflow, and drum typed on a roast note', () => {
        expect(
            manualNotesToControlChanges([
                { event: 'Note', timeSec: 12, gas: '70', airflow: '50%', drum: '55' },
                { event: 'Note', timeSec: -20, gas: '10' },
                { event: 'Charge', timeSec: 0, gas: '80' },
                { event: 'Note', timeSec: 30, gas: 'afdsf', airflow: '1.2 kPa' },
            ]),
        ).toEqual([
            { timeSec: 12, values: { heater: 70, fan: 50, drum: 55 }, virtual: true },
            { timeSec: 30, values: { fan: 1.2 }, virtual: true },
        ]);
    });
});

describe('virtualControlLinesAllowed', () => {
    it('keeps the line for machines that do not read heater, fan, or drum', () => {
        expect(virtualControlLinesAllowed(null)).toBe(true);
        expect(virtualControlLinesAllowed('phidget_tmp1101')).toBe(true);
        expect(virtualControlLinesAllowed('virtual_readonly')).toBe(true);
        expect(virtualControlLinesAllowed('giesen_standard')).toBe(false);
        expect(virtualControlLinesAllowed('loring_smart_roast')).toBe(false);
    });
});

describe('registeredNoteControlIds', () => {
    it('names the channels a machine already reads', () => {
        expect(registeredNoteControlIds('giesen_standard')).toEqual(['gas', 'airflow', 'drum']);
        expect(registeredNoteControlIds('giesen_wxa')).toEqual(['gas', 'drum']);
        expect(registeredNoteControlIds('phidget_tmp1101')).toEqual([]);
        expect(registeredNoteControlIds(null)).toEqual([]);
    });
});

describe('withVirtualControlLines', () => {
    it('holds a right-click value across later samples and leaves measured channels alone', () => {
        const painted = withVirtualControlLines({
            xs: [0, 10, 20, 30],
            heatPower: [null, null, null, null],
            fanSpeed: [4, 4, 4, 4],
            drumTemp: [null, null, null, null],
            changes: [
                { timeSec: 10, values: { heater: 40, fan: 9 }, virtual: true },
                { timeSec: 25, values: { heater: 70 }, virtual: true },
            ],
        });
        expect(painted.heatPower).toEqual([null, 40, 40, 70]);
        expect(painted.fanSpeed).toEqual([4, 4, 4, 4]);
        expect(painted.virtualRoles).toEqual(['heater']);
        expect(holdControlSamples(painted.xs, painted.changes ?? [], 'heater')).toEqual([null, 40, 40, 70]);
    });
});
