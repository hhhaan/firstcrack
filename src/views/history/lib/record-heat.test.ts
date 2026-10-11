import { eventTrigger } from '@features/machine-control/lib/replay';
import { describe, expect, it } from 'vitest';
import { sessionHeatPlan } from './record-heat';

const points = [
    { t: 0, bt: 180, heaterSet: 80 },
    { t: 60, bt: 95, heaterSet: 80 },
    { t: 120, bt: 110, heaterSet: 60 },
    { t: 180, bt: 150, heaterSet: 40 },
];

describe('history reference TP', () => {
    it.each([
        [120, 120, ['time', 'time', 'bt']],
        [null, 60, ['time', 'bt', 'bt']],
        [600, 60, ['time', 'bt', 'bt']],
    ])('uses saved TP %s with the same classification as replay', (storedTp, expectedTp, triggers) => {
        const plan = sessionHeatPlan(
            {
                events: [
                    ...(storedTp == null ? [] : [{ type: 'TP', time_sec: storedTp, note: 'fallback' }]),
                    { type: 'Drop', time_sec: 600 },
                ],
                heater_events: null,
                duration_seconds: 640,
            },
            points,
        );
        expect(plan.tpTime).toBe(expectedTp);
        expect(plan.events.map((event) => eventTrigger(event, plan.tpTime))).toEqual(triggers);
        expect(plan.recorded).toEqual(plan.events);
    });

    it('keeps stored TP and explicit conditions when the TSV has no commands', () => {
        const events = [{ t: 180, bt: 150, heater: 40, trigger: 'time' as const }];
        const plan = sessionHeatPlan(
            {
                events: [{ type: 'TP', time_sec: 120 }],
                heater_events: events,
                duration_seconds: 600,
            },
            points.map(({ t, bt }) => ({ t, bt })),
        );
        expect(plan.tpTime).toBe(120);
        expect(plan.events).toEqual(events);
        expect(plan.recorded).toEqual([]);
        expect(plan.source).toBe('session');
    });
});
