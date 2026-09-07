import { describe, expect, it } from 'vitest';
import { evaluateRoastAlerts, evaluateTimeAlerts, type RoastAlertThresholds, type TimeAlertInput } from './roastAlerts';

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

const baseTime = (patch: Partial<TimeAlertInput> = {}): TimeAlertInput => ({
    elapsedSec: 0,
    dropped: false,
    referenceFcStartSec: 480,
    referenceDropSec: 720,
    sessionDropSec: null,
    ...patch,
});

describe('evaluateTimeAlerts', () => {
    it('fires after-charge at N minutes, not one second earlier', () => {
        const cfg = { afterChargeMin: 5, beforeFcMin: null, beforeDropMin: null, afterDropMin: null };
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 299 }), cfg)).toEqual([]);
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 300 }), cfg)).toEqual(['after-charge']);
    });

    it('silences after-charge once Drop/End is marked', () => {
        const cfg = { afterChargeMin: 5, beforeFcMin: null, beforeDropMin: null, afterDropMin: null };
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 400, dropped: true, sessionDropSec: 360 }), cfg)).toEqual([]);
    });

    it('fires before-fc in the [refFc - N min, refFc) window only', () => {
        const cfg = { afterChargeMin: null, beforeFcMin: 1, beforeDropMin: null, afterDropMin: null };
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 419 }), cfg)).toEqual([]);
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 420 }), cfg)).toEqual(['before-fc']);
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 479 }), cfg)).toEqual(['before-fc']);
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 480 }), cfg)).toEqual([]);
    });

    it('skips before-fc without a reference FC Start', () => {
        const cfg = { afterChargeMin: null, beforeFcMin: 1, beforeDropMin: null, afterDropMin: null };
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 420, referenceFcStartSec: null }), cfg)).toEqual([]);
    });

    it('fires before-drop in the [refDrop - N min, refDrop) window only', () => {
        const cfg = { afterChargeMin: null, beforeFcMin: null, beforeDropMin: 1, afterDropMin: null };
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 659 }), cfg)).toEqual([]);
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 660 }), cfg)).toEqual(['before-drop']);
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 720 }), cfg)).toEqual([]);
    });

    it('skips before-drop without a reference Drop', () => {
        const cfg = { afterChargeMin: null, beforeFcMin: null, beforeDropMin: 1, afterDropMin: null };
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 660, referenceDropSec: null }), cfg)).toEqual([]);
    });

    it('fires after-drop N minutes after the session Drop, not before', () => {
        const cfg = { afterChargeMin: null, beforeFcMin: null, beforeDropMin: null, afterDropMin: 5 };
        const dropped = { dropped: true as const, sessionDropSec: 720 };
        expect(evaluateTimeAlerts(baseTime({ ...dropped, elapsedSec: 1019 }), cfg)).toEqual([]);
        expect(evaluateTimeAlerts(baseTime({ ...dropped, elapsedSec: 1020 }), cfg)).toEqual(['after-drop']);
    });

    it('skips after-drop until Drop is marked', () => {
        const cfg = { afterChargeMin: null, beforeFcMin: null, beforeDropMin: null, afterDropMin: 5 };
        expect(evaluateTimeAlerts(baseTime({ elapsedSec: 2000, sessionDropSec: null }), cfg)).toEqual([]);
    });
});
