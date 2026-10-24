import { profileHeaterEvents } from '@entities/roast-profile';
import { resolveReplayPlan } from '@features/machine-control/lib/heater-events';
import { describe, expect, it } from 'vitest';
import { buildProfileReferenceLog, buildReferenceLog } from './reference-log';

describe('reference log', () => {
    it('does not invent recorded times from a replay-only profile', () => {
        expect(
            buildProfileReferenceLog({ heater_events: [{ t: 0, bt: 150, heater: 50, trigger: 'bt' }] }, [], 'C'),
        ).toEqual([]);
    });
    it.each([false, true])('keeps recorded times separate from zero-time BT rules (TSV fallback: %s)', (tsvOnly) => {
        const recorded = [
            { id: 'h1', type: 'Heater', time_sec: 90, temp_c: 120, note: '70' },
            { id: 'h2', type: 'Heater', time_sec: 300, temp_c: 170, note: '40' },
        ];
        const points = [
            { t: 90, bt: 120, heaterSet: 70 },
            { t: 300, bt: 170, heaterSet: 40 },
        ];
        const rules = [
            { t: 0, bt: 120, heater: 70, trigger: 'bt' },
            { t: 0, bt: 170, heater: 40, trigger: 'bt' },
        ];
        const profile = {
            heater_events: rules,
            source_session: [{ tsv_path: 'legacy.tsv', events: tsvOnly ? [] : recorded, heater_events: null }],
        };
        const before = JSON.stringify(profile);
        expect(buildProfileReferenceLog(profile, points, 'C').map((entry) => entry.timeSec)).toEqual([90, 300]);
        // Replay must still honor the operator's BT rules without changing their coordinates.
        expect(resolveReplayPlan({ points, profileEvents: profileHeaterEvents(profile) }).plan?.events).toEqual(rules);
        expect(JSON.stringify(profile)).toBe(before);
    });

    it('honors saved record corrections while ignoring the profile override', () => {
        const profile = {
            heater_events: [{ t: 0, bt: 170, heater: 40, trigger: 'bt' }],
            source_session: {
                tsv_path: null,
                heater_events: [{ t: 123.5, bt: 140, heater: 50 }],
            },
        };
        expect(buildProfileReferenceLog(profile, [], 'F')[0]).toMatchObject({ timeSec: 123.5, note: '50' });
    });
    it('keeps command changes including zero and never substitutes feedback', () => {
        const points = [
            { t: 0, bt: 190, heaterSet: 70, heater: 99 },
            { t: 20, bt: 130, heaterSet: 70 },
            { t: 40, bt: 120, heaterSet: 0 },
        ];
        const rows = buildReferenceLog([], points, 'F');
        expect(rows.map((row) => row.note)).toEqual(['70', '0']);
        expect(rows[1]).toMatchObject({ timeSec: 40, tempC: 120, temp: '248°F' });
        expect(points[0].heaterSet).toBe(70);
    });
    it('uses recorded events and a saved reference edit without mutating either', () => {
        const events = [{ id: 'original', type: 'Heater', time_sec: 10, temp_c: 140, note: '50%' }];
        expect(buildReferenceLog(events, [], 'C')[0].note).toBe('50%');
        expect(buildReferenceLog(events, [], 'C', [{ t: 12, bt: 145, heater: 40 }])[0]).toMatchObject({
            timeSec: 12,
            tempC: 145,
            note: '40',
        });
        expect(events[0].note).toBe('50%');
    });
});
