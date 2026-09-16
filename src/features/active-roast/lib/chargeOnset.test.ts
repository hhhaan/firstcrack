import { describe, expect, it } from 'vitest';
import { detectChargeOnset } from './chargeOnset';

const s = (timeSec: number, bt: number) => ({ timeSec, bt });

describe('detectChargeOnset', () => {
    it('returns null for empty history', () => {
        expect(detectChargeOnset([])).toBeNull();
    });

    it('returns single sample as-is', () => {
        expect(detectChargeOnset([s(0, 200)])).toEqual(s(0, 200));
    });

    it('picks plateau end before drop (~230 → 210 case)', () => {
        const history = [
            s(0, 230),
            s(1, 230),
            s(2, 230),
            s(3, 230),
            s(4, 230), // onset
            s(5, 225),
            s(6, 220),
            s(7, 215),
            s(8, 212),
            s(9, 210), // confirm
            s(10, 211), // noise bump after drop — must NOT win
            s(11, 210),
        ];
        const onset = detectChargeOnset(history, { minDropC: 2 });
        expect(onset).toEqual(s(4, 230));
    });

    it('prefers last plateau over earlier higher peak', () => {
        const history = [
            s(0, 235),
            s(1, 232),
            s(2, 220),
            s(3, 220),
            s(4, 220), // later plateau
            s(5, 210),
            s(6, 200),
        ];
        const onset = detectChargeOnset(history, { minDropC: 2 });
        expect(onset?.bt).toBe(220);
        expect(onset?.timeSec).toBe(4);
    });

    it('falls back to global max when strictly descending', () => {
        const history = [s(0, 220), s(1, 215), s(2, 210), s(3, 200)];
        expect(detectChargeOnset(history)).toEqual(s(0, 220));
    });

    it('ignores samples outside lookback', () => {
        const history = [
            s(0, 250), // outside 20s lookback when last=30
            s(25, 230),
            s(26, 230),
            s(27, 230),
            s(28, 220),
            s(30, 210),
        ];
        const onset = detectChargeOnset(history);
        expect(onset?.bt).toBe(230);
        expect(onset?.timeSec).toBe(27);
    });
});
