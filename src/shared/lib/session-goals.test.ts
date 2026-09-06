import { describe, expect, it } from 'vitest';
import { GOAL_BANDS, goalsVerdict, sessionGoalsVerdict } from './session-goals';

describe('goalsVerdict', () => {
    it('returns null when nothing is comparable', () => {
        expect(goalsVerdict([{ actual: null, target: 200, band: 2 }])).toBeNull();
        expect(goalsVerdict([])).toBeNull();
    });

    it('returns pass when every comparable metric is inside the band', () => {
        expect(
            goalsVerdict([
                { actual: 201, target: 200, band: GOAL_BANDS.dropTemp },
                { actual: 610, target: 600, band: GOAL_BANDS.duration },
            ]),
        ).toBe('pass');
    });

    it('returns fail when any comparable metric is outside the band', () => {
        expect(
            goalsVerdict([
                { actual: 201, target: 200, band: GOAL_BANDS.dropTemp },
                { actual: 650, target: 600, band: GOAL_BANDS.duration },
            ]),
        ).toBe('fail');
    });

    it('ignores metrics missing actual or target', () => {
        expect(
            goalsVerdict([
                { actual: 200, target: 200, band: 2 },
                { actual: null, target: 600, band: 30 },
            ]),
        ).toBe('pass');
    });
});

describe('sessionGoalsVerdict', () => {
    const session = { profile_id: 'p1', drop_temp_celsius: 200, duration_seconds: 600 };
    const profile = { drop_temp_celsius: 200, duration_sec: 600, dev_time_sec: 90, dev_pct: 15 };
    const dev = { devTimeSec: 90, devPct: 15 };

    it('returns null without a profile', () => {
        expect(sessionGoalsVerdict({ ...session, profile_id: null }, profile, dev)).toBeNull();
        expect(sessionGoalsVerdict(session, null, dev)).toBeNull();
    });

    it('returns pass when drop/duration/dev are inside bands', () => {
        expect(sessionGoalsVerdict(session, profile, dev)).toBe('pass');
    });

    it('returns fail when drop temp is outside the band', () => {
        expect(sessionGoalsVerdict({ ...session, drop_temp_celsius: 210 }, profile, dev)).toBe('fail');
    });
});
