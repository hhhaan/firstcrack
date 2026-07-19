import { describe, expect, it } from 'vitest';
import { evaluateRoastAlerts, type RoastAlertThresholds } from './roastAlerts';

const T: RoastAlertThresholds = { rorCrashBelowCPerMin: 0, btMaxC: 250 };

describe('evaluateRoastAlerts', () => {
    it('flags a RoR crash after the turning point', () => {
        expect(evaluateRoastAlerts({ ror: -0.5, bt: 200, afterTurningPoint: true }, T)).toEqual(['ror-crash']);
    });

    it('ignores negative RoR before the turning point', () => {
        // BT falls from charge to TP — negative RoR is expected there, not a crash
        expect(evaluateRoastAlerts({ ror: -20, bt: 90, afterTurningPoint: false }, T)).toEqual([]);
    });

    it('flags BT over the ceiling', () => {
        expect(evaluateRoastAlerts({ ror: 5, bt: 251, afterTurningPoint: true }, T)).toEqual(['bt-over']);
    });

    it('stays quiet in a normal roast', () => {
        expect(evaluateRoastAlerts({ ror: 8, bt: 195, afterTurningPoint: true }, T)).toEqual([]);
    });

    it('holds an active alert through hysteresis instead of chattering', () => {
        const input = { ror: 0.8, bt: 200, afterTurningPoint: true };
        // 0.8 is above the 0 threshold — would not fire on its own...
        expect(evaluateRoastAlerts(input, T)).toEqual([]);
        // ...but an already-active crash stays active until RoR recovers past the margin
        expect(evaluateRoastAlerts(input, T, ['ror-crash'])).toEqual(['ror-crash']);
        expect(evaluateRoastAlerts({ ...input, ror: 2 }, T, ['ror-crash'])).toEqual([]);
    });

    it('treats missing readings as no alert', () => {
        expect(evaluateRoastAlerts({ ror: null, bt: null, afterTurningPoint: true }, T)).toEqual([]);
    });

    it('reports both kinds at once', () => {
        expect(evaluateRoastAlerts({ ror: -3, bt: 260, afterTurningPoint: true }, T)).toEqual(['ror-crash', 'bt-over']);
    });
});
