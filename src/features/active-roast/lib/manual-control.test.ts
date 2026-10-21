import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { buildControlSeries } from './chart-option/series';
import { CSS_CURVE_TOKENS, DEFAULT_CURVE_STYLES, resolveCurveStyles } from './curve-style';
import { manualControlData } from './manual-control';

const note = (timeSec: number, gas?: string, airflow?: string): LogEntry => ({
    timeSec,
    time: '',
    event: 'Note',
    temp: '',
    note: '',
    ...(gas !== undefined && { gas }),
    ...(airflow !== undefined && { airflow }),
});
describe('manual control observations', () => {
    it('holds values including zero, carries the previous value at a zoom boundary, and keeps same-time order', () => {
        const rows = [note(10, '70'), note(20, '0', '40'), note(22, '50'), note(22, '55'), note(50, '90')];
        expect(manualControlData(rows, 15, 30)).toEqual({
            xs: [15, 20, 22, 30],
            heater: [70, 0, 55, 55],
            fan: [null, 40, 40, 40],
            drum: [null, null, null, null],
        });
        expect(manualControlData([note(1, 'not measured')], 0, 20)).toBeUndefined();
    });
    it('selects automatic, manual or separate sources without rewriting the measured arrays', () => {
        const manual = manualControlData([note(0, '70')], 0, 20);
        const measured = [50, 45];
        const options = {
            showTargetCurve: false,
            showControlDrum: false,
            showControlHeat: true,
            showControlFan: false,
            curves: resolveCurveStyles(DEFAULT_CURVE_STYLES, CSS_CURVE_TOKENS),
            controlGuideMarkLines: [],
        };
        const run = (dataSource: 'auto' | 'manual' | 'both', heatPower: (number | null)[] = measured) =>
            buildControlSeries({
                ...options,
                controlData: { xs: [0, 20], drumTemp: [], heatPower, fanSpeed: [], manual, dataSource },
            }) as { name: string; step?: string; data: unknown }[];
        expect(run('auto').some((row) => row.name === 'Heat (manual)')).toBe(false);
        expect(run('auto', [null, null]).find((row) => row.name === 'Heat (manual)')?.step).toBe('end');
        expect(run('manual').some((row) => row.name === 'Heat')).toBe(false);
        expect(run('both').map((row) => row.name)).toEqual(expect.arrayContaining(['Heat', 'Heat (manual)']));
        expect(measured).toEqual([50, 45]);
    });
});
